-- The area engine: named areas of Greater Cairo (level 1 governorate to 5 street) and the
-- words Google placed that the engine did not know yet, waiting for admin.

-- AlterTable
ALTER TABLE "geocode_cache" ADD COLUMN     "method" TEXT;

-- CreateTable
CREATE TABLE "geo_areas" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "parent_id" TEXT,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "aliases" TEXT[],
    "source" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "geom" geometry(MultiPolygon, 4326) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "geo_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geo_suggestions" (
    "id" TEXT NOT NULL,
    "phrase" TEXT NOT NULL,
    "area_id" TEXT NOT NULL,
    "sample_address" TEXT NOT NULL,
    "seen" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "geo_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "geo_areas_ref_key" ON "geo_areas"("ref");

-- CreateIndex
CREATE INDEX "geo_areas_level_idx" ON "geo_areas"("level");

-- CreateIndex
CREATE INDEX "geo_areas_parent_id_idx" ON "geo_areas"("parent_id");

-- CreateIndex
CREATE INDEX "geo_areas_geom_idx" ON "geo_areas" USING GIST ("geom");

-- CreateIndex
CREATE INDEX "geo_suggestions_status_seen_idx" ON "geo_suggestions"("status", "seen");

-- CreateIndex
CREATE UNIQUE INDEX "geo_suggestions_phrase_area_id_key" ON "geo_suggestions"("phrase", "area_id");

-- AddForeignKey
ALTER TABLE "geo_areas" ADD CONSTRAINT "geo_areas_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "geo_areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geo_suggestions" ADD CONSTRAINT "geo_suggestions_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "geo_areas"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "geo_areas" ADD CONSTRAINT "geo_areas_level_check" CHECK ("level" BETWEEN 1 AND 5);
ALTER TABLE "geo_suggestions" ADD CONSTRAINT "geo_suggestions_status_check" CHECK ("status" IN ('pending', 'approved', 'rejected'));
