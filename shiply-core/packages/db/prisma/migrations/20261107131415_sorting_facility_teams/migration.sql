-- CreateEnum
CREATE TYPE "Team" AS ENUM ('INBOUND', 'SORTING', 'OUTBOUND');

-- AlterEnum
ALTER TYPE "BagStatus" ADD VALUE 'HANDED_OVER';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ShipmentStatus" ADD VALUE 'AT_INBOUND';
ALTER TYPE "ShipmentStatus" ADD VALUE 'SORTED';
ALTER TYPE "ShipmentStatus" ADD VALUE 'AT_OUTBOUND';

-- AlterTable
ALTER TABLE "areas" ADD COLUMN     "lat" DOUBLE PRECISION,
ADD COLUMN     "lng" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "governorates" ADD COLUMN     "lat" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "lng" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "hubs" ADD COLUMN     "lat" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "lng" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "parent_id" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "team" "Team";

-- AddForeignKey
ALTER TABLE "hubs" ADD CONSTRAINT "hubs_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "hubs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
