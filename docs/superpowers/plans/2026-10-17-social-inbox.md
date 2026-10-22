# Social Inbox (WhatsApp, Messenger, Instagram, FB comments + AI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Customer messages from WhatsApp, Facebook Messenger, Instagram DM and Facebook post/ad comments land in the existing admin Inbox. Staff reply from there. AI sends factual answers (price, stock, delivery charge, order status, how to order) automatically and drafts every other reply for staff to send.

**Architecture:** One Meta webhook (`/api/v1/webhooks/meta`) is checked by signature and parsed by a pure function into `InboundEvent[]`. Those events are stored as `Conversation`/`ConversationMessage` rows; repeat deliveries are dropped using Meta's message id. Every new inbound message writes an outbox event, and the `conversation-assist` consumer runs the AI on it in the background with retries. Replies, whether from staff or from the AI, reuse the existing `conversation-reply` outbox path, extended with a Meta Graph client. Credentials live in Settings › Integrations.

**Tech Stack:** Express + Prisma + Postgres, Vitest (API), Next.js 15 admin, Playwright, `@anthropic-ai/sdk` via the existing `AiModel` interface (`apps/api/src/domain/ai/chat.service.ts`), Meta Graph API (fetch, no SDK).

**Spec:** Owner decisions 2026-10-17 (this conversation):
- WhatsApp uses the **current number** via Meta coexistence, so the phone app keeps working.
- AI: **factual answers auto-sent, everything else drafted** for staff.
- Channels: **WhatsApp, Messenger, Instagram DM, Facebook comments**.
- **Asif Zone first.** The code ships to both stores; Nasihamart only needs its own keys.

**Worktree:** `C:/dev/asifzone-social-inbox`, branch `feat/social-inbox` (from origin/main bc0d012). Dev ports :3960 (web) / :4960 (API), API on `clothing_brand_test` (see memory: local e2e setup).

## Global Constraints

- Shared code only; no `if (brand === …)`. Each installation has its own Meta keys and database.
- Admin UI: light only, Apple-style, built from `apps/web/components/ui/*` primitives and tokens. Must work at 375px with loading, empty and error states.
- Secrets only through Settings › Integrations (`packages/shared/src/integrations.ts`). Never log or return token values.
- Every send goes through the outbox (record + intent in one transaction). Webhooks never call Meta or Anthropic inline.
- The AI may only use read-only tools. Auto-sent text may only state facts that a tool returned in the same run.
- AI auto-reply is **off by default** (`INBOX_AI_AUTOREPLY=off`). The owner turns it on after watching drafts.
- Meta Graph version is a single constant `META_GRAPH_VERSION` in `apps/api/src/providers/social/meta-graph.ts`. Check the current version and webhook field names against Meta's docs (Context7 / developers.facebook.com) before Task 2 and Task 4.

## Review Focus

1. **Meta re-delivers the same webhook** (it retries on slow or non-2xx responses). Expect exactly one message and one AI run. Task 3 tests this.
2. **A stranger types someone else's phone number on Messenger and asks "amar order kothay"**. Expect no order details. A lookup needs the order number **and** a matching phone, or a WhatsApp sender whose number is the order's phone. Task 6 tests this.
3. **Staff reply from the phone app** (coexistence/page echo). Expect it to appear in the thread as staff OUT with delivery "sent". After that the AI only drafts for 12 h, never auto-sends. Tasks 3 and 6 test this.
4. **A customer sends only a photo, voice note or sticker.** Expect the thread to show `[Photo]`/`[Voice message]`/`[Sticker]` and the AI to draft or do nothing, never auto-reply. Tasks 2 and 6 test this.
5. **A WhatsApp reply more than 24 h after the customer's last message.** Expect a 400 `WINDOW_CLOSED` with a clear message at send time, not a silently failed outbox row. Task 4 tests this.

---

### Task 1: Data model, shared types, reply window

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (enum `ConversationChannel`, models `Conversation`, `ConversationMessage`; new `ConversationDraft`)
- Create: `apps/api/prisma/migrations/20261017120000_social_inbox/migration.sql`
- Modify: `packages/shared/src/schemas/conversation.ts`
- Create: `packages/shared/src/reply-window.ts` (+ export from `packages/shared/src/index.ts`)
- Test: `packages/shared/src/reply-window.test.ts`

**Interfaces:**
- Produces (Prisma):
  - `ConversationChannel` gains `INSTAGRAM`, `FB_COMMENT`.
  - `Conversation` gains `externalThreadId String?`, `lastInboundAt DateTime?`, `postId String?` (comments) and `@@unique([channel, externalThreadId])`.
  - `ConversationMessage` gains `externalId String? @unique` (Meta mid/wamid/comment id), `author MessageAuthor @default(CUSTOMER)` where `enum MessageAuthor { CUSTOMER STAFF AI PHONE }`. Backfill: OUT rows get `STAFF`.
  - `model ConversationDraft { id, conversationId String @unique, body String, intent String, basedOnMessageId String, createdAt }` with cascade delete.
- Produces (shared):
  - `ConversationChannelName` adds `"INSTAGRAM" | "FB_COMMENT"`.
  - `conversationReplySchema.channel` becomes `z.enum(["EMAIL","SMS","WHATSAPP","MESSENGER","INSTAGRAM","FB_COMMENT"])`. On an FB_COMMENT thread, `MESSENGER` means a private reply.
  - `ConversationMessageRow.author: "CUSTOMER"|"STAFF"|"AI"|"PHONE"`.
  - `ConversationDetail.draft: { body: string; intent: string } | null`, `ConversationDetail.replyWindow: ReplyWindow`.
  - `conversationListQuerySchema.channel?: ConversationChannelName`.
  - `replyWindow(channel: ConversationChannelName, lastInboundAt: Date | null, now: Date): ReplyWindow` where `ReplyWindow = { open: boolean; humanAgentTag: boolean; closesAt: string | null }`.

- [ ] **Step 1: Write failing tests** in `reply-window.test.ts`:
  - WHATSAPP: inbound 23h59m ago → `{open:true, humanAgentTag:false}`; 24h01m ago → `open:false`; `null` → `open:false`.
  - MESSENGER/INSTAGRAM: 23h → open, no tag; 25h → `{open:true, humanAgentTag:true}`; 7d+1m → `open:false`.
  - FB_COMMENT, EMAIL, SMS, WEB_FORM: always `{open:true, humanAgentTag:false, closesAt:null}`.
  - `closesAt` for WHATSAPP = lastInboundAt + 24h, as an ISO string.
- [ ] **Step 2:** Run `pnpm --filter @clothing-brand/shared test reply-window`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `replyWindow`. Edit the schema, write the migration by hand (enum `ALTER TYPE … ADD VALUE`, columns, unique index, `MessageAuthor` backfill `UPDATE … SET "author"='STAFF' WHERE "direction"='OUT'`), and update the shared types.
- [ ] **Step 4:** `pnpm --filter @clothing-brand/shared test reply-window` → PASS. Run `pnpm --filter api exec prisma migrate deploy` against `clothing_brand_test` (never use it as a shadow DB). `pnpm --filter api typecheck` → clean, apart from the reply-schema callers that Task 4 fixes. If those break compile, widen `deliverConversationReply` to return `"skipped"` for the new channels for now.
- [ ] **Step 5:** Commit `feat(inbox): social channels in the conversation model + reply window`.

### Task 2: Meta webhook parser (pure)

**Files:**
- Create: `apps/api/src/modules/social-inbox/meta-webhook.parse.ts`
- Create: `apps/api/src/modules/social-inbox/fixtures/*.json` (one realistic payload per case below, shaped after Meta's docs examples)
- Test: `apps/api/src/modules/social-inbox/meta-webhook.parse.test.ts`

**Interfaces:**
- Produces:
```ts
export interface InboundEvent {
  channel: "WHATSAPP" | "MESSENGER" | "INSTAGRAM" | "FB_COMMENT";
  direction: "IN" | "OUT";           // OUT = echo of a reply sent from the phone app / Page inbox
  threadId: string;                  // WA: customer wa_id; Messenger: PSID; IG: IGSID; comment: top-level comment id
  externalId: string;                // wamid / mid / comment id
  name: string | null;               // WA profile name, comment author name; null for Messenger/IG
  phone: string | null;              // WA only, normalised with normalizeBdPhone
  body: string;                      // text, or "[Photo]" "[Video]" "[Voice message]" "[Sticker]" "[File]" "[Location]"
  at: Date;
  postId?: string;                   // FB_COMMENT
}
export function parseMetaWebhook(body: unknown, ids: { pageId: string; igAccountId: string }): InboundEvent[];
```

- [ ] **Step 1:** Check the current payload shapes in Meta's docs: WhatsApp `messages` and the coexistence echo field (`smb_message_echoes`), Page `messaging` with `is_echo`, Instagram `messaging`, Page `feed` comment (`item:"comment"`, `verb:"add"`). Save the fixtures.
- [ ] **Step 2: Write failing tests**, one per fixture:
  - WA text → 1 IN event, `phone` normalised to `01XXXXXXXXX`, `name` from `contacts[0].profile.name`.
  - WA image with caption → body `"[Photo] <caption>"`. WA audio → `"[Voice message]"`.
  - WA `statuses` only → `[]`.
  - WA echo → `direction:"OUT"`, threadId = customer number.
  - Messenger text → IN with threadId = sender id. Messenger `is_echo` → OUT with threadId = recipient id. Messenger `delivery`/`read` → `[]`.
  - IG message → channel INSTAGRAM. An IG echo where the sender is `igAccountId` → OUT.
  - Feed comment add → FB_COMMENT, threadId = comment id, postId set. Reply-to-comment (`parent_id` ≠ post) → threadId = `parent_id`. A comment from `pageId` itself → `[]`. `verb:"remove"`/`"edited"` → `[]`.
  - Garbage (`{}`, `null`, unknown `object`) → `[]`, no throw.
- [ ] **Step 3:** Run `pnpm --filter api test meta-webhook.parse` → FAIL.
- [ ] **Step 4:** Implement `parseMetaWebhook`. Use zod `safeParse` per entry and skip entries that don't match. It never throws.
- [ ] **Step 5:** Run the tests again → PASS. Commit `feat(inbox): parse Meta webhooks into inbound events`.

### Task 3: Webhook endpoint + ingest

**Files:**
- Create: `apps/api/src/modules/social-inbox/meta-webhook.routes.ts`
- Create: `apps/api/src/modules/social-inbox/ingest.service.ts`
- Modify: `apps/api/src/app.ts:72` (`express.json` `verify` keeps `rawBody` for paths starting `/api/v1/webhooks/meta`; mount router at `/api/v1/webhooks/meta`)
- Modify: `apps/api/src/middlewares/csrf.ts` (exempt `/api/v1/webhooks/meta` with a comment in the house style: authenticated by HMAC signature, no cookie authority)
- Modify: `apps/api/src/config/env.ts` (`meta.appSecret`, `meta.webhookVerifyToken`, `meta.pageId`, `meta.pageAccessToken`, `meta.igAccountId`, `whatsapp.phoneNumberId`, `whatsapp.accessToken`, `inboxAi.autoReply: "off" | "factual"`, all via `integrationSetting`)
- Modify: `apps/api/src/domain/outbox/consumers.ts` (register `conversation-assist` with a stub handler that returns `"disabled"`; Task 6 fills it)
- Test: `apps/api/src/modules/social-inbox/meta-webhook.integration.test.ts`

**Interfaces:**
- Consumes: `parseMetaWebhook`, `InboundEvent` (Task 2).
- Produces:
  - `GET /api/v1/webhooks/meta`: `hub.mode=subscribe` with a matching `hub.verify_token` → 200 and `hub.challenge` as text; otherwise 403.
  - `POST /api/v1/webhooks/meta`: `X-Hub-Signature-256` = `sha256=` + HMAC-SHA256(appSecret, rawBody), compared in constant time (`constantTimeEqual`). A bad or missing signature, or no app secret configured → 401 and nothing stored. Otherwise 200 `{received:true}` even if ingest throws (captureError). Rate limit: none (Meta's IPs, signature-gated).
  - `ingestInbound(events: InboundEvent[]): Promise<{ created: string[] }>`. Upserts the conversation on `(channel, externalThreadId)`, skips a message whose `externalId` exists (P2002 → skip), and runs in one transaction per event.
    - IN: status `OPEN`, `lastInboundAt`, `lastMessageAt`, contactName = name ?? "Messenger customer"/"Instagram customer". WA links `customerId` only to a customer whose verified phone matches (same rule as `openWebConversation`). Records outbox `conversation.inbound_received.v1`, consumer `conversation-assist`, eventKey = message id.
    - OUT echo: `author: PHONE`, no outbox row, does not change status.
    - Subjects: "WhatsApp chat", "Messenger chat", "Instagram DM", "Comment on a post".
  - `REPLY_CONSUMER` unchanged; new export `ASSIST_CONSUMER = "conversation-assist"` from `ingest.service.ts`.

- [ ] **Step 1: Write failing integration tests** (supertest against `app`, fixtures from Task 2, app secret set via integration override in `beforeAll`):
  - verify handshake success (challenge echoed) and wrong token → 403.
  - unsigned POST → 401, `conversation.count` unchanged.
  - signed WA text → 200, one OPEN WHATSAPP conversation with phone, one IN message, one `conversation-assist` outbox row.
  - **same payload posted twice → still one message, one outbox row** (Review Focus 1).
  - a second WA message from the same number → same conversation, 2 messages, a HANDLED thread reopens to OPEN.
  - WA echo → OUT message `author:"PHONE"`, no new outbox row (Review Focus 3).
  - feed comment → FB_COMMENT conversation with `postId`.
- [ ] **Step 2:** `pnpm --filter api test meta-webhook.integration` → FAIL.
- [ ] **Step 3:** Implement the routes, raw body, CSRF exemption, env getters, `ingestInbound` and the consumer stub.
- [ ] **Step 4:** Run the tests again → PASS, then `pnpm --filter api test inbox` (existing inbox tests still pass).
- [ ] **Step 5:** Commit `feat(inbox): signed Meta webhook stores WhatsApp/Messenger/Instagram/comment messages`.

### Task 4: Sending — Meta Graph client, social replies, window enforcement

**Files:**
- Create: `apps/api/src/providers/social/meta-graph.ts`. Follow the timeout and error conventions in `apps/api/src/providers/errors.ts`. If `provider-architecture.guard.test.ts` requires registration, register it there as the guard test says.
- Modify: `apps/api/src/lib/conversation-reply.ts`
- Modify: `apps/api/src/modules/inbox/inbox.service.ts` (`replyToConversation`, `getConversation`, `listConversations`, `replyFacts`; extract `queueReply`)
- Test: `apps/api/src/providers/social/meta-graph.test.ts`, extend `apps/api/src/modules/inbox/inbox.integration.test.ts`

**Interfaces:**
- Produces (`meta-graph.ts`, each throws `ProviderError` on non-2xx with Meta's `error.message`, 10 s timeout, returns the remote id):
  - `sendWhatsAppText(to: string, body: string): Promise<string>`: `POST /{phoneNumberId}/messages`, `messaging_product:"whatsapp"`, `to` in `8801…` form.
  - `sendPageMessage(psid: string, body: string, opts: { humanAgentTag: boolean }): Promise<string>`: `POST /{pageId}/messages`; with the tag → `messaging_type:"MESSAGE_TAG", tag:"HUMAN_AGENT"`, else `"RESPONSE"`.
  - `sendInstagramMessage(igsid: string, body: string, opts: { humanAgentTag: boolean }): Promise<string>`: the same as above on the IG account endpoint per current docs.
  - `replyToComment(commentId: string, body: string): Promise<string>`: `POST /{commentId}/comments`.
  - `privateReplyToComment(commentId: string, body: string): Promise<string>`: `POST /{pageId}/messages` with `recipient:{comment_id}`.
  - `fetchProfileName(channel: "MESSENGER"|"INSTAGRAM", userId: string): Promise<string | null>`: never throws.
- Produces (inbox.service):
  - `queueReply(tx, { conversationId, channel, body, adminId: string | null, author: "STAFF"|"AI" }): Promise<ConversationMessage>`. Message + status HANDLED + outbox row, so `replyToConversation` and Task 6 share it.
  - `replyToConversation` additionally rejects with 400 and these codes:
    - `WINDOW_CLOSED`, message "WhatsApp only allows replies within 24 hours of the customer's last message — reply by SMS instead." For Messenger/IG the message says 7 days.
    - `WRONG_CHANNEL`: the reply channel doesn't fit the thread (e.g. WHATSAPP on a MESSENGER thread). Allowed: a thread's own channel; EMAIL/SMS when an address exists; MESSENGER on an FB_COMMENT thread (private reply).
  - Deleting the draft: a successful reply deletes the thread's `ConversationDraft`.
  - `getConversation` returns `author`, `draft`, `replyWindow`. `deliveryOf`: an OUT message with `externalId` and no outbox row → `"sent"`.
  - `listConversations` filters on `query.channel`.
- `deliverConversationReply` routes by `facts.channel`, after `conversation.channel` decides comment vs private reply. It stores the returned remote id in `ConversationMessage.externalId`; that is the only write it does, and it is safe because the echo of our own send then dedupes against it. Correct the existing "consumer never writes business data" comment accordingly. The window is re-checked at send time → `"skipped"` if closed.

- [ ] **Step 1: Write failing tests:**
  - `meta-graph.test.ts` with stubbed `fetch`: request URL, method and JSON body for each function. HUMAN_AGENT tag present only when asked. A Meta error JSON → `ProviderError` carrying Meta's message. The token is never in the thrown message.
  - inbox integration:
    - WA thread with `lastInboundAt` 25 h ago → reply 400 `WINDOW_CLOSED`, no message row (Review Focus 5).
    - WA thread 1 h ago → 201, outbox row; running the consumer with mocked `sendWhatsAppText` → called with `8801…`, message gets `externalId`.
    - Messenger thread 30 h ago → `sendPageMessage` called with `humanAgentTag:true`.
    - FB_COMMENT thread + channel MESSENGER → `privateReplyToComment`; + FB_COMMENT → `replyToComment`.
    - WHATSAPP reply on a MESSENGER thread → `WRONG_CHANNEL`.
    - A webhook echo carrying our own sent `externalId` doesn't create a duplicate.
- [ ] **Step 2:** Run `pnpm --filter api test meta-graph inbox` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests again → PASS. `pnpm --filter api typecheck` clean.
- [ ] **Step 5:** Commit `feat(inbox): reply on WhatsApp, Messenger, Instagram and comments from the Inbox`.

### Task 5: Settings › Integrations — Meta inbox card

**Files:**
- Modify: `packages/shared/src/integrations.ts`. New group `inbox: "Customer messages"`. New integrations:
  - `meta-inbox` ("Facebook & Instagram messages"): `META_APP_SECRET` secret required, `META_WEBHOOK_VERIFY_TOKEN` secret required (help: "A password of your own; paste it with the webhook URL in your Meta app › Webhooks"), `META_PAGE_ID` text required, `META_PAGE_ACCESS_TOKEN` secret required, `META_IG_ACCOUNT_ID` text.
  - `whatsapp-cloud` ("WhatsApp"): `WHATSAPP_PHONE_NUMBER_ID` text required, `WHATSAPP_ACCESS_TOKEN` secret required (help: "A permanent system-user token"). It shares `META_APP_SECRET`, noted in the description.
  - `inbox-ai` in group `ai`: `INBOX_AI_AUTOREPLY` select, `off` = "Drafts only" (default), `factual` = "Auto-send price, stock, delivery & order-status answers".
- Modify: `IntegrationsView` type + `getIntegrationsView` → `metaWebhookUrl: \`${apiOrigin}/api/v1/webhooks/meta\``
- Modify: `apps/web/components/admin/integrations-pane.tsx`: show `metaWebhookUrl` with a copy button on the meta-inbox and whatsapp cards, the same way as the Steadfast webhook URL.
- Test: extend the existing integrations test (`grep -rl steadfastWebhookUrl apps/api/src`) for `metaWebhookUrl` and that the new secret fields return only hints.

- [ ] **Step 1:** Failing test → **Step 2** run (FAIL) → **Step 3** implement → **Step 4** run `pnpm --filter api test integrations` + `pnpm --filter web lint` (PASS).
- [ ] **Step 5:** Commit `feat(settings): Meta and WhatsApp inbox credentials in Integrations`.

### Task 6: AI assist — auto-answer factual questions, draft the rest

**Files:**
- Create: `apps/api/src/modules/social-inbox/assist/tools.ts` (read-only tools)
- Create: `apps/api/src/modules/social-inbox/assist/prompt.ts`
- Create: `apps/api/src/modules/social-inbox/assist/assist.service.ts`
- Modify: `apps/api/src/domain/outbox/consumers.ts` (`conversation-assist` handler → `assistConversation(messageId, anthropicAssistantModel())`, returns `"disabled"` when no Anthropic key)
- Test: `apps/api/src/modules/social-inbox/assist/assist.integration.test.ts` (fake `AiModel` scripted per test, the same way `ai-assistant.integration.test.ts` does it)

**Interfaces:**
- Consumes: `AiModel`, `ModelBlock` (`domain/ai/chat.service.ts`), `anthropicAssistantModel()` (`modules/ai/ai.service.ts`), `queueReply` + `replyWindow` (Tasks 1, 4), `fetchProfileName` (Task 4).
- Produces:
  - Tools (each returns JSON, never addresses or full phones; reuse `maskPhone` from `domain/ai/tools.ts`):
    - `find_products({ query })` → ≤5 of `{ name, price, salePrice|null, inStockSizes: string[], url }`. Uses the storefront search service and only shows published products.
    - `delivery_charges()` → zones with fee and typical days. Read from the shipping-zone source of truth, not the legacy `shippingFeeDhaka` mirror.
    - `order_status({ orderNumber?, phone? })` → `{ orderNumber, status, courierTrackingUrl|null, placedAt }[]`. **Access rule:** WHATSAPP thread whose `conversation.phone` = order phone, or `orderNumber` + `phone` both match one order. Otherwise `{ error: "verify" }`, and the model must ask for both.
    - `respond({ action: "auto"|"draft"|"none", intent: "price"|"stock"|"delivery_charge"|"order_status"|"how_to_order"|"other", body })` is the terminal tool.
  - `assistConversation(messageId: string, model: AiModel, now?: Date): Promise<"auto"|"draft"|"none"|"skipped">`
    - Runs at most 6 model turns, using the last 12 messages as context. It fills in a missing Messenger/IG contact name first, via `fetchProfileName`.
    - **Skips** when a newer IN message exists (the later event handles the burst) or when a STAFF/PHONE OUT exists after this message.
    - **Auto is downgraded to draft** in any of these cases (the server enforces this, whatever the model says):
      - `env.inboxAi.autoReply !== "factual"`
      - intent `other`
      - intent ≠ `how_to_order` and no tool returned data in this run
      - the IN body is only a media placeholder
      - a STAFF or PHONE OUT in the last 12 h
      - ≥3 AI OUT messages in this thread in the last 24 h
      - the reply window is closed, or needs the HUMAN_AGENT tag
      - channel is FB_COMMENT. For a comment, auto = public reply "Inbox-e details pathiyechi" (exact copy from `prompt.ts`) + private reply with the answer: two `queueReply` calls, MESSENGER first.
    - auto → `queueReply(..., author:"AI", adminId:null)`. draft → upsert `ConversationDraft`. none → nothing (e.g. "thanks", "ok").
  - `prompt.ts` system prompt: replies in the customer's language (Bangla, Banglish or English), ≤ 3 short sentences, includes the product URL when a product is named, never invents prices/stock/dates, never promises discounts, uses the store name from settings.

- [ ] **Step 1: Write failing tests** (WA thread, published stocked product via `createStockedProduct`, setting `factual` unless stated):
  - "eta dam koto?" with the model calling `find_products` then `respond(auto, price)` → 1 OUT `author:AI`, outbox row, conversation HANDLED.
  - Same with setting `off` → draft stored, no OUT.
  - The model says auto with intent `price` but called no tool → draft.
  - Complaint ("product kharap") → model `draft, other` → draft upserted. A second draft replaces it (one per thread).
  - **Messenger thread, `order_status({phone: <other customer's phone>})` → tool returns `{error:"verify"}`, no order data in any tool result** (Review Focus 2). WA thread with the order's phone → status returned.
  - **Echo (PHONE) OUT 1 h ago → auto downgraded to draft** (Review Focus 3).
  - **IN body `[Photo]` → never auto** (Review Focus 4).
  - Burst: IN m1, IN m2; `assistConversation(m1)` → `"skipped"`, `assistConversation(m2)` runs.
  - 3 AI replies in 24 h → the 4th is a draft.
  - FB_COMMENT price question → one public comment reply + one MESSENGER private reply queued.
  - Model throws → consumer throws (outbox retries), nothing written.
- [ ] **Step 2:** Run `pnpm --filter api test assist` → FAIL.
- [ ] **Step 3:** Implement the tools, prompt, service and consumer wiring.
- [ ] **Step 4:** Run the tests again → PASS. Then the full `pnpm --filter api test` alone (no concurrent vitest; stop spare APIs first, PG connection limit).
- [ ] **Step 5:** Commit `feat(inbox): AI answers price/stock/delivery/order questions and drafts the rest`.

### Task 7: Inbox UI

**Files:**
- Modify: `apps/web/app/admin/(shell)/feedback/page.tsx`. If it grows past ~500 lines, split `Composer`, `MessageBlock` and the channel bits into `apps/web/components/admin/inbox/*.tsx`.
- Modify: the admin inbox API client (`grep -rn "replyToConversation" apps/web/lib`)
- Test: `apps/web/e2e/inbox-social.spec.ts`. Seed through a test-only route in `apps/api/src/test-routes.ts`: `POST /test/inbox/seed-social` creates a WA thread with a draft, a Messenger thread past 24 h, and a comment thread.

**Behaviour (copy is exact):**
- List rows show a channel mark: WhatsApp, Messenger, Instagram and Comment icons from `components/social-icon.tsx`, with a text label for screen readers. Add a channel filter (segmented control on desktop, filter sheet on phones, the pattern used by other admin lists). The list refetches every 15 s.
- Thread header shows the reply window:
  - "Reply window closes in 5h" (from `closesAt`).
  - Messenger/IG past 24 h: "Past 24 hours — sent as a human-agent reply".
  - Closed: "WhatsApp only allows replies within 24 hours of the customer's last message" with SMS offered when `phone` exists.
- Composer:
  - Defaults to the thread's own channel. The draft is prefilled, marked "AI draft · <intent>", with a "Discard draft" action.
  - FB_COMMENT threads choose between "Public reply" and "Private message".
  - The counter limit follows the channel: 600 SMS, 2000 otherwise.
- Message labels: AI OUT "AI · auto-reply", PHONE OUT "Replied from phone", STAFF as today.
- Empty state for no conversations, and an error state on a failed load, as the page does today.

- [ ] **Step 1: Write failing e2e:**
  - WA thread shows the draft in the composer, Send → message labelled with the staff name, delivery state shown.
  - Messenger 30 h thread shows the human-agent note.
  - Comment thread toggles Public/Private.
  - Channel filter "WhatsApp" lists only WA threads.
  - At 375px: no horizontal scroll (`document.documentElement.scrollWidth <= 375`).
- [ ] **Step 2:** Run `pnpm --filter web test:e2e inbox-social` → FAIL.
- [ ] **Step 3:** Implement (use `impeccable` for the hands-on pass, tokens + `components/ui/*` only).
- [ ] **Step 4:** e2e PASS, `pnpm --filter web lint` clean. Screenshot `/admin/feedback` at 1440 and 375 with Playwright MCP, run the `impeccable` critique + `web-design-guidelines` on the changed files, fix what they find, and re-screenshot.
- [ ] **Step 5:** Commit `feat(admin): WhatsApp, Messenger, Instagram and comments in the Inbox`.

### Task 8: Owner setup guide, review, PR

**Files:**
- Create: `docs/META_INBOX_SETUP.md`, owner-facing, in short Bangla-English steps:
  - Business verification.
  - Create the Meta app with Messenger, Instagram, WhatsApp and Webhooks.
  - Permissions: `pages_messaging`, `pages_manage_metadata`, `pages_read_engagement`, `pages_manage_engagement`, `instagram_basic`, `instagram_manage_messages`, `whatsapp_business_messaging`, `whatsapp_business_management`, plus Human Agent. Verify the list against current docs.
  - App Review.
  - WhatsApp coexistence onboarding for the existing number (Embedded Signup; record the exact current flow and which countries it supports).
  - System-user permanent token.
  - Webhook URL + verify token from Settings › Integrations; subscribed fields `messages`, `message_echoes`, `feed`, WhatsApp `messages` + `smb_message_echoes`.
  - Turning on `INBOX_AI_AUTOREPLY` after a week of drafts.

- [ ] **Step 1:** Write the guide.
- [ ] **Step 2:** `verification-before-completion`: full `pnpm --filter api test`, `pnpm --filter web lint`, the e2e spec, with outputs quoted.
- [ ] **Step 3:** `/code-review` on the branch, and `/security-review` (public webhook, signature, order lookup privacy). Fix the findings.
- [ ] **Step 4:** Push `feat/social-inbox`, open a PR, and hand the owner the merge plus the Meta setup steps (merging and deploying are the owner's).
