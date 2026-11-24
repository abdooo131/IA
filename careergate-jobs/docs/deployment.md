# Career Gate deployment guide

This guide puts Career Gate on shared hosting such as **Hostinger Business** (PHP 8.3, MySQL 8, SSH, cron, free SSL). It is written for the owner, step by step, with the exact commands to copy. You do not need Node or any developer tools on the server.

**How long it takes:** about 45 minutes the first time.

**What you need before you start**

* A Hostinger Business (or similar) hosting plan with SSH access.
* The domain (or the temporary Hostinger address) the site will live on.
* An email account you can send from (for example `jobs@yourdomain.com`, created in hPanel under Emails). It is used for team invitations, password resets and backup alerts.
* Access to the GitHub repository that holds the code (`https://github.com/abdooo131/IA`). If it is private you will need a GitHub personal access token (GitHub, Settings, Developer settings, Personal access tokens, "Fine-grained tokens": choose only this one repository and give it read-only "Contents" access). Use the token as the password when `git clone` asks for one.

Anything in `UPPER_CASE_LIKE_THIS` or `yourdomain.com` is a placeholder that you replace with your own value.

---

## 1. Choose PHP 8.3 and switch on the extensions

1. Log in to **hPanel**, open **Websites**, click **Manage** next to your domain.
2. Open **Advanced**, then **PHP Configuration**.
3. On the **PHP version** tab choose **PHP 8.3** (8.4 also works) and save.
4. On the **PHP extensions** tab make sure these are ticked, then save:
   `pdo_mysql`, `mbstring`, `intl`, `fileinfo`, `gd`, `zip` (the usual ones such as `openssl`, `curl`, `xml`, `ctype`, `json` are already on).
5. On the **PHP options** tab you may see `upload_max_filesize` and `post_max_size`. Set `upload_max_filesize` to **12M** and `post_max_size` to **50M**. (The file `public/.user.ini` in the project asks for the same values and also sets `max_execution_time=120` and `memory_limit=256M`; if hPanel shows lower numbers, hPanel wins.)

> The apply form tells candidates the real upload limit automatically: the smaller of 10 MB and what your hosting allows. If your host only allows 2 MB, candidates will see "2 MB", not a false promise of 10 MB.

## 2. Create the MySQL database

1. In hPanel go to **Databases**, then **Management** (MySQL Databases).
2. Create a database, a user and a strong password. Hostinger adds a prefix, so you will end up with names like `u123456789_careergate` (database) and `u123456789_cguser` (user).
3. **Write down the three values**: database name, user name, password. The host is `localhost`.

## 3. Connect over SSH

1. In hPanel go to **Advanced**, then **SSH Access**, and switch SSH **on**. Note the **IP, port, and user name** it shows (the port is usually `65002`).
2. From your computer (Mac or Linux Terminal, or Windows PowerShell):

```bash
ssh -p 65002 u123456789@YOUR_SERVER_IP
```

Type the SSH password when asked. You are now on the server, in your home folder (`~`).

3. Check PHP and Composer. The first command must say **8.3** (or higher):

```bash
php -v
composer --version
```

If `composer` is not found, try `composer2`, or ask Hostinger support for the full path (use it in place of `composer` below).

If `php -v` shows an older version, ask Hostinger support to set the command line PHP to 8.3, or use the full path they give you (for example `/opt/alt/php83/usr/bin/php`) in place of `php` in every command below **and in the cron line in step 10**.

## 4. Download the code

The application lives in the **`careergate-jobs/`** folder *inside* the git repository (the repository also holds planning documents). We clone the whole repository once, then make a short link so the app is at `~/careergate-jobs`.

```bash
cd ~
git clone https://github.com/abdooo131/IA.git careergate-repo
ln -s ~/careergate-repo/careergate-jobs ~/careergate-jobs
cd ~/careergate-jobs
ls
```

You should see `app`, `artisan`, `composer.json`, `public` and more. If `ls` shows `careergate-jobs` instead, you are one folder too high.

The compiled design files (`public/build`) are already part of the repository, so no Node is needed.

## 5. Install the PHP packages

```bash
cd ~/careergate-jobs
composer install --no-dev --optimize-autoloader
```

## 6. Create and fill the `.env` file

```bash
cp .env.example .env
php artisan key:generate --force
nano .env
```

`nano` is a simple editor: arrow keys to move, type to edit, **Ctrl+O** then **Enter** to save, **Ctrl+X** to leave. Set these values (replace the placeholders; leave other lines alone):

```dotenv
APP_NAME="Career Gate"
APP_ENV=production
APP_DEBUG=false
LOG_LEVEL=error
SESSION_SECURE_COOKIE=true
APP_URL=https://yourdomain.com
APP_TIMEZONE=Africa/Cairo

DB_CONNECTION=mysql
DB_HOST=localhost
DB_PORT=3306
DB_DATABASE=u123456789_careergate
DB_USERNAME=u123456789_cguser
DB_PASSWORD=THE_DATABASE_PASSWORD

SESSION_DRIVER=database
CACHE_STORE=database
FILESYSTEM_DISK=local
QUEUE_CONNECTION=database
DB_QUEUE_RETRY_AFTER=360

# Email (needed for team invitations, password resets and backup alerts).
# Hostinger example; use the email account you created:
MAIL_MAILER=smtp
MAIL_HOST=smtp.hostinger.com
MAIL_PORT=465
MAIL_SCHEME=smtps
MAIL_USERNAME=jobs@yourdomain.com
MAIL_PASSWORD=THE_EMAIL_PASSWORD
MAIL_FROM_ADDRESS=jobs@yourdomain.com
MAIL_FROM_NAME="Career Gate"
BACKUP_NOTIFY_EMAIL=owner@yourdomain.com

# The first admin account (created in step 7).
ADMIN_EMAIL=you@yourdomain.com
ADMIN_PASSWORD=A_LONG_PASSWORD_AT_LEAST_10_CHARACTERS
ADMIN_NAME="Your Name"

# Leave empty unless the site sits behind Cloudflare or a similar proxy (see below).
TRUSTED_PROXIES=
```

What the important ones mean:

| Setting | Why it matters |
| --- | --- |
| `APP_ENV=production`, `APP_DEBUG=false` | Hides technical error details from visitors. **Never** set `APP_DEBUG=true` on the live site. |
| `LOG_LEVEL=error`, `SESSION_SECURE_COOKIE=true` | Keeps the log small and makes login cookies travel only over https (turn SSL on first, step 9). |
| `APP_URL` | The exact address of the site, with `https://`. Used in email links. |
| `QUEUE_CONNECTION=database`, `DB_QUEUE_RETRY_AFTER=360` | Shortlist exports run in the background, started by the cron job in step 10. |
| `MAIL_*` | Without working email, invitations and password resets do not arrive. |
| `BACKUP_NOTIFY_EMAIL` | Where a "backup failed" alert is sent. |
| `ADMIN_*` | Used once, to create the first admin. |
| `TRUSTED_PROXIES` | See the box below. |

> **When to set `TRUSTED_PROXIES`.** Leave it empty if visitors connect straight to Hostinger. Set it only if you put **Cloudflare** (or another proxy) in front of the site. Without it, every visitor appears to come from the proxy's address, so the login "too many attempts" limit would count all visitors together. Behind a proxy, set `TRUSTED_PROXIES=*` (trust the proxy that is directly in front of you; only do this when *all* traffic really goes through the proxy) or list the proxy IP addresses separated by commas. Saving the change requires `php artisan optimize` (see "Updating").

## 7. Create the tables and the first admin

```bash
cd ~/careergate-jobs
php artisan migrate --force
php artisan db:seed --class=AdminUserSeeder --force
```

Make sure the folders the app writes to are writable:

```bash
chmod -R 775 storage bootstrap/cache
```

Once you have logged in successfully (step 12) it is a good idea to **delete the `ADMIN_PASSWORD=` line from `.env`**, then run `php artisan optimize`. The seeder never changes an existing admin, so it is not needed again.

## 8. Point the domain at the `public` folder

The website must be served from `careergate-jobs/public`, never from the project root (that would expose private files). Use **one** of these two methods.

### Method A: change the document root (cleanest)

In hPanel go to **Websites, Manage, Advanced, "Domain"/"Document root"** (the wording varies; look for *Change document root* or *Custom path*) and set it to:

```
careergate-jobs/public
```

(Some plans show the path as `/home/u123456789/careergate-jobs/public`.) Save.

### Method B: the `public_html` link

If hPanel will not let you change the document root, replace the `public_html` folder of the domain with a link to `public`. The domain folder is usually `~/domains/yourdomain.com/public_html` (on older plans just `~/public_html`):

```bash
cd ~/domains/yourdomain.com
mv public_html public_html_old
ln -s ~/careergate-jobs/public public_html
```

Check it worked: `ls public_html` must list `index.php`, `brand` and `robots.txt`. Keep `public_html_old` until the site works, then delete it.

## 9. Switch on SSL (https)

1. hPanel, **Security**, **SSL**.
2. Install the free SSL for your domain and switch on **Force HTTPS**.
3. Make sure `APP_URL` in `.env` starts with `https://`.

Then cache the configuration and check the site:

```bash
cd ~/careergate-jobs
php artisan optimize
```

Open `https://yourdomain.com/jobs` (English) and `https://yourdomain.com/ar/jobs` (Arabic). The back office is at `https://yourdomain.com/admin`.

## 10. The cron job (one line runs everything)

The system needs **one** cron entry that runs every minute. It starts the daily tasks (closing expired jobs, backups, cleaning old exports, deleting applicants after the retention period) and processes background jobs such as shortlist exports.

1. hPanel, **Advanced**, **Cron Jobs**.
2. Add a custom cron job, set every field to `*` (every minute), and use this command:

```
* * * * * cd ~/careergate-jobs && php artisan schedule:run >> /dev/null 2>&1
```

(Hostinger's form asks for the schedule and the command separately: schedule `* * * * *`, command `cd ~/careergate-jobs && php artisan schedule:run >> /dev/null 2>&1`. If your command line PHP needed a full path in step 3, use it instead of `php`.)

3. Check it is registered. This lists the daily tasks:

```bash
cd ~/careergate-jobs
php artisan schedule:list
```

Times are Cairo time: 00:05 close expired jobs, 02:00 backup, 02:30 clean exports, 03:00 purge applicants older than the retention period (2 years, never hired).

## 11. Backups

The database (all applicants, applications and notes, but not the CV files themselves) is backed up automatically every night at 02:00 and old backups are removed after **14 days**.

**Check that the server can make backups.** Backups use a program called `mysqldump`:

```bash
which mysqldump
mysqldump --version
```

Both should print something. Backups also need PHP to be allowed to run programs (`proc_open` and `exec` must not be disabled in hPanel, PHP Configuration, "Disabled functions"). If `which mysqldump` prints nothing, ask Hostinger support to enable `mysqldump` for your plan, or tell your developer: until it works, no backup is created.

**Try one backup now:**

```bash
cd ~/careergate-jobs
php artisan backup:run --only-db
php artisan backup:list
```

**Where the files are, and how to download one**

* Backups are `.zip` files in `careergate-jobs/storage/app/private/backups/`.
* Easiest download: hPanel, **Files**, **File Manager**, open that folder, right click the newest `.zip`, **Download**.
* Or from your own computer:

```bash
scp -P 65002 "u123456789@YOUR_SERVER_IP:careergate-jobs/storage/app/private/backups/*.zip" ~/Downloads/
```

**Please download a backup to your own computer or cloud drive at least once a week.** The automatic backups live on the same server as the site, so they do not help if the hosting account itself is lost.

> **Privacy notice.** Backups contain applicant personal data (names, phones, notes). Keep downloaded copies somewhere private. Backups are kept 14 days, so an applicant who is deleted (by hand or by the 2 year retention rule) **disappears from the backups within 14 days** as the older files are removed. CV files are not in these backups; they stay in `storage/app/private` on the server only.

## 12. First login checklist

Work through this list on the live site, ideally with your phone in your hand:

1. Open `https://yourdomain.com/admin` and **log in** with `ADMIN_EMAIL` and `ADMIN_PASSWORD`. Use the language button to try Arabic.
2. **Change your password** (log out, click "Forgot your password?", and follow the email). This also proves email works. If no email arrives within a few minutes, re-check the `MAIL_*` values.
3. **Add team members** on the **Team** page. Each person receives an English and Arabic email with a link, valid for 7 days, to choose their own password. Use **Resend invite** if a link expires.
4. **Add a client company** (Clients, Add client company).
5. **Post a job** for that client (Jobs, New). Set it to **open**.
6. **Apply to it yourself from your phone**: open the public job page, fill in the form, and try attaching a PDF and also taking a photo of a CV. Do this once in English and once in Arabic.
7. Back in the back office, check the **dashboard** shows the application, open the applicant, open the CV, and move them to a stage.
8. On the job's applicants list, shortlist yourself and **export the shortlist**. The file appears after a minute or two (the cron job prepares it).
9. Delete your test applicant (admins can delete applicants permanently) and set the test job to closed or delete it.
10. Run the backup test from step 11 and download the file once.

## 13. Updating the site later

When your developer tells you a new version is ready:

```bash
cd ~/careergate-repo
git pull
cd ~/careergate-jobs
composer install --no-dev --optimize-autoloader
php artisan migrate --force
php artisan optimize
php artisan queue:restart
```

(Optional but polite, to show visitors the "Back soon" page during the update: run `php artisan down` first and `php artisan up` at the end.)

**Never run** `php artisan migrate:fresh`, `migrate:rollback` or `db:wipe` on the live site: they erase data.

If something looks wrong after an update, clear the caches: `php artisan optimize:clear`, then `php artisan optimize`.

## 14. Moving to a real domain later

When you switch from the temporary Hostinger address to your own domain:

1. In hPanel add the domain to the hosting (or point the new domain's DNS to Hostinger) and give it the same document root as in step 8.
2. Install the free SSL for the new domain (step 9).
3. Edit `.env` and change `APP_URL` to the new address, for example `APP_URL=https://www.careergate.example`.
4. Refresh the settings:

```bash
cd ~/careergate-jobs
php artisan optimize:clear
php artisan optimize
```

5. If the cron job used the old domain's folder path, update it (the line in step 10 only uses `~/careergate-jobs`, so normally nothing changes).
6. Log in again on the new address. Invitation and reset emails now use the new address. Links already sent from the old address will stop working after you remove the old domain, so resend any pending invites.
7. Optionally redirect the old address to the new one in hPanel (**Domains, Redirects**).

## 15. If something goes wrong

| What you see | What to do |
| --- | --- |
| A branded "Something went wrong" page (500) | Look at the newest lines: `tail -n 50 ~/careergate-jobs/storage/logs/laravel.log`. Often a wrong `.env` value, or folders not writable: `chmod -R 775 storage bootstrap/cache`. |
| Plain "403/404" from the host on the home page | The document root is wrong (step 8). It must end in `careergate-jobs/public`. |
| Candidates say large CVs fail | Check the PHP limits in hPanel (step 1). The form already shows the real limit. |
| "Page expired" (419) after a long time on a form | Normal after 2 hours idle: go back, refresh, try again. |
| No emails | Test with `php artisan tinker --execute="Mail::raw('test', fn(\$m) => \$m->to('you@yourdomain.com')->subject('Test'));"` and re-check `MAIL_*`. |
| Exports never finish | The cron job is not running (step 10). Check hPanel, Cron Jobs. |
| Everyone is blocked after a few wrong logins | You are behind a proxy and `TRUSTED_PROXIES` is not set (step 6). |

Keep a safe copy of your `.env` file (it holds all passwords). It is not stored in git.
