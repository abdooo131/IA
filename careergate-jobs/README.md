# Career Gate

A bilingual (English and Arabic) job board and hiring back office for an Egyptian recruitment agency. Built with Laravel 13, runs on ordinary shared hosting (PHP 8.3, MySQL 8, cron). No Node, Redis or Docker needed on the server.

## What it does

**Public site**

* Job list and job pages in English (`/jobs`) and Arabic (`/ar/jobs`), with right to left layout and the Cairo font.
* Apply form for candidates: phone number (one profile per phone), CV as one PDF or 1 to 4 photos (up to 10 MB each, or less if the host limits it; phone photos are shrunk in the browser).
* About page.

**Back office (`/admin`, English or Arabic, per user)**

* Dashboard, jobs, client companies, applicants per job, and an application page with the CV viewer.
* Pipeline stages: new, reviewed, shortlisted, sent to client, interview, hired, rejected; internal comments and stage history.
* Talent pool search across all applicants, and adding an existing applicant to another job.
* Shortlist exports for clients (comments and history are never included).
* Team management with roles: `admin` (team, permanent deletes) and `recruiter`. Invitations are bilingual emails with a 7 day link.

**Housekeeping (scheduled, Africa/Cairo time)**

* Close expired jobs, nightly database backup (kept 14 days), prune old exports, delete applicants never hired after 2 years, run queued exports.

## Deploying

Follow the step by step guide: **[docs/deployment.md](docs/deployment.md)**. It covers Hostinger style hosting from PHP setup to the cron job, backups, updates and moving to a real domain.

## Local development

```bash
composer install
npm install
cp .env.example .env && php artisan key:generate
touch database/database.sqlite && php artisan migrate
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=change-me-please php artisan db:seed --class=AdminUserSeeder
npm run build        # compiled files in public/build are committed, so the server needs no Node
php artisan serve
```

Run the tests with `php artisan test`.

After changing CSS or JavaScript, run `npm run build` and commit the changes in `public/build`.

## Project notes

* Public routes exist once and are registered for both languages (`routes/web.php`); admin routes are in `routes/admin.php`.
* The queue uses the `database` driver and is drained once a minute by the scheduler, so a single cron line is enough.
* Security headers (`X-Frame-Options: SAMEORIGIN`, `nosniff`, referrer and permissions policy) are added to every response; `/admin` is also marked `noindex`.
* `TRUSTED_PROXIES` is only needed behind a proxy such as Cloudflare (see the guide).
