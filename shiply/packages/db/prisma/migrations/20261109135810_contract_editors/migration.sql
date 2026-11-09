-- AlterTable
ALTER TABLE "merchants"."contract_versions" ADD COLUMN     "editor_ids" TEXT[],
ADD COLUMN     "submitted_by_id" TEXT;
