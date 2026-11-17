-- Files move out of Postgres (owner, 2026-11-17): each stored file says where its bytes live,
-- db (the row's own bytea column, as before) or r2 (an object in the private Cloudflare R2
-- bucket under storage_key). Reading goes through readStoredFile (packages/db/src/files).

-- CreateEnum
CREATE TYPE "FileStorage" AS ENUM ('db', 'r2');

-- AlterTable
ALTER TABLE "employee_documents" ADD COLUMN     "sha256" TEXT,
ADD COLUMN     "storage" "FileStorage" NOT NULL DEFAULT 'db',
ADD COLUMN     "storage_key" TEXT,
ALTER COLUMN "data" DROP NOT NULL;

-- AlterTable
ALTER TABLE "employee_photos" ADD COLUMN     "sha256" TEXT,
ADD COLUMN     "storage" "FileStorage" NOT NULL DEFAULT 'db',
ADD COLUMN     "storage_key" TEXT,
ALTER COLUMN "data" DROP NOT NULL;

-- AlterTable
ALTER TABLE "hire_draft_files" ADD COLUMN     "sha256" TEXT,
ADD COLUMN     "storage" "FileStorage" NOT NULL DEFAULT 'db',
ADD COLUMN     "storage_key" TEXT,
ALTER COLUMN "data" DROP NOT NULL;

-- AlterTable
ALTER TABLE "leave_requests" ADD COLUMN     "document_sha256" TEXT,
ADD COLUMN     "document_size_bytes" INTEGER,
ADD COLUMN     "document_storage" "FileStorage" NOT NULL DEFAULT 'db',
ADD COLUMN     "document_storage_key" TEXT;

-- AlterTable
ALTER TABLE "merchant_contract_files" ADD COLUMN     "sha256" TEXT,
ADD COLUMN     "storage" "FileStorage" NOT NULL DEFAULT 'db',
ADD COLUMN     "storage_key" TEXT,
ALTER COLUMN "data" DROP NOT NULL;

-- AlterTable
ALTER TABLE "payout_proofs" ADD COLUMN     "sha256" TEXT,
ADD COLUMN     "storage" "FileStorage" NOT NULL DEFAULT 'db',
ADD COLUMN     "storage_key" TEXT,
ALTER COLUMN "data" DROP NOT NULL;

-- AlterTable
ALTER TABLE "photos" ADD COLUMN     "sha256" TEXT,
ADD COLUMN     "storage" "FileStorage" NOT NULL DEFAULT 'db',
ADD COLUMN     "storage_key" TEXT,
ALTER COLUMN "data" DROP NOT NULL;

-- AlterTable
ALTER TABLE "violations" ADD COLUMN     "evidence_sha256" TEXT,
ADD COLUMN     "evidence_size_bytes" INTEGER,
ADD COLUMN     "evidence_storage" "FileStorage" NOT NULL DEFAULT 'db',
ADD COLUMN     "evidence_storage_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "employee_documents_storage_key_key" ON "employee_documents"("storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "employee_photos_storage_key_key" ON "employee_photos"("storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "hire_draft_files_storage_key_key" ON "hire_draft_files"("storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "leave_requests_document_storage_key_key" ON "leave_requests"("document_storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_contract_files_storage_key_key" ON "merchant_contract_files"("storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "payout_proofs_storage_key_key" ON "payout_proofs"("storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "photos_storage_key_key" ON "photos"("storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "violations_evidence_storage_key_key" ON "violations"("evidence_storage_key");


-- A file's bytes are always somewhere: in the row (db) or under a key in the bucket (r2).
ALTER TABLE "photos" ADD CONSTRAINT "photos_bytes_somewhere" CHECK (("storage" = 'db' AND "data" IS NOT NULL) OR ("storage" = 'r2' AND "storage_key" IS NOT NULL));
ALTER TABLE "payout_proofs" ADD CONSTRAINT "payout_proofs_bytes_somewhere" CHECK (("storage" = 'db' AND "data" IS NOT NULL) OR ("storage" = 'r2' AND "storage_key" IS NOT NULL));
ALTER TABLE "employee_photos" ADD CONSTRAINT "employee_photos_bytes_somewhere" CHECK (("storage" = 'db' AND "data" IS NOT NULL) OR ("storage" = 'r2' AND "storage_key" IS NOT NULL));
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_bytes_somewhere" CHECK (("storage" = 'db' AND "data" IS NOT NULL) OR ("storage" = 'r2' AND "storage_key" IS NOT NULL));
ALTER TABLE "merchant_contract_files" ADD CONSTRAINT "merchant_contract_files_bytes_somewhere" CHECK (("storage" = 'db' AND "data" IS NOT NULL) OR ("storage" = 'r2' AND "storage_key" IS NOT NULL));
ALTER TABLE "hire_draft_files" ADD CONSTRAINT "hire_draft_files_bytes_somewhere" CHECK (("storage" = 'db' AND "data" IS NOT NULL) OR ("storage" = 'r2' AND "storage_key" IS NOT NULL));
-- The optional files (a leave document, violation evidence) may be absent; once in R2 they have a key.
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_document_somewhere" CHECK ("document_storage" = 'db' OR ("document_storage_key" IS NOT NULL AND "document_data" IS NULL));
ALTER TABLE "violations" ADD CONSTRAINT "violations_evidence_somewhere" CHECK ("evidence_storage" = 'db' OR ("evidence_storage_key" IS NOT NULL AND "evidence_data" IS NULL));

-- A paid payout's proof stays fixed, except that its bytes may move from the row to R2 once
-- (the file mover): every other column must stay as it was.
CREATE OR REPLACE FUNCTION payout_proof_frozen() RETURNS trigger AS $$
DECLARE
  v_status "payout_status";
BEGIN
  SELECT status INTO v_status FROM "payouts" WHERE id = OLD.payout_id;
  IF v_status = 'paid' THEN
    IF TG_OP = 'UPDATE'
      AND OLD.storage = 'db' AND NEW.storage = 'r2'
      AND NEW.storage_key IS NOT NULL AND NEW.data IS NULL
      AND (NEW.id, NEW.number, NEW.payout_id, NEW.file_name, NEW.content_type, NEW.size_bytes,
           NEW.amount_piastres, NEW.reference, NEW.uploaded_by_id, NEW.created_at)
          IS NOT DISTINCT FROM
          (OLD.id, OLD.number, OLD.payout_id, OLD.file_name, OLD.content_type, OLD.size_bytes,
           OLD.amount_piastres, OLD.reference, OLD.uploaded_by_id, OLD.created_at)
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'payout_paid_frozen' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER payout_proofs_frozen ON "payout_proofs";
CREATE TRIGGER payout_proofs_frozen
  BEFORE UPDATE OR DELETE ON "payout_proofs"
  FOR EACH ROW EXECUTE FUNCTION payout_proof_frozen();

-- R2 objects no row names, noted the first time the orphan clean up sees them; deleted only
-- files.orphan_keep_days later so a database restored from a kept backup still finds its files.
CREATE TABLE "file_orphans" (
    "key" TEXT NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "file_orphans_pkey" PRIMARY KEY ("key")
);
