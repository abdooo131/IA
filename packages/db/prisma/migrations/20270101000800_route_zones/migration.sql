-- Shiply prices by route (owner, 2026-11-08): seven zones from the pickup city to the delivery
-- city. "Same city" is new; Red Sea and Sinai join the remote zone. Governorates keep their
-- region; the route's zone is worked out at booking (apps/api/src/parcels/merchant/pricing.ts).
INSERT INTO "pricing_zones" ("code", "name", "transit_days", "price_s", "price_m", "price_l", "price_xl", "price_xxl", "price_bulky")
VALUES ('SAME', 'Same city', 1, 4000, 5000, 6500, 9000, 13000, 18000)
ON CONFLICT ("code") DO NOTHING;

UPDATE "pricing_zones" SET "name" = 'Greater Cairo' WHERE "code" = 'GC';
UPDATE "pricing_zones" SET "name" = 'Canal and Suez' WHERE "code" = 'CANAL';
UPDATE "pricing_zones" SET "name" = 'Remote: Red Sea, Sinai, Matrouh, New Valley' WHERE "code" = 'REMOTE';

UPDATE "governorates" SET "zone_code" = 'REMOTE' WHERE "zone_code" = 'RED_SEA';

-- Prices set for Red Sea and Sinai move to the remote zone where it has none; the rest go.
UPDATE "merchant_prices" mp SET "zone_code" = 'REMOTE'
WHERE mp."zone_code" = 'RED_SEA'
  AND NOT EXISTS (SELECT 1 FROM "merchant_prices" x WHERE x."merchant_id" = mp."merchant_id" AND x."zone_code" = 'REMOTE' AND x."size" = mp."size");
DELETE FROM "merchant_prices" WHERE "zone_code" = 'RED_SEA';

-- The old zone goes only when no contract version names it (versions are frozen once active).
DELETE FROM "pricing_zones" z
WHERE z."code" = 'RED_SEA'
  AND NOT EXISTS (SELECT 1 FROM "merchant_contract_version_parcel_prices" p WHERE p."zone_code" = 'RED_SEA');
