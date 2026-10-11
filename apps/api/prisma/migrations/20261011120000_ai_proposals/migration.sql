-- Blueprint V2 §T / DR-23: AI proposals (propose → explicit confirm → execute).
CREATE TYPE "AiProposalStatus" AS ENUM ('PENDING', 'EXECUTED', 'CANCELLED', 'FAILED');

CREATE TABLE "AiProposal" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "title" TEXT NOT NULL,
    "effects" JSONB NOT NULL,
    "previewHash" TEXT NOT NULL,
    "status" "AiProposalStatus" NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiProposal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiProposal_adminId_createdAt_idx" ON "AiProposal"("adminId", "createdAt");

ALTER TABLE "AiProposal" ADD CONSTRAINT "AiProposal_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
