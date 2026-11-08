-- A sales proposal can also quote next day parcels (Shiply); confirming it puts these terms in
-- the contract version (docs/MERGE.md step 6).
ALTER TABLE "crm_proposals" ADD COLUMN     "includes_parcels" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "parcel_cod_fee_bp" INTEGER,
ADD COLUMN     "parcel_discount_bp" INTEGER,
ADD COLUMN     "parcel_return_fee_bp" INTEGER;

ALTER TABLE "crm_proposals" ADD CONSTRAINT "crm_proposals_parcels" CHECK (
  COALESCE("parcel_discount_bp", 0) BETWEEN 0 AND 10000
  AND COALESCE("parcel_cod_fee_bp", 0) BETWEEN 0 AND 10000
  AND COALESCE("parcel_return_fee_bp", 0) BETWEEN 0 AND 10000
);
