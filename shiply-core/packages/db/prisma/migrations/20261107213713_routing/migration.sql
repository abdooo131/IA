-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "route" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "shopify_stores" ALTER COLUMN "auto_create" SET DEFAULT false;

-- CreateTable
CREATE TABLE "line_haul_links" (
    "id" UUID NOT NULL,
    "from_id" UUID NOT NULL,
    "to_id" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "hours" INTEGER NOT NULL DEFAULT 12,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "line_haul_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "line_haul_links_from_id_to_id_key" ON "line_haul_links"("from_id", "to_id");
