-- AlterEnum
ALTER TYPE "BagStatus" ADD VALUE 'CHECKED';

-- AlterTable
ALTER TABLE "bags" ADD COLUMN     "checked_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "lane_hub_id" UUID;
