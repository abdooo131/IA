# Career Gate Hiring System: Design

Date: 2026/11/24
Status: draft for approval

## 1. Intent and why

Career Gate is an Egyptian recruitment agency that fills jobs for client
companies (example: "Warehouse Operations Associate", Nasr City, Cairo).
Today jobs are announced as Facebook posts and applicants send their CV
over WhatsApp. CVs end up scattered across chats, and there is no single
place to see who applied to what, who is shortlisted, or why.

The system **replaces WhatsApp as the way people apply**. It has two sides:

* **Public website**: job seekers browse open jobs and apply with a CV.
* **Back office**: the Career Gate team posts jobs, reviews applicants and
  CVs, moves them through hiring stages, and leaves internal comments.

Success: every Facebook job post links to the website instead of a
WhatsApp number, and the team runs all screening from the back office.

## 2. Goals, non goals, anti goals

**Goals (phase 1)**
* Public job list and job detail pages, each job with its own shareable link.
* Mobile friendly application form with required CV upload.
* Back office for 5 team members: jobs, applicants, CV viewing, stages,
  internal comments, filtering, export of a shortlist to send to a client.
* Talent pool: search everyone who ever applied, across all jobs, and add a
  past applicant to another job without them applying again.
* Data retention in line with Egypt's Personal Data Protection Law 151/2020.
* English and Arabic across the whole system, English by default.
* Career Gate branding (assets in the `careergate-brand` kit).

**Later phases (design must not block them)**
* Phase 2: client company logins to review the shortlists prepared for them.
* Phase 3: automatic WhatsApp messages to applicants when their stage changes.
* Real domain name (system starts on the host's temporary address).

**Non goals (phase 1)**
* No native mobile app. It is a website opened in a browser.
* No applicant accounts or logins. Applicants just fill in a form.
* No messaging to applicants from the system.
* No manual entry of applicants by the team. WhatsApp is fully replaced:
  every applicant applies through the website.

**Anti goals (failure even if it "works")**
* Internal comments or stage history ever visible to applicants or clients,
  or included in a client export.
* Applying is harder than sending a WhatsApp message: slow pages on phone
  data, long forms, or uploads that fail for phone photos.
* CV files reachable by anyone who guesses a URL.

## 3. Constraints

* **Hosting**: shared web hosting the owner will buy (recommended:
  Hostinger Business or equivalent: PHP 8.2+, MySQL 8, SSH, cron, free SSL).
  No Node.js process, no Docker, no long running workers on the server.
* **Cost**: only the hosting plan. No paid third party services in phase 1.
* **Users**: about 5 team members. Applicant volume: hundreds per job is
  possible for entry level roles.
* **Devices**: most applicants on Android phones, often on mobile data.
* **Languages**: English (default) and Arabic. Arabic must render right to left.

## 4. Approaches considered

1. **Laravel + MySQL on shared hosting (chosen).** One codebase, one host,
   database and CV files stored on the host (typically 50 to 100 GB).
   Fits the owner's plan to buy hosting; cheap; no extra services.
2. **Next.js on Vercel + Supabase (free tier).** Free, but only about 1 GB
   of file storage and three services to manage. Dropped once the owner
   chose to buy hosting.
3. **Google Forms + Sheets + Drive.** Fast and free but not a real system;
   stages, comments and shortlists become spreadsheet work. Dropped.

Also considered: Render + Neon (free tier sleeps, slow first load for
applicants) and a VPS (needs ongoing maintenance). Both dropped.

## 5. What the owner decided

* Phase 1 is team only; clients get logins in phase 2.
* CV is **required** for every application, as PDF or image.
* Stages: **New → Reviewed → Shortlisted → Sent to client → Interview → Hired**,
  plus **Rejected** reachable from any stage.
* Comments and stage history are **internal only**.
* WhatsApp notifications come in a later phase.
* English is the default language; Arabic is available everywhere.
* No domain yet; start on the host's temporary address.
* Laravel + MySQL on shared hosting.
* Team of 5.
* No manual applicant entry; WhatsApp is fully replaced as the way to apply.
* Talent pool across all jobs: yes.
* Retention: jobs with applicants can only be closed, not deleted; an Admin
  can permanently delete an applicant on request; CVs of applicants never
  hired are deleted automatically after 2 years.

## 5b. Calls made by the designer (owner to check)

* Roles: Admin (team management, permanent deletes) and Recruiter (everything else).
* Back office language English by default with Arabic available (owner said
  English default everywhere).
* No self service CV replacement: a repeat application to the same job shows
  "you already applied"; only the team can replace a CV.
* Language lives in the URL (`/jobs/{slug}` English, `/ar/jobs/{slug}` Arabic)
  so Arabic Facebook posts open and preview in Arabic. The "copy link" button
  offers both.
* Jobs with a closing date close automatically at the end of that day (Cairo time).
* Stages can be changed to any stage, not only the next one.
* Images compressed in the browser before upload (also converts HEIC to JPG).
* Date of birth collected, optional; filterable by age range.
* Latest supported Laravel release, not Laravel 11.
* Large exports (CV ZIPs) built in the background by the cron driven queue and
  offered for download when ready.

## 6. Design

### 6.1 Tech stack (builder's call, stated here)

* Latest supported Laravel release (PHP 8.2+), MySQL 8.
* Server rendered Blade pages with Tailwind CSS (built locally, compiled CSS
  committed, so no Node on the server) and Alpine.js for small interactions.
* Laravel's built in auth for team logins. No external auth service.
* Laravel localization files for English and Arabic; `dir="rtl"` and an
  Arabic font (Cairo) when Arabic is active.
* File storage on the local private disk (outside the public web root).
* Image compression with Intervention Image (GD, available on shared hosts).
* Queue driver `sync` or `database` processed by cron, since shared hosts
  can't run persistent workers.

### 6.2 Data model

* **ClientCompany**: name, contact person, phone, email, notes.
  Every job belongs to one. Exists now so phase 2 client logins slot in.
* **Job**: client_company_id, title_en, title_ar, location (city, area),
  employment type (full time, part time, shift based), salary text
  (optional, free text, e.g. "8,000 EGP + incentives"), responsibilities
  (en, ar), requirements (en, ar), extra application questions (optional,
  see 6.4), show_client_name (yes/no, default no), status (draft, open,
  closed), closing date (optional), slug for the public link, created_by.
  If Arabic text is empty, the English text is shown, and vice versa.
* **Applicant**: full name, phone (WhatsApp number, Egyptian format,
  stored normalized as +20...), email (optional), city/area, date of birth
  (optional).
  One Applicant per phone number, so the team can see when the same
  person applied to several jobs.
* **Application**: job_id, applicant_id, stage, answers to the job's extra
  questions, source (applied / added from talent pool), added_by (user,
  when added from the pool), created_at. One application per applicant per job.
  An application added from the pool reuses the applicant's latest CV.
* **CvFile**: application_id, original name, stored path, mime type, size,
  page order. One PDF, or 1 to 4 images. When the team replaces a CV the old
  files are kept and marked replaced, visible in the application history.
* **StageChange**: application_id, from, to, user_id, timestamp. Internal.
* **Comment**: application_id, user_id, body, timestamp. Internal.
* **User (team)**: name, email, password, role (admin, recruiter),
  language preference, active flag.

### 6.3 Public website

Pages (all bilingual, language switch in the header, remembered per browser):

* **Home / Jobs list**: Career Gate banner, list of open jobs as cards
  (title, location, employment type, posted date). Filter by city and
  search by title. Closed jobs disappear from the list.
* **Job detail** (`/jobs/{slug}`): full description in the current language,
  big "Apply now" button. If the job is closed, a clear "This job is no
  longer accepting applications" message and a link to other open jobs.
  Proper Open Graph tags so Facebook link previews show the job title and
  Career Gate image.
* **Apply form** (on the job page or its own step):
  * Full name, phone (WhatsApp), email (optional), city/area.
  * Any extra questions defined for this job.
  * CV upload: one PDF up to 10 MB, or up to 4 images (JPG, PNG, HEIC
    converted where possible) up to 10 MB each, with the option to take a
    photo directly with the phone camera.
  * Consent checkbox: "I agree that Career Gate stores my CV and shares it
    with employers for this and similar jobs."
  * Spam protection: honeypot field + rate limit per IP and per phone
    (no external CAPTCHA service needed).
* **Thank you page**: confirmation, the job title, and a link to other jobs.
  If the same phone already applied to this job, show "You already applied
  to this job" instead of creating a duplicate. Applicants cannot replace a
  CV themselves (anyone typing their number could overwrite it); the team
  can replace it from the back office.
* **About / Contact**: short page with Career Gate info and the Facebook link.

Performance target: job list and job pages load fast on 3G; no heavy
scripts; images optimized.

### 6.4 Back office (`/admin`)

* **Login** with email and password; "forgot password" by email.
* **Dashboard**: open jobs with counts per stage, newest applications.
* **Jobs**: list, create, edit, duplicate (to reuse a previous post),
  open/close. Delete (admin only) is allowed only while a job has no
  applications; otherwise it can only be closed. Editor has English and Arabic tabs.
  Optional extra questions per job: short text, yes/no, or choice list
  (e.g. "Do you live in Nasr City or nearby?").
  Shows the public link with a "copy link" button for Facebook posts.
* **Client companies**: list, create, edit.
* **Applicants for a job**: table with name, phone, area, stage, applied
  date, comment count. Filter by stage, area, date; search by name or phone.
  Bulk actions: change stage for selected applicants.
* **Application page**: applicant details, answers, CV viewer in the page
  (PDF inline, images in a gallery) with download, current stage with
  buttons to move it, stage history, internal comments thread, and "other
  applications by this person" list.
* **Click to WhatsApp** button on each applicant (opens wa.me with their
  number) so the team can contact them manually until phase 3. Outgoing
  contact only; applications never come in through WhatsApp.
* **Talent pool**: one screen listing every applicant across all jobs.
  Search by name or phone; filter by area, age range, stage reached, jobs
  applied to, applied date. From an applicant, "Add to job" creates an
  application on any open job (stage New, source = talent pool), reusing
  their latest CV. Consent text covers "this and similar jobs".
* **Delete applicant (admin only)**: permanently removes the applicant, all
  their applications, comments, stage history and CV files, after a typed
  confirmation. Used when someone asks to be removed.
* **Export shortlist**: for a job, choose stages (default: Shortlisted),
  download an Excel file (name, phone, area, answers, stage) plus a ZIP of
  their CVs. Comments and stage history are never included.
* **Team (admin only)**: add, deactivate users, set role.

Roles (my proposal, owner may change):
* **Admin**: everything, including team management and deleting jobs.
* **Recruiter**: everything else: jobs, client companies, applicants,
  stages, comments, exports.

### 6.5 Security and privacy

* CV files stored outside the web root; served only through an
  authenticated controller to logged in team members.
* Uploads validated by real file type, not just extension; filenames
  replaced with random names.
* HTTPS (free SSL from the host). CSRF protection, password hashing,
  login rate limiting (all Laravel defaults).
* Retention: a scheduled daily task permanently deletes applicants (and
  their CV files) whose most recent application is older than 2 years and
  who never reached the Hired stage. Hired applicants are kept. The period
  is a setting.
* Daily database backup via cron to a separate folder on the host, plus
  the host's own backups. Owner to download a copy periodically.

### 6.6 Phase 2 and 3 readiness

* Every job already belongs to a ClientCompany, so phase 2 adds a `client`
  role scoped to its company and a read/approve view of the stages from
  "Sent to client" onward, with comments hidden.
* StageChange events are recorded in one place, so phase 3 can attach a
  WhatsApp notification to each stage change without touching the rest.

### 6.7 Deployment

* Code in its own GitHub repository (`careergate-jobs`, to be created).
* Deploy to shared hosting over SSH: git pull, `composer install --no-dev`,
  `php artisan migrate --force`, cache config/routes/views. Public folder
  pointed at Laravel's `public/` (or symlinked into `public_html`).
* Cron entry every minute for Laravel's scheduler (backups, queued jobs).
* A short written guide for the owner covering the hosting setup.

## 7. Left to the builder

* Exact page layouts and visual design within the Career Gate brand kit.
* Exact field validation messages and wording (both languages).
* Package choices beyond those named above (e.g. Excel export library).
* Test strategy (feature tests for apply flow, auth, CV access control,
  exports at minimum).
