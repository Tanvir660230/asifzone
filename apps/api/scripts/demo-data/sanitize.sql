-- Demo-data sanitization (docs/DEMO_DATA.md §4). Run by import.ts against asifzone_demo_staging ONLY, in a single
-- transaction (psql -1 -v ON_ERROR_STOP=1), before the staging database is swapped in as asifzone_demo.
--
-- Catalog, storefront configuration, pricing, inventory and order economics are kept exactly. Everything that identifies
-- a person or grants access is replaced, removed, or neutralised. Replacement values are deterministic per original value
-- (the same phone/email maps to the same fake everywhere), so order <-> customer relationships stay intact.
--   emails -> userN@demo.invalid   (.invalid is a reserved TLD: never deliverable)
--   phones -> 019NNNNNNNN          (live providers are forced off on the demo DB, so nothing is ever sent to them)

-- ── helpers (session-local) ────────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION pg_temp.phone_key(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN length(regexp_replace(p, '\D', '', 'g')) >= 10 THEN right(regexp_replace(p, '\D', '', 'g'), 10) ELSE p END
$$;

-- Removes emails and Bangladeshi mobile numbers from free text.
CREATE FUNCTION pg_temp.scrub(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(
           regexp_replace(t, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[email]', 'g'),
           '(\+?880|0)?1[3-9][0-9]{8}', '[phone]', 'g')
$$;

-- Same for JSON; a value that would stop being valid JSON after scrubbing is dropped instead.
CREATE FUNCTION pg_temp.scrub_json(j jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF j IS NULL THEN RETURN NULL; END IF;
  RETURN pg_temp.scrub(j::text)::jsonb;
EXCEPTION WHEN others THEN
  RETURN NULL;
END
$$;

-- ── deterministic replacement maps ─────────────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE phone_map ON COMMIT DROP AS
WITH raw(p) AS (
  SELECT phone FROM "Customer" WHERE phone IS NOT NULL
  UNION SELECT "customerPhone" FROM "Order"
  UNION SELECT phone FROM "Address"
  UNION SELECT phone FROM "Feedback" WHERE phone IS NOT NULL
), keyed AS (
  SELECT p, pg_temp.phone_key(p) AS k FROM raw WHERE btrim(p) <> ''
), ranked AS (
  SELECT k, row_number() OVER (ORDER BY md5(k)) AS n FROM (SELECT DISTINCT k FROM keyed) d
)
SELECT keyed.p AS original, '019' || lpad(ranked.n::text, 8, '0') AS fake FROM keyed JOIN ranked USING (k);
CREATE INDEX ON phone_map (original);

CREATE TEMP TABLE email_map ON COMMIT DROP AS
WITH raw(e) AS (
  SELECT email FROM "Customer" WHERE email IS NOT NULL
  UNION SELECT "customerEmail" FROM "Order" WHERE "customerEmail" IS NOT NULL
  UNION SELECT email FROM "NewsletterSubscriber"
  UNION SELECT email FROM "Feedback" WHERE email IS NOT NULL
), ranked AS (
  SELECT e, row_number() OVER (ORDER BY md5(lower(btrim(e)))) AS n FROM (SELECT DISTINCT e FROM raw) d
)
SELECT e AS original, 'user' || n || '@demo.invalid' AS fake FROM ranked;
CREATE INDEX ON email_map (original);

-- ── credentials, sessions, tokens: removed entirely ────────────────────────────────────────────────────────────────────
DELETE FROM "RefreshToken";
DELETE FROM "AdminInvite";
DELETE FROM "CustomerRefreshToken";
DELETE FROM "PasswordResetToken";
DELETE FROM "EmailVerificationToken";
DELETE FROM "CustomerClaim";
DELETE FROM "PhoneOtp";
DELETE FROM "PushSubscription";

-- Operational queues/inboxes: payloads carry customer details and a pending row would be re-sent by a worker.
DELETE FROM "OutboxEvent";
DELETE FROM "Notification";

-- ── staff: kept as rows (audit/history references), but no real identity and no usable password ────────────────────────
-- import.ts then upserts the local demo OWNER (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD).
UPDATE "AdminUser" a
   SET name = 'Staff ' || m.n,
       email = 'staff' || m.n || '@demo.invalid',
       "passwordHash" = '!disabled-in-demo',
       "googleId" = NULL
  FROM (SELECT id, row_number() OVER (ORDER BY "createdAt", id) AS n FROM "AdminUser") m
 WHERE a.id = m.id;

-- ── customers & addresses ──────────────────────────────────────────────────────────────────────────────────────────────
UPDATE "Customer" c
   SET name = 'Demo Customer ' || m.n,
       email = (SELECT fake FROM email_map WHERE original = c.email),
       phone = (SELECT fake FROM phone_map WHERE original = c.phone),
       "passwordHash" = NULL,
       "googleId" = NULL,
       "adminNotes" = NULL,
       "tokenVersion" = c."tokenVersion" + 1
  FROM (SELECT id, row_number() OVER (ORDER BY "createdAt", id) AS n FROM "Customer") m
 WHERE c.id = m.id;

UPDATE "Address" a
   SET "fullName" = c.name,
       phone = COALESCE((SELECT fake FROM phone_map WHERE original = a.phone), a.phone),
       "addressLine" = 'House ' || (abs(hashtext(a.id)) % 200 + 1) || ', Demo Road'
  FROM "Customer" c
 WHERE c.id = a."customerId";

-- ── orders: economics, items, statuses, courier/payment state kept; the person removed ─────────────────────────────────
UPDATE "Order" o
   SET "customerName" = COALESCE((SELECT name FROM "Customer" c WHERE c.id = o."customerId"), 'Guest Customer'),
       "customerEmail" = (SELECT fake FROM email_map WHERE original = o."customerEmail"),
       "customerPhone" = COALESCE((SELECT fake FROM phone_map WHERE original = o."customerPhone"), '01900000000'),
       "shippingAddressLine" = 'House ' || (abs(hashtext(o.id)) % 200 + 1) || ', Demo Road',
       notes = CASE WHEN o.notes IS NULL THEN NULL ELSE '[customer note removed in demo]' END,
       "adminNotes" = CASE WHEN o."adminNotes" IS NULL THEN NULL ELSE '[admin note removed in demo]' END,
       "courierTrackingLink" = NULL;

UPDATE "OrderStatusHistory" SET note = pg_temp.scrub(note) WHERE note IS NOT NULL;
UPDATE "StockMovement" SET note = pg_temp.scrub(note) WHERE note IS NOT NULL;
UPDATE "ReturnRequest" SET note = pg_temp.scrub(note), "adminNote" = pg_temp.scrub("adminNote");

-- Payment gateway payloads (payer accounts, card masks, customer details sent to the gateway) are dropped; amounts,
-- statuses and transaction references stay so the payment ledger still reconciles.
UPDATE "PaymentSession" SET "checkoutPayload" = NULL, "gatewayUrl" = NULL;
UPDATE "Payment" SET "rawResponse" = NULL, note = pg_temp.scrub(note);
UPDATE "PaymentEvent" SET "rawResponse" = NULL, note = pg_temp.scrub(note);
UPDATE "Refund" SET reason = pg_temp.scrub(reason), method = pg_temp.scrub(method);

-- ── reviews: APPROVED ones are already public on the storefront (name + text) and are kept; others are anonymised ─────
UPDATE "ProductReview" r
   SET "customerName" = CASE WHEN r.status = 'APPROVED' THEN r."customerName" ELSE c.name END,
       title = pg_temp.scrub(r.title),
       body = pg_temp.scrub(r.body)
  FROM "Customer" c
 WHERE c.id = r."customerId";

-- ── marketing & contact ────────────────────────────────────────────────────────────────────────────────────────────────
UPDATE "NewsletterSubscriber" n SET email = (SELECT fake FROM email_map WHERE original = n.email);
UPDATE "Feedback" f
   SET name = 'Demo Visitor',
       email = (SELECT fake FROM email_map WHERE original = f.email),
       phone = (SELECT fake FROM phone_map WHERE original = f.phone),
       subject = pg_temp.scrub(subject),
       message = pg_temp.scrub(message);

-- Nothing scheduled may fire from the demo; recipients that were never sent are closed out.
UPDATE "Campaign" SET status = 'DRAFT', "scheduledAt" = NULL WHERE status IN ('SCHEDULED', 'SENDING');
UPDATE "CampaignRecipient" SET "renderedBody" = NULL;
UPDATE "CampaignRecipient" SET status = 'FAILED', error = 'not sent (demo import)' WHERE status = 'PENDING';

UPDATE "SmsNotificationSetting" SET "adminAlertPhones" = '';

-- ── analytics & audit ──────────────────────────────────────────────────────────────────────────────────────────────────
UPDATE "PageView" SET "userAgent" = NULL, city = NULL WHERE "userAgent" IS NOT NULL OR city IS NOT NULL;

UPDATE "AuditLog"
   SET "ipAddress" = NULL,
       metadata = CASE
         WHEN "entityType" ~* '(customer|order|address|return|refund|payment|admin|invite|team|staff|feedback|review|campaign|auth|session|newsletter|courier|sms)'
           THEN NULL
         ELSE pg_temp.scrub_json(metadata)
       END;
