-- Finance attachments chosen inside the form: receipts and documents (photos or PDF) are uploaded
-- first and wait unlinked until the form that names them is saved; the save links them in its
-- own transaction. A job deletes uploads still unlinked after a day.
ALTER TABLE "photos" ADD COLUMN "file_name" TEXT;
ALTER TABLE "photos" ADD COLUMN "unlinked" BOOLEAN NOT NULL DEFAULT false;

-- Receipts may be a PDF of up to 5 MB; every other photo keeps the 1.5 MB limit.
ALTER TABLE "photos" DROP CONSTRAINT "photos_size_limit";
ALTER TABLE "photos" ADD CONSTRAINT "photos_size_limit" CHECK (
  "size_bytes" > 0 AND ("size_bytes" <= 1500000 OR ("kind" = 'receipt' AND "size_bytes" <= 5242880))
);

CREATE INDEX "photos_unlinked_created_at_idx" ON "photos"("unlinked", "created_at");
