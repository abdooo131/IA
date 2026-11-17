# Backups and restore

Two layers protect the data. When files are kept in Cloudflare R2, a third one protects them
(section 3): the database copies below hold only the files still in the database.

## 1. Neon's own history (minutes to a day back)

Neon keeps a history of every change for its restore window (6 hours on the free plan,
longer on paid plans). To go back to a moment inside that window: Neon console, your
project, **Restore** (branch restore), pick the time, restore to a new branch first, check
it, then point Render's `DATABASE_URL` at it. Nothing to set up.

## 2. Daily encrypted copy (30 days back)

`.github/workflows/backup.yml` runs every night at about 03:17 Cairo time. It dumps the
database with `pg_dump`, checks the file can be read, encrypts it with AES 256 and keeps it
as a private workflow artifact for 30 days.

Set it up once, in GitHub: repository **Settings**, **Secrets and variables**, **Actions**:

| Secret | Value |
|---|---|
| `BACKUP_DATABASE_URL` | the Neon **direct** connection string (not the pooled one: its host has no `-pooler`) of the live database **`shiplynow_live`** (the database name at the end of the address must be `shiplynow_live`, not `neondb`), ending in `?sslmode=require` |
| `BACKUP_PASSPHRASE` | a long random passphrase. Store it in your password manager too: without it no backup can be opened |

Then **Actions**, **Database backup**, **Run workflow** once to check it turns green.

GitHub runs scheduled workflows only from the repository's **default branch**. The live
code is on `ShiplyNow`, so `ShiplyNow` must be the default branch (repository **Settings**,
**General**, **Default branch**); otherwise the nightly backup never starts. After changing
it, check the next morning that a **Database backup** run appeared.

A backup is only proven by a restore: after setting it up, and again every few months,
restore one copy into a throwaway Neon branch with the steps below and check it. A backup
that was never restored must be treated as untested.

## 3. Files in Cloudflare R2

Once R2 is configured (docs/DEPLOY.md), photos, receipts, proofs of transfer, signed contracts
and HR files are objects in the private R2 bucket, and their database rows only name them
(`storage = r2`, `storage_key`). `pg_dump` does not copy R2 objects, so the nightly database
copy holds the rows but not those bytes. They are protected this way:

* The app never overwrites or edits an object: every upload gets a new random key, and a
  replaced file is a new object.
* The app deletes an object only when no row has named it for `files.orphan_keep_days` (30 by
  default, as long as the nightly copies are kept), counted from the first hourly check that
  found it unused. So a database restored from any kept copy still finds every file it names.
  Keep this setting at least as long as the database copies are kept.
* Recommended: an R2 **bucket lock rule** on the whole bucket with a 30 day retention
  (bucket **Settings**, **Bucket lock rules**). Nobody, including a leaked token or a mistake,
  can then delete or overwrite an object younger than 30 days; the app leaves a delete the
  bucket refuses for a later run.
* Optional, for a copy outside the bucket: a second bucket (another account or location) filled
  by a scheduled copy, for example `rclone sync` with a read only token on the live bucket.
  Worth it once the files matter for audits (signed contracts, proofs of transfer); a bucket
  lock is enough for the pilot.

Restoring the database (below) with R2 configured: point the restored service at the same
bucket with the same four R2 values. Files younger than the copy are there (bucket lock and the
30 day wait); nothing has to be restored on the R2 side.

## Restoring a daily copy

1. GitHub, **Actions**, **Database backup**, the run you want, download `shiplynow-backup`
   and unzip it.
2. Decrypt (asks for the passphrase):

   ```
   gpg --decrypt --output shiplynow.dump shiplynow-<date>.dump.gpg
   ```

3. Create an empty database (a new Neon branch or project is best, so the current one stays
   untouched), then:

   ```
   pg_restore --no-owner --no-privileges --dbname="<new database url>" shiplynow.dump
   ```

4. Check it: sign in to a staging service pointed at the new database and look at today's
   orders and the finance trial balance.
5. Point Render's `DATABASE_URL` at the restored database and redeploy.

Delete the decrypted `shiplynow.dump` when done; it holds customer names and phone numbers.

The steps were checked on the local database: the restored copy had the same orders, stock
movements, ledger lines, zones (with valid map shapes) and products, and kept the
database triggers that make stock movements and the ledger append only.
