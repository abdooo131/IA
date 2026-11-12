# Backups and restore

Two layers protect the data.

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
| `BACKUP_DATABASE_URL` | the Neon **direct** connection string (not the pooled one), ending in `?sslmode=require` |
| `BACKUP_PASSPHRASE` | a long random passphrase. Store it in your password manager too: without it no backup can be opened |

Then **Actions**, **Database backup**, **Run workflow** once to check it turns green.

The workflow runs from the default branch, so it starts nightly once this file is on `main`.

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
