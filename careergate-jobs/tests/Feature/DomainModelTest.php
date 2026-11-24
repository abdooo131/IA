<?php

namespace Tests\Feature;

use App\Enums\JobStatus;
use App\Enums\Stage;
use App\Models\Applicant;
use App\Models\Application;
use App\Models\CvFile;
use App\Models\JobPosting;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class DomainModelTest extends TestCase
{
    use RefreshDatabase;

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

    public function test_public_url_and_open_scope(): void
    {
        $job = JobPosting::factory()->open()->create(['title_en' => 'Driver']);
        JobPosting::factory()->create(['status' => JobStatus::Draft]);
        $this->assertSame(url('/jobs/'.$job->slug), $job->publicUrl());
        $this->assertSame(url('/ar/jobs/'.$job->slug), $job->publicUrl('ar'));
        $this->assertSame(1, JobPosting::open()->count());
    }

    public function test_stage_enum_and_labels(): void
    {
        $this->assertCount(7, Stage::ordered());
        $this->assertSame(Stage::New, Stage::ordered()[0]);
        app()->setLocale('ar');
        $this->assertSame('جديد', Stage::New->label());
        app()->setLocale('en');
        $this->assertSame('Sent to client', Stage::SentToClient->label());
    }

    public function test_user_roles(): void
    {
        $this->assertTrue(User::factory()->admin()->create()->isAdmin());
        $r = User::factory()->create();
        $this->assertFalse($r->isAdmin());
        $this->assertSame('en', $r->fresh()->locale);
        $this->assertTrue($r->fresh()->is_active);
    }

    public function test_application_relations_and_casts(): void
    {
        Storage::fake('local');
        $app = Application::factory()->has(CvFile::factory()->pdf(), 'cvFiles')->create(['answers' => ['q1' => 'yes']]);
        $this->assertSame(Stage::New, $app->fresh()->stage);
        $this->assertSame(['q1' => 'yes'], $app->fresh()->answers);
        $this->assertCount(1, $app->cvFiles);
        $old = CvFile::factory()->create(['application_id' => $app->id, 'replaced_at' => now()]);
        $this->assertCount(1, $app->fresh()->cvFiles);
        $this->assertCount(2, $app->fresh()->allCvFiles);
        $this->assertSame($app->id, $app->applicant->latestApplication->id);
    }

    public function test_applicant_age_and_was_ever_hired(): void
    {
        $this->travelTo(Carbon::parse('2026-06-01', 'Africa/Cairo'));
        $a = Applicant::factory()->create(['date_of_birth' => '2000-06-02']);
        $this->assertSame(25, $a->age());
        $this->assertNull(Applicant::factory()->create(['date_of_birth' => null])->age());

        $this->assertFalse($a->wasEverHired());
        $app = Application::factory()->create(['applicant_id' => $a->id, 'stage' => Stage::Interview]);
        $this->assertFalse($a->wasEverHired());
        $app->stageChanges()->create(['from_stage' => Stage::Interview, 'to_stage' => Stage::Hired]);
        $app->update(['stage' => Stage::Rejected]);
        $this->assertTrue($a->fresh()->wasEverHired());

        $b = Applicant::factory()->create();
        Application::factory()->create(['applicant_id' => $b->id, 'stage' => Stage::Hired]);
        $this->assertTrue($b->wasEverHired());
    }
}
