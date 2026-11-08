-- Shiply (the parcel network) becomes an app with its own access level. Everyone starts with
-- the level they have on Shiply Now's operations when they work across all stores (office
-- roles), as the job role templates do; store roles start with none.
ALTER TABLE "user_access" ADD COLUMN "shiply" "access_level" NOT NULL DEFAULT 'none';
UPDATE "user_access" SET "shiply" = "operations" WHERE "all_stores";
