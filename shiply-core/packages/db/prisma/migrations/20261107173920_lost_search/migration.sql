-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "compensation" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "damaged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lost_final_at" TIMESTAMP(3),
ADD COLUMN     "search_until" TIMESTAMP(3);
