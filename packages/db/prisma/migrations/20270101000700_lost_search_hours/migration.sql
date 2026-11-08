-- The owner's rule (2026-11-08): a parcel is searched for 24 hours, then a person confirms the
-- loss. Databases still on the old default (48) move to 24; an edited value is kept.
UPDATE "settings" SET "value" = '24'::jsonb WHERE "key" = 'parcels.lost.search_hours' AND "scope" = 'global' AND "value" = '48'::jsonb;
