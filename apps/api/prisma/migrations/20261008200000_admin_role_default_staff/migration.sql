-- P0-02 (docs/MASTER_SYSTEM_INVENTORY.md SEC-02): an admin row inserted without a role becomes the least-privileged STAFF,
-- never OWNER. Default only — no existing row changes.

-- AlterTable
ALTER TABLE "AdminUser" ALTER COLUMN "role" SET DEFAULT 'STAFF';
