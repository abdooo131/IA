<?php

namespace Tests\Feature\Public;

use App\Enums\Stage;
use App\Models\Applicant;
use App\Models\Application;
use App\Models\CvFile;
use App\Models\JobPosting;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ApplyTest extends TestCase
{
    use RefreshDatabase;

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

    public function test_stored_path_uses_uuid_and_detected_extension(): void
    {
        Storage::fake('local');
        $job = JobPosting::factory()->open()->create();
        $this->post("/jobs/{$job->slug}/apply", $this->payload(['cv' => [UploadedFile::fake()->image('../../evil.png.jpg')]]));
        $app = Application::sole();
        $file = $app->cvFiles->first();
        $this->assertMatchesRegularExpression('#^cvs/'.$app->id.'/[0-9a-f-]{36}\.jpg$#', $file->path);
        $this->assertSame('image/jpeg', $file->mime);
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

    public function test_renamed_non_image_is_rejected(): void
    {
        Storage::fake('local');
        $job = JobPosting::factory()->open()->create();
        $junk = UploadedFile::fake()->createWithContent('photo.jpg', 'this is not an image at all');
        $this->post("/jobs/{$job->slug}/apply", $this->payload(['cv' => [$junk]]))->assertSessionHasErrors('cv.0');
        $this->assertSame(0, Application::count());
    }

    public function test_two_pdfs_are_rejected(): void
    {
        $job = JobPosting::factory()->open()->create();
        $two = [UploadedFile::fake()->create('a.pdf', 10, 'application/pdf'), UploadedFile::fake()->create('b.pdf', 10, 'application/pdf')];
        $this->post("/jobs/{$job->slug}/apply", $this->payload(['cv' => $two]))->assertSessionHasErrors('cv');
    }

    public function test_old_input_is_kept_after_validation_error(): void
    {
        $job = JobPosting::factory()->open()->create();
        $this->from("/jobs/{$job->slug}")->post("/jobs/{$job->slug}/apply", $this->payload(['phone' => '12345', 'full_name' => 'Sara Hassan']))
            ->assertRedirect("/jobs/{$job->slug}");
        $this->get("/jobs/{$job->slug}")->assertSee('value="Sara Hassan"', false);
    }

    public function test_second_application_same_job_says_already_applied(): void
    {
        Storage::fake('local');
        $job = JobPosting::factory()->open()->create();
        $this->post("/jobs/{$job->slug}/apply", $this->payload());
        $this->post("/jobs/{$job->slug}/apply", $this->payload(['phone' => '+20 101 234 5678']))
            ->assertSessionHas('already_applied', true)
            ->assertRedirect("/jobs/{$job->slug}/thanks");
        $this->assertSame(1, Application::count());
        $this->assertSame(1, CvFile::count());
        $this->assertCount(1, Storage::disk('local')->allFiles());
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

    public function test_job_closed_after_page_load_rejects_submission(): void
    {
        Storage::fake('local');
        $job = JobPosting::factory()->open()->create(['closes_on' => now()->subDay()]);
        $this->post("/jobs/{$job->slug}/apply", $this->payload())
            ->assertSessionHas('job_closed', true)
            ->assertRedirect("/jobs/{$job->slug}");
        $this->assertSame(0, Application::count());
        $this->assertEmpty(Storage::disk('local')->allFiles());
    }

    public function test_required_job_question_is_enforced(): void
    {
        $job = JobPosting::factory()->open()->create(['questions' => [
            ['id' => 'q1', 'type' => 'yes_no', 'label_en' => 'Live near Nasr City?', 'label_ar' => 'هل تسكن بالقرب من مدينة نصر؟', 'required' => true]]]);
        $this->post("/jobs/{$job->slug}/apply", $this->payload())->assertSessionHasErrors('answers.q1');
    }

    public function test_job_question_answers_are_stored(): void
    {
        Storage::fake('local');
        $job = JobPosting::factory()->open()->create(['questions' => [
            ['id' => 'q1', 'type' => 'yes_no', 'label_en' => 'Live near?', 'label_ar' => 'x', 'required' => true],
            ['id' => 'q2', 'type' => 'choice', 'label_en' => 'Shift', 'label_ar' => 'x', 'options_en' => ['Day', 'Night'], 'options_ar' => ['نهار', 'ليل'], 'required' => false],
        ]]);
        $this->post("/jobs/{$job->slug}/apply", $this->payload(['answers' => ['q1' => 'yes', 'q2' => 'Night']]))->assertRedirect();
        $this->assertSame(['q1' => 'yes', 'q2' => 'Night'], Application::sole()->answers);
        $this->post("/jobs/{$job->slug}/apply", $this->payload(['phone' => '01112345678', 'answers' => ['q1' => 'maybe']]))
            ->assertSessionHasErrors('answers.q1');
    }

    public function test_honeypot_pretends_success_but_stores_nothing(): void
    {
        Storage::fake('local');
        $job = JobPosting::factory()->open()->create();
        $this->post("/jobs/{$job->slug}/apply", $this->payload(['cg_hp_field' => 'spam']))->assertRedirect("/jobs/{$job->slug}/thanks");
        $this->assertSame(0, Application::count());
        $this->assertEmpty(Storage::disk('local')->allFiles());
    }

    public function test_post_too_large_shows_localized_error(): void
    {
        $job = JobPosting::factory()->open()->create();
        $this->withServerVariables(['CONTENT_LENGTH' => 200 * 1024 * 1024])
            ->from("/ar/jobs/{$job->slug}")->post("/ar/jobs/{$job->slug}/apply", [])
            ->assertRedirect("/ar/jobs/{$job->slug}")->assertSessionHasErrors(['cv' => __('public.cv_too_large', ['mb' => \App\Support\UploadLimits::maxFileMb()], 'ar')]);
    }

    public function test_arabic_validation_messages(): void
    {
        $job = JobPosting::factory()->open()->create();
        $this->post("/ar/jobs/{$job->slug}/apply", $this->payload(['full_name' => '']))
            ->assertSessionHasErrors(['full_name' => __('validation.required', ['attribute' => __('validation.attributes.full_name', [], 'ar')], 'ar')]);
    }

    public function test_thanks_page_shows_only_after_applying(): void
    {
        Storage::fake('local');
        $job = JobPosting::factory()->open()->create(['title_en' => 'Cashier']);
        $this->get("/jobs/{$job->slug}/thanks")->assertRedirect("/jobs/{$job->slug}");
        $this->followingRedirects()->post("/jobs/{$job->slug}/apply", $this->payload())
            ->assertOk()->assertSee('Cashier')->assertSee(__('public.thanks.heading'));
        $this->get("/jobs/{$job->slug}/thanks")->assertRedirect("/jobs/{$job->slug}");
    }

    public function test_arabic_thanks_page(): void
    {
        Storage::fake('local');
        $job = JobPosting::factory()->open()->create(['title_ar' => 'كاشير']);
        $this->post("/ar/jobs/{$job->slug}/apply", $this->payload())->assertRedirect("/ar/jobs/{$job->slug}/thanks");
        $this->get("/ar/jobs/{$job->slug}/thanks")->assertOk()->assertSee('كاشير')->assertSee(__('public.thanks.heading', [], 'ar'));
    }

    public function test_per_phone_limit_blocks_fourth_successful_application(): void
    {
        Storage::fake('local');
        $jobs = JobPosting::factory()->open()->count(4)->create();
        foreach ($jobs->take(3) as $j) {
            $this->post("/jobs/{$j->slug}/apply", $this->payload())->assertRedirect("/jobs/{$j->slug}/thanks");
        }
        $this->from("/jobs/{$jobs[3]->slug}")->post("/jobs/{$jobs[3]->slug}/apply", $this->payload())
            ->assertSessionHasErrors('phone')->assertRedirect("/jobs/{$jobs[3]->slug}");
        $this->assertSame(3, Application::count());
    }

    public function test_failed_validation_does_not_consume_phone_limit(): void
    {
        $job = JobPosting::factory()->open()->create();
        for ($i = 0; $i < 4; $i++) {
            $this->post("/jobs/{$job->slug}/apply", $this->payload(['full_name' => '']));
        }
        $this->assertFalse(RateLimiter::tooManyAttempts('apply-phone:+201012345678', 3));
    }

    public function test_per_ip_limit_redirects_back_with_localized_error(): void
    {
        $job = JobPosting::factory()->open()->create();
        for ($i = 0; $i < 10; $i++) {
            $this->post("/jobs/{$job->slug}/apply", $this->payload(['full_name' => '']));
        }
        $this->from("/ar/jobs/{$job->slug}")->post("/ar/jobs/{$job->slug}/apply", $this->payload())
            ->assertRedirect("/ar/jobs/{$job->slug}")
            ->assertSessionHasErrors(['form' => __('public.too_many_requests', [], 'ar')]);
    }

    public function test_files_are_deleted_if_storage_fails_after_write(): void
    {
        Storage::fake('local');
        $job = JobPosting::factory()->open()->create();
        // Make the stage change insert fail after the application row exists is not possible; instead
        // force a failure after files are written by breaking CvFile creation.
        CvFile::creating(fn () => throw new \RuntimeException('boom'));
        try {
            $this->withoutExceptionHandling()->post("/jobs/{$job->slug}/apply", $this->payload());
            $this->fail('expected exception');
        } catch (\RuntimeException $e) {
            $this->assertSame('boom', $e->getMessage());
        }
        $this->assertSame(0, Application::count());
        $this->assertEmpty(Storage::disk('local')->allFiles());
    }

    public function test_applicants_phone_unique_violation_is_not_reported_as_already_applied(): void
    {
        // The applicants.phone race is resolved by Applicant::firstOrCreate (re-reads the row);
        // if some other unique violation still escapes it must not be shown as "already applied".
        // (A real two-connection race cannot be reproduced on single-connection SQLite.)
        Storage::fake('local');
        $job = JobPosting::factory()->open()->create();
        Application::creating(fn () => throw new \Illuminate\Database\UniqueConstraintViolationException(
            'sqlite', 'insert into "applicants"', [], new \PDOException('UNIQUE constraint failed: applicants.phone')));
        try {
            $this->withoutExceptionHandling()->post("/jobs/{$job->slug}/apply", $this->payload());
            $this->fail('expected exception');
        } catch (\Illuminate\Database\UniqueConstraintViolationException) {
            $this->assertTrue(true);
        }
        $this->assertSame(0, Application::count());
        $this->assertEmpty(Storage::disk('local')->allFiles());
    }

    public function test_applicants_phone_race_is_retried_once_and_then_succeeds(): void
    {
        Storage::fake('local');
        $job = JobPosting::factory()->open()->create();
        $calls = 0;
        Application::creating(function () use (&$calls) {
            if ($calls++ === 0) {
                throw new \Illuminate\Database\UniqueConstraintViolationException(
                    'mysql', 'insert into `applicants`', [], new \PDOException("Duplicate entry '+201012345678' for key 'applicants_phone_unique'"));
            }
        });
        $this->post("/jobs/{$job->slug}/apply", $this->payload())->assertRedirect("/jobs/{$job->slug}/thanks");
        $this->assertSame(1, Application::count());
        $this->assertSame(2, $calls);
        $this->assertCount(1, Storage::disk('local')->allFiles());
    }

    public function test_applications_unique_violation_is_reported_as_already_applied(): void
    {
        Storage::fake('local');
        $job = JobPosting::factory()->open()->create();
        Application::creating(fn () => throw new \Illuminate\Database\UniqueConstraintViolationException(
            'sqlite', 'insert into "applications"', [], new \PDOException('UNIQUE constraint failed: applications.job_posting_id, applications.applicant_id')));
        $this->post("/jobs/{$job->slug}/apply", $this->payload())->assertSessionHas('already_applied', true);
        $this->assertSame(0, Application::count());
    }

    public function test_replace_cv_is_atomic_and_cleans_new_files_on_failure(): void
    {
        Storage::fake('local');
        $app = Application::factory()->create();
        $storage = app(\App\Services\CvStorage::class);
        $old = $storage->store($app, [UploadedFile::fake()->create('old.pdf', 10, 'application/pdf')]);
        $user = \App\Models\User::factory()->create();

        CvFile::updating(fn () => throw new \RuntimeException('boom'));
        try {
            $storage->replace($app, [UploadedFile::fake()->image('new.jpg')], $user);
            $this->fail('expected exception');
        } catch (\RuntimeException $e) {
            $this->assertSame('boom', $e->getMessage());
        }

        $this->assertSame(1, CvFile::count());
        $this->assertNull(CvFile::sole()->replaced_at);
        $this->assertSame([$old->first()->path], Storage::disk('local')->allFiles());
    }

    public function test_replace_cv_marks_old_files_and_stores_new(): void
    {
        Storage::fake('local');
        $app = Application::factory()->create();
        $storage = app(\App\Services\CvStorage::class);
        $storage->store($app, [UploadedFile::fake()->create('old.pdf', 10, 'application/pdf')]);
        $user = \App\Models\User::factory()->create();

        $new = $storage->replace($app, [UploadedFile::fake()->image('new.jpg')], $user);

        $this->assertCount(1, $new);
        $this->assertCount(1, $app->fresh()->cvFiles);
        $this->assertSame(2, $app->allCvFiles()->count());
        $this->assertSame($user->id, CvFile::whereNotNull('replaced_at')->sole()->replaced_by);
    }

    public function test_expired_session_on_apply_returns_to_the_job_page_with_input_and_message(): void
    {
        // The CSRF middleware is skipped when the app runs under the "testing" env; make it real.
        $this->app['env'] = 'local';
        Storage::fake('local');
        $job = JobPosting::factory()->open()->create();

        foreach (['en' => ["/jobs/{$job->slug}", 'Your session expired'], 'ar' => ["/ar/jobs/{$job->slug}", 'انتهت جلستك']] as $lang => [$page, $text]) {
            $apply = $lang === 'ar' ? "/ar/jobs/{$job->slug}/apply" : "/jobs/{$job->slug}/apply";
            $response = $this->post($apply, $this->payload(['_token' => 'wrong', 'cg_hp_field' => 'bot']));
            $response->assertRedirect($page.'#apply');
            // The typed fields come back; the CV files and the honeypot do not.
            $this->get($page)->assertOk()->assertSee($text)->assertSee('value="Ahmed Ali"', false)
                ->assertSee('value="01012345678"', false)->assertDontSee('value="bot"', false);
        }
        $this->assertSame(0, Application::count());
    }

    /** A JPEG with an APP1/Exif segment carrying an orientation tag and a GPS marker. */
    private function jpegWithExif(int $w, int $h, int $orientation): UploadedFile
    {
        $im = imagecreatetruecolor($w, $h);
        ob_start();
        imagejpeg($im);
        $jpeg = ob_get_clean();
        $tiff = "MM\x00\x2A\x00\x00\x00\x08\x00\x01\x01\x12\x00\x03\x00\x00\x00\x01".pack('n', $orientation)."\x00\x00\x00\x00\x00\x00GPSLatitude 30.0444N";
        $payload = "Exif\x00\x00".$tiff;
        $app1 = "\xFF\xE1".pack('n', strlen($payload) + 2).$payload;
        $path = tempnam(sys_get_temp_dir(), 'exif');
        file_put_contents($path, substr($jpeg, 0, 2).$app1.substr($jpeg, 2));

        return new UploadedFile($path, 'photo.jpg', 'image/jpeg', null, true);
    }

    public function test_exif_and_gps_are_stripped_from_stored_jpeg_and_orientation_applied(): void
    {
        Storage::fake('local');
        $upload = $this->jpegWithExif(40, 20, 6);
        $this->assertStringContainsString('GPSLatitude', file_get_contents($upload->getRealPath()));

        $job = JobPosting::factory()->open()->create();
        $this->post("/jobs/{$job->slug}/apply", $this->payload(['cv' => [$upload]]))->assertRedirect("/jobs/{$job->slug}/thanks");

        $cv = Application::sole()->cvFiles->first();
        $bytes = Storage::disk('local')->get($cv->path);
        $this->assertSame("\xFF\xD8", substr($bytes, 0, 2));
        $this->assertStringNotContainsString('Exif', $bytes);
        $this->assertStringNotContainsString('GPSLatitude', $bytes);
        $this->assertStringNotContainsString("\xFF\xE1", $bytes);
        $this->assertSame(strlen($bytes), $cv->size);
        // Orientation 6 means "rotate 90 degrees": a 40x20 file is stored upright as 20x40.
        [$w, $h] = getimagesizefromstring($bytes);
        $this->assertSame([20, 40], [$w, $h]);
    }

    public function test_png_is_re_encoded_and_still_a_valid_image(): void
    {
        Storage::fake('local');
        $job = JobPosting::factory()->open()->create();
        $this->post("/jobs/{$job->slug}/apply", $this->payload(['cv' => [UploadedFile::fake()->image('cv.png', 30, 20)]]))->assertRedirect();
        $bytes = Storage::disk('local')->get(Application::sole()->cvFiles->first()->path);
        $this->assertSame([30, 20], array_slice(getimagesizefromstring($bytes), 0, 2));
        $this->assertSame('image/png', getimagesizefromstring($bytes)['mime']);
    }
}
