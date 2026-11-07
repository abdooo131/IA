-- Locations are dark stores or hubs (sorting facilities). Existing rows stay dark stores.

-- CreateEnum
CREATE TYPE "location_kind" AS ENUM ('dark_store', 'hub');

-- AlterTable
ALTER TABLE "dark_stores" ADD COLUMN     "kind" "location_kind" NOT NULL DEFAULT 'dark_store';

