-- The service layer already checks for an existing PENDING return request before creating a new
-- one (return-request.service.ts's createReturnRequest), but that check-then-create isn't atomic:
-- two near-simultaneous submissions for the same order (double-click, retry) can both pass the
-- check and both insert. This partial unique index is the real backstop — Prisma's schema DSL
-- can't express a partial/conditional unique constraint, so it exists only as raw SQL (see the
-- comment on ReturnRequest.status in schema.prisma), same pattern as Address's one-default-per-customer.
CREATE UNIQUE INDEX IF NOT EXISTS "ReturnRequest_orderId_pending_key" ON "ReturnRequest" ("orderId") WHERE "status" = 'PENDING';
