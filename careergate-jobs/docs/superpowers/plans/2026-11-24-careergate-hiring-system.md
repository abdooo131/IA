# Career Gate Hiring System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A bilingual (English default, Arabic) job board where applicants apply with a required CV, and a back office where the Career Gate team posts jobs, reviews CVs, moves applicants through stages, comments internally, searches a talent pool and exports shortlists.

**Architecture:** One Laravel 13 monolith with server rendered Blade pages, deployed to shared hosting (PHP + MySQL, no Node or workers on the server). CVs live on Laravel's private local disk and are only served through an authenticated controller. Background work (exports, auto close, retention, backups) runs from the scheduler via a once a minute cron with the `database` queue driver.

**Tech Stack:** Laravel 13, PHP 8.3+, MySQL 8 (SQLite in memory for tests), PHPUnit feature tests, Blade + Tailwind CSS 4 + Alpine.js (built locally with Vite, compiled assets committed), `intervention/image` (server side image checks), `heic2any` + `browser-image-compression` (client side), `openspout/openspout` (Excel), `spatie/laravel-backup` (DB backups).

**Spec:** `docs/superpowers/specs/2026-11-24-careergate-hiring-system-design.md`

**Location:** the Laravel app lives in the `careergate-jobs/` folder of the IA git repository (branch `claude/charming-edison-xv7p2z`). Run every command from `careergate-jobs/`; paths in this plan are relative to it. The brand kit is at `../careergate-brand/`.

## Global Constraints

* PHP 8.3+ (Laravel 13 floor; supersedes the spec's 8.2+), MySQL 8. No runtime dependency on Node, Redis, Docker or a long running process.
* No paid third party services; no external CAPTCHA.
* English is the default language everywhere; Arabic available everywhere with `dir="rtl"` and the Cairo font.
* Public URLs: English `/jobs/{slug}`, Arabic `/ar/jobs/{slug}`.
* Stages, in order: `new`, `reviewed`, `shortlisted`, `sent_to_client`, `interview`, `hired`, plus `rejected` from any stage. Any stage may move to any other stage.
* Comments and stage history are internal only: never on public pages, never in exports.
* CV required: one PDF up to 10 MB, or 1 to 4 images (JPG/PNG, HEIC converted to JPG in the browser) up to 10 MB each.
* Phone stored normalized as `+20` followed by 10 digits; one Applicant per phone; one Application per Applicant per job.
* Roles: `admin` (team management, permanent deletes) and `recruiter` (everything else).
* Retention: delete applicants never hired whose latest application is older than 2 years (setting `careergate.retention_months`, default 24).
* Timezone `Africa/Cairo`. Brand colors: yellow `#FEC401`, yellow light `#FFF3C4`, navy `#141F2D`, navy light `#24344A`, white.
* The queue `jobs` table name is reserved by Laravel; the job advert model is `JobPosting` (table `job_postings`).
* Brand assets come from the `careergate-brand` kit (logo variants, icons, favicon, cover).

## Review Focus

1. **Phone typed in Arabic digits or local formats** (`٠١٠١٢٣٤٥٦٧٨`, `01012345678`, `+20 101 234 5678`, `00201012345678`): all normalize to `+201012345678`, and the duplicate check treats them as the same person. Test in Task 2.
2. **Double tap on "Apply" / resubmitted form:** exactly one Application and one set of CV files is stored; the second request sees "already applied". Test in Task 5.
3. **Job closes between page load and submit** (manual close or closing date passed): submission is refused with the "no longer accepting applications" message and nothing is stored. Test in Task 5.
4. **Arabic names in exports:** Excel cells and ZIP entry names keep Arabic text intact (UTF-8), and two applicants with the same name don't overwrite each other in the ZIP. Test in Task 11.
5. **Host upload limits lower than 10 MB** (shared hosts often default `upload_max_filesize` to 2 MB to 64 MB): a too large upload gives a clear localized error instead of a blank page or 413, and the deployment guide sets the PHP limits. Test in Task 5; guide in Task 13.

---

## File Structure

```
app/Enums/{Stage,Role,JobStatus,EmploymentType,QuestionType}.php
app/Support/PhoneNumber.php                 phone normalization
app/Support/LocalizedRoute.php              helper for en/ar route URLs
app/Http/Middleware/{SetPublicLocale,SetAdminLocale,EnsureAdmin,EnsureActiveUser}.php
app/Models/{User,ClientCompany,JobPosting,Applicant,Application,CvFile,StageChange,Comment,Export}.php
app/Services/{ApplyService,CvStorage,StageService,TalentPoolQuery,ShortlistExporter}.php
app/Exceptions/{AlreadyAppliedException,JobClosedException}.php
app/Jobs/BuildShortlistExport.php
app/Console/Commands/{CloseExpiredJobs,PurgeExpiredApplicants}.php
app/Http/Controllers/Public/{JobController,ApplyController,PageController}.php
app/Http/Controllers/Admin/{DashboardController,JobPostingController,ClientCompanyController,ApplicationController,
    ApplicationStageController,CommentController,CvFileController,TalentPoolController,ApplicantController,
    ExportController,TeamController,LanguageController}.php
app/Http/Requests/{ApplyRequest,JobPostingRequest,...}.php
resources/views/layouts/{public,admin}.blade.php
resources/views/public/..., resources/views/admin/...
resources/js/{app.js,cv-upload.js}
lang/{en,ar}/{public,admin,stages,validation}.php
config/careergate.php
public/brand/...                            copied from careergate-brand kit
docs/deployment.md
tests/Feature/... , tests/Unit/...
```

---

### Task 1: Project scaffold, branding and layouts

**Files:**
* Create: Laravel 13 skeleton via `composer create-project laravel/laravel . "^13.0"`
* Create: `config/careergate.php`, `public/brand/*`, `resources/views/layouts/public.blade.php`, `resources/views/layouts/admin.blade.php`, `resources/css/app.css`, `app/Http/Middleware/SetPublicLocale.php`, `app/Support/LocalizedRoute.php`, `lang/en/public.php`, `lang/ar/public.php`, `lang/ar/validation.php`
* Modify: `config/app.php` (timezone `Africa/Cairo`, locale `en`, fallback `en`), `bootstrap/app.php`, `routes/web.php`, `phpunit.xml` (sqlite `:memory:`)
* Test: `tests/Feature/LocaleRoutingTest.php`

**Interfaces:**
* Produces: `config('careergate.locales') === ['en','ar']`, `config('careergate.retention_months') === 24`, `config('careergate.cv.max_kb') === 10240`, `config('careergate.cv.max_images') === 4`.
* Produces: `LocalizedRoute::url(string $name, array $params = [], ?string $locale = null): string` (Arabic routes are the same names prefixed `ar.`); Blade helper `@lroute(...)` is not needed, call the class.
* Produces: `SetPublicLocale` middleware sets `app()->setLocale()` from the first URL segment (`ar` → `ar`, otherwise `en`).
* Produces: layouts with `@yield('title')`, `@yield('content')`, `<html lang dir>` set from locale, header with logo (light bg variant), language switch linking to the same page in the other language, favicon, Open Graph section `@stack('meta')`.

- [ ] **Step 1: Scaffold** the project in the repo root (keep existing `docs/`), copy brand kit `logo/*`, `icon/*`, `social/facebook-cover-1920x640.png` into `public/brand/`, add Tailwind 4 theme colors `cg-yellow`, `cg-yellow-light`, `cg-navy`, `cg-navy-light` and fonts (Inter/Cairo via Google Fonts).
- [ ] **Step 2: Write the failing test**

```php
public function test_english_and_arabic_home_render_with_direction(): void
{
    $this->get('/jobs')->assertOk()->assertSee('lang="en"', false)->assertSee('dir="ltr"', false);
    $this->get('/ar/jobs')->assertOk()->assertSee('lang="ar"', false)->assertSee('dir="rtl"', false);
}
public function test_root_redirects_to_jobs(): void
{
    $this->get('/')->assertRedirect('/jobs');
    $this->get('/ar')->assertRedirect('/ar/jobs');
}
public function test_language_switch_links_to_same_page_other_language(): void
{
    $this->get('/jobs')->assertSee('href="'.url('/ar/jobs').'"', false);
}
```

- [ ] **Step 3: Run** `php artisan test --filter=LocaleRoutingTest` → FAIL (404).
- [ ] **Step 4: Implement** route groups (`/` and `/ar` prefix with `as('ar.')`), middleware, layouts, a placeholder `public.jobs.index` view.
- [ ] **Step 5: Run** `php artisan test` → PASS. Run `npm run build` and commit `public/build`.
- [ ] **Step 6: Commit** `git commit -m "feat: scaffold Laravel app with Career Gate branding and locale routing"`

### Task 2: Domain model, enums and phone normalization

**Files:**
* Create: enums, migrations, models and factories for `ClientCompany`, `JobPosting`, `Applicant`, `Application`, `CvFile`, `StageChange`, `Comment`, `Export`; modify `users` migration/model; `app/Support/PhoneNumber.php`
* Test: `tests/Unit/PhoneNumberTest.php`, `tests/Feature/DomainModelTest.php`

**Interfaces:**
* Produces enums (string backed): `Stage { New='new', Reviewed='reviewed', Shortlisted='shortlisted', SentToClient='sent_to_client', Interview='interview', Hired='hired', Rejected='rejected' }` with `label(): string` (from `lang/*/stages.php`) and `static ordered(): array`; `Role { Admin='admin', Recruiter='recruiter' }`; `JobStatus { Draft, Open, Closed }`; `EmploymentType { FullTime='full_time', PartTime='part_time', Shift='shift' }`; `QuestionType { Text='text', YesNo='yes_no', Choice='choice' }`.
* `User`: `role` (Role cast), `locale` (`en`|`ar`, default `en`), `is_active` (bool, default true); `isAdmin(): bool`.
* Factories: `User::factory()->admin()`, `->recruiter()` (default recruiter); `JobPosting::factory()->open()`; `CvFile::factory()->pdf()` (writes a real fake file to the `local` disk); all models have factories so `has*()` relations work.
* `ApplyService` sets `Applicant.consented_at` on every application.
* `ClientCompany`: `name, contact_person, phone, email, notes`; `jobPostings(): HasMany`.
* `JobPosting`: `client_company_id, title_en, title_ar, city, area, employment_type, salary_text, responsibilities_en, responsibilities_ar, requirements_en, requirements_ar, questions (json array of {id, type, label_en, label_ar, options_en[], options_ar[], required}), show_client_name (bool), status (JobStatus), closes_on (date, nullable), slug (unique), created_by`.
  Methods: `localized(string $field, ?string $locale = null): ?string` (falls back to the other language when empty); `isAcceptingApplications(): bool` (status open and `closes_on` null or today or later, Cairo time); `scopeOpen($q)`; `publicUrl(string $locale = 'en'): string`; slug auto generated from `title_en` + short random suffix on create.
* `Applicant`: `full_name, phone (unique), email, city, area, date_of_birth (nullable date), consented_at`; `applications(): HasMany`; `latestApplication(): HasOne`; `age(): ?int`; `wasEverHired(): bool`.
* `Application`: `job_posting_id, applicant_id, stage (Stage, default new), answers (json), source ('applied'|'talent_pool'), added_by (nullable user)`; unique (`job_posting_id`, `applicant_id`); `cvFiles(): HasMany` (current only, `replaced_at` null), `allCvFiles()`, `stageChanges()`, `comments()`.
* `CvFile`: `application_id, original_name, path, mime, size, position, replaced_at (nullable), replaced_by (nullable)`.
* `StageChange`: `application_id, from_stage (nullable), to_stage, user_id (nullable), created_at`.
* `Comment`: `application_id, user_id, body`.
* `Export`: `user_id, job_posting_id, stages (json), status ('pending'|'ready'|'failed'), xlsx_path, zip_path, error`.
* `PhoneNumber::normalize(string $input): ?string` returns `+20` + 10 digits for Egyptian mobiles (prefix 10, 11, 12, 15), else null.

- [ ] **Step 1: Write failing tests**

```php
/** @dataProvider egyptianNumbers */
public function test_normalizes_egyptian_mobile(string $in): void
{
    $this->assertSame('+201012345678', PhoneNumber::normalize($in));
}
public static function egyptianNumbers(): array
{
    return [['01012345678'], ['+201012345678'], ['00201012345678'], ['201012345678'],
            ['+20 101 234 5678'], ['010-1234-5678'], ['٠١٠١٢٣٤٥٦٧٨'], ['۰۱۰۱۲۳۴۵۶۷۸']];
}
public function test_rejects_non_mobile_numbers(): void
{
    foreach (['0223456789', '0131234567', '12345', '', '+1 555 123 4567'] as $bad) {
        $this->assertNull(PhoneNumber::normalize($bad), $bad);
    }
}
```

```php
public function test_localized_falls_back_to_other_language(): void
{
    $job = JobPosting::factory()->create(['title_en' => 'Warehouse Associate', 'title_ar' => null]);
    $this->assertSame('Warehouse Associate', $job->localized('title', 'ar'));
}
public function test_is_accepting_applications(): void
{
    $this->travelTo(Carbon::parse('2026-12-10 23:30', 'Africa/Cairo'));
    $this->assertTrue(JobPosting::factory()->open()->create(['closes_on' => '2026-12-10'])->isAcceptingApplications());
    $this->assertFalse(JobPosting::factory()->open()->create(['closes_on' => '2026-12-09'])->isAcceptingApplications());
    $this->assertFalse(JobPosting::factory()->create(['status' => JobStatus::Closed])->isAcceptingApplications());
    $this->assertFalse(JobPosting::factory()->create(['status' => JobStatus::Draft])->isAcceptingApplications());
}
public function test_one_application_per_applicant_per_job(): void
{
    $app = Application::factory()->create();
    $this->expectException(QueryException::class);
    Application::factory()->create(['job_posting_id' => $app->job_posting_id, 'applicant_id' => $app->applicant_id]);
}
public function test_slug_is_unique_for_same_title(): void
{
    $a = JobPosting::factory()->create(['title_en' => 'Driver']);
    $b = JobPosting::factory()->create(['title_en' => 'Driver']);
    $this->assertNotSame($a->slug, $b->slug);
    $this->assertStringStartsWith('driver-', $a->slug);
}
```

- [ ] **Step 2: Run** `php artisan test --filter='PhoneNumberTest|DomainModelTest'` → FAIL.
- [ ] **Step 3: Implement** enums, migrations (foreign keys `cascadeOnDelete` from Application, CvFile, StageChange, Comment; `restrictOnDelete` from Application to JobPosting), models, factories (with `open()` state), `PhoneNumber` (map Arabic Indic `٠-٩` and Persian `۰-۹` digits to ASCII, strip non digits, strip leading `0020`/`20`/`0`, require `^1[0125]\d{8}$`).
- [ ] **Step 4: Run** tests → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: add domain model, stages and phone normalization"`

### Task 3: Team authentication, roles and admin shell

**Files:**
* Create: `app/Http/Middleware/{EnsureAdmin,EnsureActiveUser,SetAdminLocale}.php`, `app/Http/Controllers/Admin/{TeamController,LanguageController}.php`, auth views under `resources/views/admin/auth/`, `resources/views/admin/team/*`, `lang/{en,ar}/admin.php`, `database/seeders/AdminUserSeeder.php`
* Test: `tests/Feature/Admin/AuthTest.php`, `tests/Feature/Admin/TeamTest.php`

**Interfaces:**
* Produces: route group `/admin` named `admin.*` with middleware `auth`, `active`, `admin.locale`; `admin` middleware alias for admin only routes.
* Produces: routes `admin.login`, `admin.logout`, `password.request`, `password.reset` (Laravel's built in password broker, no starter kit), `admin.team.index|store|update`, `admin.language.update` (POST `locale`).
* Produces: `AdminUserSeeder` reading `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` from env.

- [ ] **Step 1: Write failing tests**

```php
public function test_guest_is_redirected_to_login(): void
{ $this->get('/admin')->assertRedirect('/admin/login'); }

public function test_login_is_rate_limited_after_5_attempts(): void
{
    $u = User::factory()->create();
    foreach (range(1, 5) as $_) $this->post('/admin/login', ['email' => $u->email, 'password' => 'wrong']);
    $this->post('/admin/login', ['email' => $u->email, 'password' => 'password'])->assertSessionHasErrors('email');
}
public function test_deactivated_user_is_logged_out(): void
{
    $u = User::factory()->create(['is_active' => false]);
    $this->actingAs($u)->get('/admin')->assertRedirect('/admin/login');
}
public function test_recruiter_cannot_manage_team(): void
{
    $this->actingAs(User::factory()->recruiter()->create())->get('/admin/team')->assertForbidden();
}
public function test_admin_adds_team_member(): void
{
    $this->actingAs(User::factory()->admin()->create())
        ->post('/admin/team', ['name' => 'Sara', 'email' => 'sara@example.com', 'role' => 'recruiter'])
        ->assertRedirect();
    $this->assertDatabaseHas('users', ['email' => 'sara@example.com', 'role' => 'recruiter', 'is_active' => true]);
    Notification::assertSentTo(User::where('email', 'sara@example.com')->first(), ResetPassword::class);
}
public function test_admin_cannot_deactivate_themself(): void
{
    $admin = User::factory()->admin()->create();
    $this->actingAs($admin)->patch("/admin/team/{$admin->id}", ['is_active' => false])->assertSessionHasErrors();
}
public function test_admin_language_follows_user_preference(): void
{
    $u = User::factory()->create(['locale' => 'ar']);
    $this->actingAs($u)->get('/admin')->assertSee('dir="rtl"', false);
}
```

- [ ] **Step 2: Run** `php artisan test --filter=Admin` → FAIL.
- [ ] **Step 3: Implement** login/logout/password reset controllers and views, middleware, team management (new members get a password reset email to set their own password; `Notification::fake()` in the test), admin layout with sidebar: Dashboard, Jobs, Talent pool, Clients, Team (admin only), language switch, logout.
- [ ] **Step 4: Run** tests → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: add team login, roles and admin shell"`

### Task 4: Public job list, job page and About

**Files:**
* Create: `app/Http/Controllers/Public/{JobController,PageController}.php`, views `resources/views/public/jobs/{index,show}.blade.php`, `resources/views/public/about.blade.php`
* Test: `tests/Feature/Public/JobPagesTest.php`

**Interfaces:**
* Consumes: `JobPosting::open()`, `localized()`, `isAcceptingApplications()`, `publicUrl()`.
* Produces: routes `jobs.index` (`?city=&q=`), `jobs.show` (`{jobPosting:slug}`), `about`, plus `ar.` twins. Job page includes the apply form partial from Task 5 when accepting.

- [ ] **Step 1: Write failing tests**

```php
public function test_list_shows_only_open_jobs_and_filters(): void
{
    JobPosting::factory()->open()->create(['title_en' => 'Warehouse Associate', 'city' => 'Cairo']);
    JobPosting::factory()->open()->create(['title_en' => 'Driver', 'city' => 'Giza']);
    JobPosting::factory()->create(['title_en' => 'Old Job', 'status' => JobStatus::Closed]);
    JobPosting::factory()->create(['title_en' => 'Draft Job', 'status' => JobStatus::Draft]);
    $this->get('/jobs')->assertSee('Warehouse Associate')->assertSee('Driver')
        ->assertDontSee('Old Job')->assertDontSee('Draft Job');
    $this->get('/jobs?city=Giza')->assertSee('Driver')->assertDontSee('Warehouse Associate');
    $this->get('/jobs?q=ware')->assertSee('Warehouse Associate')->assertDontSee('Driver');
}
public function test_arabic_job_page_shows_arabic_content_and_og_tags(): void
{
    $job = JobPosting::factory()->open()->create(['title_ar' => 'مسؤول مخازن']);
    $this->get("/ar/jobs/{$job->slug}")->assertOk()->assertSee('مسؤول مخازن')
        ->assertSee('<meta property="og:title" content="مسؤول مخازن', false)
        ->assertSee('og:image', false);
}
public function test_closed_job_page_says_not_accepting_and_has_no_form(): void
{
    $job = JobPosting::factory()->create(['status' => JobStatus::Closed]);
    $this->get("/jobs/{$job->slug}")->assertOk()
        ->assertSee(__('public.job_closed'))->assertDontSee('name="cv[]"', false);
}
public function test_draft_job_is_not_found(): void
{
    $job = JobPosting::factory()->create(['status' => JobStatus::Draft]);
    $this->get("/jobs/{$job->slug}")->assertNotFound();
}
public function test_client_name_hidden_unless_enabled(): void
{
    $job = JobPosting::factory()->open()->create(['show_client_name' => false]);
    $this->get("/jobs/{$job->slug}")->assertDontSee($job->clientCompany->name);
}
```

- [ ] **Step 2: Run** `php artisan test --filter=JobPagesTest` → FAIL.
- [ ] **Step 3: Implement** controllers and mobile first views (job cards; job page with responsibilities and requirements rendered as bullet lists, one item per line of text; OG image `public/brand/social/facebook-cover-1920x640.png`).
- [ ] **Step 4: Run** tests → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: add public job list, job page and about page"`

### Task 5: Apply flow with CV upload

**Files:**
* Create: `app/Http/Requests/ApplyRequest.php`, `app/Services/{ApplyService,CvStorage}.php`, `app/Exceptions/{AlreadyAppliedException,JobClosedException}.php`, `app/Http/Controllers/Public/ApplyController.php`, views `public/jobs/_apply_form.blade.php`, `public/jobs/thanks.blade.php`, `resources/js/cv-upload.js`
* Modify: `lang/{en,ar}/public.php`, `bootstrap/app.php` (render `PostTooLargeException` as a redirect back with a localized error)
* Test: `tests/Feature/Public/ApplyTest.php`

**Interfaces:**
* Consumes: `PhoneNumber::normalize()`, `JobPosting::isAcceptingApplications()`, `StageService::record()` from Task 7 is not needed here: the initial StageChange (`from_stage` null, `to_stage` new, `user_id` null) is written by `ApplyService`.
* Produces: `ApplyService::apply(JobPosting $job, array $data, array $files): Application` throws `JobClosedException` or `AlreadyAppliedException`; wraps everything in a DB transaction; reuses an existing Applicant by phone (updating name, email, city, area, date of birth).
* Produces: `CvStorage::store(Application $app, array $files): Collection` saves to disk `local` under `cvs/{application_id}/{uuid}.{ext}`; `CvStorage::replace(Application $app, array $files, User $by): Collection` marks old files `replaced_at`/`replaced_by` and stores new ones. Used by Task 8.
* Produces: routes `jobs.apply` (POST, throttle `apply`: 10/min per IP and 3/hour per normalized phone), `jobs.thanks`.
* Validation: `full_name` required max 120; `phone` required and must normalize; `email` nullable email; `city` required; `area` nullable; `date_of_birth` nullable date between 70 and 15 years ago; `consent` accepted; `website` (honeypot) must be empty (silently pretend success); `answers.{id}` per job question rules; `cv` required array 1..4; either exactly one `application/pdf` or 1..4 `image/jpeg|image/png` (checked by real MIME), each max `config('careergate.cv.max_kb')`.
* Client JS (`cv-upload.js`): converts HEIC with `heic2any`, compresses images with `browser-image-compression` to max 2000 px / 1.5 MB, opens the camera via `accept="image/*,application/pdf" capture` alternative button, shows per file progress, disables the submit button on first submit.

- [ ] **Step 1: Write failing tests**

```php
private function payload(array $over = []): array
{
    return array_merge(['full_name' => 'Ahmed Ali', 'phone' => '01012345678', 'city' => 'Cairo',
        'consent' => '1', 'cv' => [UploadedFile::fake()->create('cv.pdf', 300, 'application/pdf')]], $over);
}
public function test_applicant_applies_with_pdf(): void
{
    Storage::fake('local');
    $job = JobPosting::factory()->open()->create();
    $this->post("/jobs/{$job->slug}/apply", $this->payload())->assertRedirect("/jobs/{$job->slug}/thanks");
    $app = Application::sole();
    $this->assertSame('+201012345678', $app->applicant->phone);
    $this->assertSame(Stage::New, $app->stage);
    $this->assertCount(1, $app->cvFiles);
    Storage::disk('local')->assertExists($app->cvFiles->first()->path);
    $this->assertDatabaseHas('stage_changes', ['application_id' => $app->id, 'to_stage' => 'new', 'user_id' => null]);
}
public function test_applies_with_multiple_images(): void
{
    Storage::fake('local');
    $job = JobPosting::factory()->open()->create();
    $imgs = [UploadedFile::fake()->image('p1.jpg'), UploadedFile::fake()->image('p2.jpg')];
    $this->post("/jobs/{$job->slug}/apply", $this->payload(['cv' => $imgs]))->assertRedirect();
    $this->assertCount(2, Application::sole()->cvFiles);
}
public function test_cv_is_required_and_rules_enforced(): void
{
    $job = JobPosting::factory()->open()->create();
    $url = "/jobs/{$job->slug}/apply";
    $this->post($url, $this->payload(['cv' => []]))->assertSessionHasErrors('cv');
    $this->post($url, $this->payload(['cv' => array_fill(0, 5, UploadedFile::fake()->image('p.jpg'))]))->assertSessionHasErrors('cv');
    $this->post($url, $this->payload(['cv' => [UploadedFile::fake()->create('cv.docx', 100, 'application/msword')]]))->assertSessionHasErrors('cv.0');
    $this->post($url, $this->payload(['cv' => [UploadedFile::fake()->create('big.pdf', 10241, 'application/pdf')]]))->assertSessionHasErrors('cv.0');
    $this->post($url, $this->payload(['cv' => [UploadedFile::fake()->create('a.pdf', 10, 'application/pdf'), UploadedFile::fake()->image('p.jpg')]]))->assertSessionHasErrors('cv');
    $this->post($url, $this->payload(['consent' => null]))->assertSessionHasErrors('consent');
    $this->post($url, $this->payload(['phone' => '12345']))->assertSessionHasErrors('phone');
    $this->assertSame(0, Application::count());
}
public function test_second_application_same_job_says_already_applied(): void   // Review Focus 2
{
    Storage::fake('local');
    $job = JobPosting::factory()->open()->create();
    $this->post("/jobs/{$job->slug}/apply", $this->payload());
    $this->post("/jobs/{$job->slug}/apply", $this->payload(['phone' => '+20 101 234 5678']))
        ->assertSessionHas('already_applied', true);
    $this->assertSame(1, Application::count());
    $this->assertSame(1, CvFile::count());
}
public function test_same_person_different_jobs_shares_applicant(): void
{
    Storage::fake('local');
    [$a, $b] = JobPosting::factory()->open()->count(2)->create();
    $this->post("/jobs/{$a->slug}/apply", $this->payload());
    $this->post("/jobs/{$b->slug}/apply", $this->payload(['full_name' => 'Ahmed M. Ali']));
    $this->assertSame(1, Applicant::count());
    $this->assertSame('Ahmed M. Ali', Applicant::sole()->full_name);
    $this->assertSame(2, Application::count());
}
public function test_job_closed_after_page_load_rejects_submission(): void   // Review Focus 3
{
    Storage::fake('local');
    $job = JobPosting::factory()->open()->create(['closes_on' => now()->subDay()]);
    $this->post("/jobs/{$job->slug}/apply", $this->payload())->assertSessionHas('job_closed', true);
    $this->assertSame(0, Application::count());
    $this->assertEmpty(Storage::disk('local')->allFiles());
}
public function test_required_job_question_is_enforced(): void
{
    $job = JobPosting::factory()->open()->create(['questions' => [
        ['id' => 'q1', 'type' => 'yes_no', 'label_en' => 'Live near Nasr City?', 'label_ar' => 'هل تسكن بالقرب من مدينة نصر؟', 'required' => true]]]);
    $this->post("/jobs/{$job->slug}/apply", $this->payload())->assertSessionHasErrors('answers.q1');
}
public function test_honeypot_pretends_success_but_stores_nothing(): void
{
    $job = JobPosting::factory()->open()->create();
    $this->post("/jobs/{$job->slug}/apply", $this->payload(['website' => 'http://spam']))->assertRedirect("/jobs/{$job->slug}/thanks");
    $this->assertSame(0, Application::count());
}
public function test_post_too_large_shows_localized_error(): void   // Review Focus 5
{
    $job = JobPosting::factory()->open()->create();
    $this->withServerVariables(['CONTENT_LENGTH' => 200 * 1024 * 1024])
        ->from("/ar/jobs/{$job->slug}")->post("/ar/jobs/{$job->slug}/apply", [])
        ->assertRedirect("/ar/jobs/{$job->slug}")->assertSessionHasErrors(['cv' => __('public.cv_too_large', [], 'ar')]);
}
public function test_arabic_validation_messages(): void
{
    $job = JobPosting::factory()->open()->create();
    $this->post("/ar/jobs/{$job->slug}/apply", $this->payload(['full_name' => '']))
        ->assertSessionHasErrors(['full_name' => __('validation.required', ['attribute' => __('validation.attributes.full_name', [], 'ar')], 'ar')]);
}
```

- [ ] **Step 2: Run** `php artisan test --filter=ApplyTest` → FAIL.
- [ ] **Step 3: Implement** request, services, controller, exception rendering, form partial, thanks page ("already applied" and "job closed" variants), JS. Store files only after the transaction's DB writes succeed; delete stored files if the transaction rolls back. Rely on the unique index for double submits: catch the unique violation and treat it as `AlreadyAppliedException`.
- [ ] **Step 4: Run** tests → PASS. Manually check on a 390 px wide viewport with Playwright: form usable, Arabic RTL.
- [ ] **Step 5: Commit** `git commit -m "feat: add application form with CV upload"`

### Task 6: Client companies and job management

**Files:**
* Create: `app/Http/Controllers/Admin/{ClientCompanyController,JobPostingController}.php`, `app/Http/Requests/{ClientCompanyRequest,JobPostingRequest}.php`, views `admin/clients/*`, `admin/jobs/{index,form,show}.blade.php`, `app/Console/Commands/CloseExpiredJobs.php`
* Modify: `routes/console.php` (schedule `jobs:close-expired` daily at 00:05 Cairo)
* Test: `tests/Feature/Admin/ClientCompanyTest.php`, `tests/Feature/Admin/JobPostingTest.php`

**Interfaces:**
* Produces: resource routes `admin.clients.*` and `admin.jobs.*` (`{jobPosting}` by id), plus `admin.jobs.duplicate` (POST), `admin.jobs.status` (PATCH `status`).
* Produces: `JobPostingRequest` validates questions as array of `{type in QuestionType, label_en|label_ar at least one, options_en/options_ar required when choice, required bool}`; assigns `id` (`q` + random 6 chars) to new questions and keeps existing ids.
* Job show page displays both public links (`publicUrl('en')`, `publicUrl('ar')`) with copy buttons and counts per stage.

- [ ] **Step 1: Write failing tests**

```php
public function test_recruiter_creates_job_with_both_languages(): void
{
    $client = ClientCompany::factory()->create();
    $this->actingAs(User::factory()->recruiter()->create())->post('/admin/jobs', [
        'client_company_id' => $client->id, 'title_en' => 'Warehouse Operations Associate', 'title_ar' => 'مسؤول مخازن وتجهيز طلبات',
        'city' => 'Cairo', 'area' => 'Nasr City', 'employment_type' => 'full_time', 'status' => 'open',
        'requirements_en' => "Secondary education\nMS Office", 'questions' => [
            ['type' => 'choice', 'label_en' => 'Shift?', 'options_en' => ['Morning', 'Night'], 'required' => true]],
    ])->assertRedirect();
    $job = JobPosting::sole();
    $this->assertSame('Nasr City', $job->area);
    $this->assertMatchesRegularExpression('/^q\w{6}$/', $job->questions[0]['id']);
}
public function test_job_needs_a_title_in_at_least_one_language(): void
{
    $this->actingAs(User::factory()->create())->post('/admin/jobs', ['client_company_id' => ClientCompany::factory()->create()->id])
        ->assertSessionHasErrors('title_en');
}
public function test_job_with_applications_cannot_be_deleted(): void
{
    $app = Application::factory()->create();
    $this->actingAs(User::factory()->admin()->create())->delete("/admin/jobs/{$app->job_posting_id}")->assertSessionHasErrors();
    $this->assertDatabaseHas('job_postings', ['id' => $app->job_posting_id]);
}
public function test_only_admin_deletes_empty_job(): void
{
    $job = JobPosting::factory()->create();
    $this->actingAs(User::factory()->recruiter()->create())->delete("/admin/jobs/{$job->id}")->assertForbidden();
    $this->actingAs(User::factory()->admin()->create())->delete("/admin/jobs/{$job->id}")->assertRedirect();
    $this->assertModelMissing($job);
}
public function test_duplicate_creates_draft_copy_with_new_slug(): void
{
    $job = JobPosting::factory()->open()->create();
    $this->actingAs(User::factory()->create())->post("/admin/jobs/{$job->id}/duplicate");
    $copy = JobPosting::latest('id')->first();
    $this->assertSame(JobStatus::Draft, $copy->status);
    $this->assertNotSame($job->slug, $copy->slug);
    $this->assertSame($job->questions, $copy->questions);
}
public function test_expired_jobs_are_closed_by_scheduler(): void
{
    $this->travelTo(Carbon::parse('2026-12-11 00:05', 'Africa/Cairo'));
    $expired = JobPosting::factory()->open()->create(['closes_on' => '2026-12-10']);
    $today = JobPosting::factory()->open()->create(['closes_on' => '2026-12-11']);
    $this->artisan('jobs:close-expired')->assertSuccessful();
    $this->assertSame(JobStatus::Closed, $expired->fresh()->status);
    $this->assertSame(JobStatus::Open, $today->fresh()->status);
}
public function test_client_company_with_jobs_cannot_be_deleted(): void
{
    $job = JobPosting::factory()->create();
    $this->actingAs(User::factory()->admin()->create())->delete("/admin/clients/{$job->client_company_id}")->assertSessionHasErrors();
}
```

- [ ] **Step 2: Run** `php artisan test --filter='ClientCompanyTest|JobPostingTest'` → FAIL.
- [ ] **Step 3: Implement** controllers, requests, views (English/Arabic tabs, question builder with Alpine), command, schedule.
- [ ] **Step 4: Run** tests → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: add client companies and job management"`

### Task 7: Applicants per job, stages and bulk actions

**Files:**
* Create: `app/Services/StageService.php`, `app/Http/Controllers/Admin/{ApplicationController,ApplicationStageController}.php`, views `admin/jobs/applications.blade.php`
* Test: `tests/Feature/Admin/JobApplicationsTest.php`, `tests/Unit/StageServiceTest.php`

**Interfaces:**
* Produces: `StageService::move(Application $app, Stage $to, ?User $by): bool` (returns false and writes nothing when already in that stage; otherwise updates stage and writes a StageChange in one transaction). This is the single place phase 3 will hook WhatsApp messages: it dispatches `ApplicationStageChanged` event (`application`, `from`, `to`).
* Produces: routes `admin.jobs.applications` (GET `?stage=&city=&area=&from=&to=&q=`, paginated 50, sortable by applied date), `admin.applications.stage` (PATCH single, `stage`), `admin.jobs.applications.bulk-stage` (PATCH, `ids[]`, `stage`; ids must belong to the job).

- [ ] **Step 1: Write failing tests**

```php
public function test_move_records_history_and_event(): void
{
    Event::fake([ApplicationStageChanged::class]);
    $app = Application::factory()->create(); $u = User::factory()->create();
    $this->assertTrue(app(StageService::class)->move($app, Stage::Shortlisted, $u));
    $this->assertFalse(app(StageService::class)->move($app, Stage::Shortlisted, $u));
    $this->assertSame(1, $app->stageChanges()->where('to_stage', 'shortlisted')->count());
    Event::assertDispatchedTimes(ApplicationStageChanged::class, 1);
}
public function test_any_stage_can_move_to_any_stage(): void
{
    $app = Application::factory()->create(['stage' => Stage::Hired]);
    app(StageService::class)->move($app, Stage::New, User::factory()->create());
    $this->assertSame(Stage::New, $app->fresh()->stage);
}
public function test_filters_by_stage_and_search(): void
{
    $job = JobPosting::factory()->create();
    Application::factory()->for($job)->for(Applicant::factory()->state(['full_name' => 'Mona Hassan', 'phone' => '+201111111111']))->create(['stage' => Stage::Shortlisted]);
    Application::factory()->for($job)->for(Applicant::factory()->state(['full_name' => 'Omar Said']))->create();
    $this->actingAs(User::factory()->create())->get("/admin/jobs/{$job->id}/applications?stage=shortlisted")
        ->assertSee('Mona Hassan')->assertDontSee('Omar Said');
    $this->get("/admin/jobs/{$job->id}/applications?q=01111111111")->assertSee('Mona Hassan')->assertDontSee('Omar Said');
}
public function test_bulk_stage_change_ignores_other_jobs(): void
{
    $job = JobPosting::factory()->create();
    $mine = Application::factory()->for($job)->count(2)->create();
    $other = Application::factory()->create();
    $this->actingAs(User::factory()->create())->patch("/admin/jobs/{$job->id}/applications/bulk-stage",
        ['ids' => [...$mine->pluck('id'), $other->id], 'stage' => 'rejected'])->assertSessionHasErrors('ids');
    $this->patch("/admin/jobs/{$job->id}/applications/bulk-stage", ['ids' => $mine->pluck('id')->all(), 'stage' => 'rejected']);
    $this->assertSame(2, Application::where('stage', 'rejected')->count());
}
```

- [ ] **Step 2: Run** `php artisan test --filter='JobApplicationsTest|StageServiceTest'` → FAIL.
- [ ] **Step 3: Implement** service, event, controllers, list view (stage tabs with counts, checkboxes, bulk bar, comment count column, WhatsApp icon link `https://wa.me/20XXXXXXXXXX`).
- [ ] **Step 4: Run** tests → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: add per job applicant list with stages and bulk actions"`

### Task 8: Application page, CV viewer, comments, CV replacement

**Files:**
* Create: `app/Http/Controllers/Admin/{CvFileController,CommentController}.php`, `resources/views/admin/applications/show.blade.php`
* Test: `tests/Feature/Admin/ApplicationPageTest.php`, `tests/Feature/CvAccessTest.php`

**Interfaces:**
* Consumes: `CvStorage::replace()`, `StageService::move()`.
* Produces: routes `admin.applications.show`, `admin.cv-files.show` (GET `{cvFile}` streams inline with correct `Content-Type`, `Content-Disposition: inline`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`; `?download=1` for attachment), `admin.applications.comments.store`, `admin.comments.destroy` (author or admin only), `admin.applications.cv.replace` (POST `cv[]`, same rules as ApplyRequest's cv rules: extract them to `CvRules::rules(): array`).
* Page shows: applicant details with age, answers with question labels, CV viewer (PDF in `<iframe>`, images in a gallery), stage buttons, stage history (who and when), comments thread (who and when), "other applications by this person" with links, replaced CV versions.

- [ ] **Step 1: Write failing tests**

```php
public function test_guest_cannot_fetch_cv_and_files_are_not_public(): void
{
    Storage::fake('local');
    $cv = CvFile::factory()->create();
    $this->get("/admin/cv-files/{$cv->id}")->assertRedirect('/admin/login');
    $this->assertFalse(str_starts_with($cv->path, 'public/'));
    $this->get('/storage/'.$cv->path)->assertNotFound();
}
public function test_team_member_views_cv_inline(): void
{
    Storage::fake('local');
    $cv = CvFile::factory()->pdf()->create();
    $this->actingAs(User::factory()->create())->get("/admin/cv-files/{$cv->id}")
        ->assertOk()->assertHeader('Content-Type', 'application/pdf')
        ->assertHeader('X-Content-Type-Options', 'nosniff');
}
public function test_comment_added_and_shown_with_author(): void
{
    $app = Application::factory()->create(); $u = User::factory()->create(['name' => 'Sara']);
    $this->actingAs($u)->post("/admin/applications/{$app->id}/comments", ['body' => 'Strong warehouse experience']);
    $this->get("/admin/applications/{$app->id}")->assertSee('Strong warehouse experience')->assertSee('Sara');
}
public function test_comments_never_on_public_pages(): void
{
    $app = Application::factory()->create(); Comment::factory()->for($app)->create(['body' => 'SECRET NOTE']);
    $app->jobPosting->update(['status' => JobStatus::Open]);
    $this->get("/jobs/{$app->jobPosting->slug}")->assertDontSee('SECRET NOTE');
}
public function test_team_replaces_cv_and_keeps_old_version(): void
{
    Storage::fake('local');
    $app = Application::factory()->hasCvFiles(1)->create(['stage' => Stage::Shortlisted]);
    $old = $app->cvFiles->first();
    $this->actingAs(User::factory()->create())->post("/admin/applications/{$app->id}/cv",
        ['cv' => [UploadedFile::fake()->create('new.pdf', 100, 'application/pdf')]])->assertRedirect();
    $this->assertNotNull($old->fresh()->replaced_at);
    $this->assertCount(1, $app->fresh()->cvFiles);
    $this->assertSame(Stage::Shortlisted, $app->fresh()->stage);
}
public function test_only_author_or_admin_deletes_comment(): void
{
    $c = Comment::factory()->create();
    $this->actingAs(User::factory()->recruiter()->create())->delete("/admin/comments/{$c->id}")->assertForbidden();
    $this->actingAs($c->user)->delete("/admin/comments/{$c->id}")->assertRedirect();
}
```

- [ ] **Step 2: Run** `php artisan test --filter='ApplicationPageTest|CvAccessTest'` → FAIL.
- [ ] **Step 3: Implement** controllers, `CvRules`, view.
- [ ] **Step 4: Run** tests → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: add application page with CV viewer and internal comments"`

### Task 9: Talent pool

**Files:**
* Create: `app/Services/TalentPoolQuery.php`, `app/Http/Controllers/Admin/TalentPoolController.php`, view `admin/talent-pool/index.blade.php`
* Test: `tests/Feature/Admin/TalentPoolTest.php`

**Interfaces:**
* Produces: `TalentPoolQuery::apply(Builder $applicants, array $filters): Builder` with filters `q` (name or phone, phone normalized first when it parses), `city`, `area`, `age_min`, `age_max`, `best_stage` (highest stage reached in Stage::ordered, `rejected` matched only as current stage), `job_id` (applied to), `applied_from`, `applied_to`. Default sort: latest application first. Paginated 50.
* Produces: route `admin.talent-pool.index`, `admin.applicants.add-to-job` (POST `{applicant}`, `job_posting_id` must be open) creating an Application with `source = 'talent_pool'`, `added_by`, stage New, an initial StageChange by that user, and copies of the latest current CV files (new file copies on disk, so later deletes of one application don't break another).

- [ ] **Step 1: Write failing tests**

```php
public function test_search_across_jobs_by_area_and_age(): void
{
    Applicant::factory()->hasApplications(1)->create(['full_name' => 'Nour', 'area' => 'Nasr City', 'date_of_birth' => now()->subYears(25)]);
    Applicant::factory()->hasApplications(1)->create(['full_name' => 'Karim', 'area' => 'Maadi', 'date_of_birth' => now()->subYears(40)]);
    $this->actingAs(User::factory()->create())->get('/admin/talent-pool?area=Nasr+City&age_max=30')
        ->assertSee('Nour')->assertDontSee('Karim');
}
public function test_add_past_applicant_to_new_job_copies_cv(): void
{
    Storage::fake('local');
    $prev = Application::factory()->hasCvFiles(2)->create();
    $job = JobPosting::factory()->open()->create();
    $u = User::factory()->create();
    $this->actingAs($u)->post("/admin/applicants/{$prev->applicant_id}/add-to-job", ['job_posting_id' => $job->id])->assertRedirect();
    $new = Application::where('job_posting_id', $job->id)->sole();
    $this->assertSame('talent_pool', $new->source);
    $this->assertSame($u->id, $new->added_by);
    $this->assertCount(2, $new->cvFiles);
    $this->assertNotEquals($prev->cvFiles->pluck('path'), $new->cvFiles->pluck('path'));
}
public function test_cannot_add_twice_or_to_closed_job(): void
{
    $app = Application::factory()->create();
    $closed = JobPosting::factory()->create(['status' => JobStatus::Closed]);
    $this->actingAs(User::factory()->create());
    $this->post("/admin/applicants/{$app->applicant_id}/add-to-job", ['job_posting_id' => $app->job_posting_id])->assertSessionHasErrors('job_posting_id');
    $this->post("/admin/applicants/{$app->applicant_id}/add-to-job", ['job_posting_id' => $closed->id])->assertSessionHasErrors('job_posting_id');
}
```

- [ ] **Step 2: Run** `php artisan test --filter=TalentPoolTest` → FAIL.
- [ ] **Step 3: Implement** query, controller, view (filters sidebar, results with last job and best stage, "Add to job" select of open jobs).
- [ ] **Step 4: Run** tests → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: add talent pool search and add to job"`

### Task 10: Applicant deletion and retention

**Files:**
* Create: `app/Http/Controllers/Admin/ApplicantController.php` (destroy), `app/Console/Commands/PurgeExpiredApplicants.php`, `app/Observers/CvFileObserver.php` (delete file from disk when the row is deleted)
* Modify: `routes/console.php` (schedule `applicants:purge-expired` daily 03:00; `backup:clean` and `backup:run --only-db` daily 02:00; `queue:work --stop-when-empty --max-time=50` every minute)
* Test: `tests/Feature/Admin/ApplicantDeletionTest.php`, `tests/Feature/RetentionTest.php`

**Interfaces:**
* Produces: route `admin.applicants.destroy` (admin only, requires `confirm` equal to the applicant's phone as typed confirmation).
* Produces: command `applicants:purge-expired` deleting applicants with `wasEverHired() === false` whose latest application `created_at` is older than `config('careergate.retention_months')` months; prints the count.
* Deleting an Applicant deletes its Applications, StageChanges, Comments, CvFiles (rows and disk files). Exports already generated are not touched.

- [ ] **Step 1: Write failing tests**

```php
public function test_admin_permanently_deletes_applicant_and_files(): void
{
    Storage::fake('local');
    $app = Application::factory()->hasCvFiles(1)->hasComments(1)->create();
    $path = $app->cvFiles->first()->path;
    $this->actingAs(User::factory()->recruiter()->create())->delete("/admin/applicants/{$app->applicant_id}")->assertForbidden();
    $this->actingAs(User::factory()->admin()->create())->delete("/admin/applicants/{$app->applicant_id}", ['confirm' => 'wrong'])->assertSessionHasErrors('confirm');
    $this->delete("/admin/applicants/{$app->applicant_id}", ['confirm' => $app->applicant->phone])->assertRedirect('/admin/talent-pool');
    $this->assertSame(0, Applicant::count() + Application::count() + Comment::count() + CvFile::count() + StageChange::count());
    Storage::disk('local')->assertMissing($path);
}
public function test_purge_removes_old_never_hired_only(): void
{
    Storage::fake('local');
    $old = Application::factory()->create(['created_at' => now()->subMonths(25)]);
    $oldHired = Application::factory()->create(['created_at' => now()->subMonths(30), 'stage' => Stage::Hired]);
    $oldButRecent = Applicant::factory()->create();
    Application::factory()->for($oldButRecent)->create(['created_at' => now()->subMonths(30)]);
    Application::factory()->for($oldButRecent)->create(['created_at' => now()->subMonths(3)]);
    $this->artisan('applicants:purge-expired')->expectsOutputToContain('1')->assertSuccessful();
    $this->assertModelMissing($old->applicant);
    $this->assertModelExists($oldHired->applicant);
    $this->assertModelExists($oldButRecent);
}
public function test_hired_then_moved_away_still_counts_as_hired(): void
{
    $app = Application::factory()->create(['created_at' => now()->subMonths(30)]);
    app(StageService::class)->move($app, Stage::Hired, null);
    app(StageService::class)->move($app, Stage::Rejected, null);
    $this->artisan('applicants:purge-expired');
    $this->assertModelExists($app->applicant);
}
```

`wasEverHired()` checks StageChanges for `to_stage = hired`, not just the current stage.

- [ ] **Step 2: Run** `php artisan test --filter='ApplicantDeletionTest|RetentionTest'` → FAIL.
- [ ] **Step 3: Implement** controller, command, observer, schedules; configure `spatie/laravel-backup` to the `local` disk under `backups/`, keep 14 daily copies.
- [ ] **Step 4: Run** tests → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: add applicant deletion, retention purge and backups"`

### Task 11: Shortlist export (Excel + CV ZIP)

**Files:**
* Create: `app/Services/ShortlistExporter.php`, `app/Jobs/BuildShortlistExport.php`, `app/Http/Controllers/Admin/ExportController.php`, view partial on job page
* Test: `tests/Feature/Admin/ExportTest.php`

**Interfaces:**
* Produces: route `admin.jobs.exports.store` (POST, `stages[]` default `['shortlisted']`) creating an `Export` (`pending`) and dispatching `BuildShortlistExport`; `admin.exports.download` (GET `{export}/{type}` with type `xlsx|zip`, only for `ready`, any team member).
* Produces: `ShortlistExporter::build(Export $export): void` writing `exports/{id}/{job-slug}-shortlist.xlsx` and `.zip` on `local`. Excel columns, in order: `Name, Phone, Email, City, Area, Age, Stage, Applied on`, then one column per job question (English label, Arabic if no English). Never comments, stage history, user names or source. ZIP entries: `{NN} {Full Name}/{original_name}` with NN the row number (zero padded), so same names don't collide and Arabic names stay UTF-8.
* Job page lists recent exports with status and download links; a page refresh shows readiness (no websockets).

- [ ] **Step 1: Write failing tests**

```php
public function test_export_contains_selected_stages_without_internal_data(): void   // Review Focus 4
{
    Storage::fake('local');
    $job = JobPosting::factory()->create(['questions' => [['id' => 'q1', 'type' => 'yes_no', 'label_en' => 'Near Nasr City?', 'required' => true]]]);
    $a = Application::factory()->for($job)->for(Applicant::factory()->state(['full_name' => 'محمد علي']))->hasCvFiles(1)
        ->create(['stage' => Stage::Shortlisted, 'answers' => ['q1' => 'yes']]);
    Application::factory()->for($job)->for(Applicant::factory()->state(['full_name' => 'محمد علي']))->hasCvFiles(1)->create(['stage' => Stage::Shortlisted]);
    Application::factory()->for($job)->for(Applicant::factory()->state(['full_name' => 'Rejected Person']))->create(['stage' => Stage::Rejected]);
    Comment::factory()->for($a)->create(['body' => 'INTERNAL']);
    $this->actingAs(User::factory()->create())->post("/admin/jobs/{$job->id}/exports", ['stages' => ['shortlisted']]);
    $export = Export::sole();
    $this->assertSame('ready', $export->fresh()->status);   // sync queue in tests
    $rows = $this->readXlsx(Storage::disk('local')->path($export->fresh()->xlsx_path));
    $this->assertSame(['Name', 'Phone', 'Email', 'City', 'Area', 'Age', 'Stage', 'Applied on', 'Near Nasr City?'], $rows[0]);
    $this->assertSame('محمد علي', $rows[1][0]);
    $this->assertCount(3, $rows);
    $this->assertStringNotContainsString('INTERNAL', json_encode($rows, JSON_UNESCAPED_UNICODE));
    $zip = new ZipArchive; $zip->open(Storage::disk('local')->path($export->fresh()->zip_path));
    $names = collect(range(0, $zip->numFiles - 1))->map(fn ($i) => $zip->getNameIndex($i));
    $this->assertCount(2, $names);
    $this->assertTrue($names->contains(fn ($n) => str_starts_with($n, '01 محمد علي/')));
    $this->assertTrue($names->contains(fn ($n) => str_starts_with($n, '02 محمد علي/')));
}
public function test_download_requires_login_and_ready(): void
{
    $export = Export::factory()->create(['status' => 'pending']);
    $this->get("/admin/exports/{$export->id}/xlsx")->assertRedirect('/admin/login');
    $this->actingAs(User::factory()->create())->get("/admin/exports/{$export->id}/xlsx")->assertNotFound();
}
public function test_failed_build_marks_export_failed(): void
{
    $export = Export::factory()->create(['job_posting_id' => JobPosting::factory()->create()->id]);
    Storage::shouldReceive('disk')->andThrow(new RuntimeException('disk full'));
    (new BuildShortlistExport($export))->handle(app(ShortlistExporter::class));
    $this->assertSame('failed', $export->fresh()->status);
}
```

(`readXlsx` is a small test helper using OpenSpout's reader.)

- [ ] **Step 2: Run** `php artisan test --filter=ExportTest` → FAIL.
- [ ] **Step 3: Implement** exporter with OpenSpout writer and `ZipArchive`, job (`failed()` marks status and stores message), controller, UI. Exports older than 30 days are deleted by a daily scheduled `exports:prune`.
- [ ] **Step 4: Run** tests → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: add shortlist export to Excel and CV zip"`

### Task 12: Dashboard

**Files:**
* Create: `app/Http/Controllers/Admin/DashboardController.php`, view `admin/dashboard.blade.php`
* Test: `tests/Feature/Admin/DashboardTest.php`

**Interfaces:**
* Produces: route `admin.dashboard` (`/admin`): open jobs table with per stage counts (one grouped query, no N+1), and the 10 newest applications across jobs with links.

- [ ] **Step 1: Write failing test**

```php
public function test_dashboard_shows_open_jobs_with_stage_counts_and_newest(): void
{
    $job = JobPosting::factory()->open()->create(['title_en' => 'Picker']);
    Application::factory()->for($job)->count(3)->create();
    Application::factory()->for($job)->create(['stage' => Stage::Shortlisted]);
    DB::enableQueryLog();
    $this->actingAs(User::factory()->create())->get('/admin')->assertOk()
        ->assertSeeInOrder(['Picker', '3', '1']);
    $this->assertLessThan(15, count(DB::getQueryLog()));
}
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: add admin dashboard"`

### Task 13: Deployment guide and production hardening

**Files:**
* Create: `docs/deployment.md`, `README.md`, `.env.example` entries (`ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`, `QUEUE_CONNECTION=database`, `FILESYSTEM_DISK=local`, `APP_TIMEZONE=Africa/Cairo`), `public/.user.ini` (`upload_max_filesize=12M`, `post_max_size=50M`, `max_execution_time=120`, `memory_limit=256M`)
* Test: `tests/Feature/ProductionConfigTest.php`

**Interfaces:**
* Guide covers, for Hostinger style hosting: picking PHP 8.3, creating the MySQL database, SSH clone, `composer install --no-dev --optimize-autoloader`, `.env` setup, `php artisan key:generate`, `migrate --force`, `db:seed --class=AdminUserSeeder`, pointing the domain's document root to `public/` (or the `public_html` symlink method), SSL, the cron line `* * * * * cd ~/careergate-jobs && php artisan schedule:run >> /dev/null 2>&1`, how to update (pull, install, migrate, `optimize`), how to download backups, and the later domain switch (`APP_URL`).

- [ ] **Step 1: Write failing test**

```php
public function test_security_headers_and_no_debug_leaks(): void
{
    config(['app.debug' => false]);
    $this->get('/jobs')->assertHeader('X-Frame-Options', 'SAMEORIGIN')->assertHeader('X-Content-Type-Options', 'nosniff')
        ->assertHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    $this->get('/jobs/does-not-exist')->assertNotFound()->assertDontSee('Stack trace');
}
public function test_admin_pages_are_not_indexed(): void
{
    $this->get('/admin/login')->assertHeader('X-Robots-Tag', 'noindex, nofollow');
}
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** security headers middleware, `robots.txt` disallowing `/admin`, branded 404/500 pages in both languages, the guide and README.
- [ ] **Step 4: Run** the full suite `php artisan test` → all PASS; `npm run build`; walk through the apply flow and the back office in Playwright on mobile and desktop widths in both languages and fix anything broken.
- [ ] **Step 5: Commit** `git commit -m "docs: add deployment guide and production hardening"`
