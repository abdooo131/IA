<?php

namespace Tests\Feature;

use App\Enums\Stage;
use App\Models\Applicant;
use App\Models\Application;
use App\Models\CvFile;
use App\Services\StageService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class RetentionTest extends TestCase
{
    use RefreshDatabase;

    public function test_purge_removes_old_never_hired_only(): void
    {
        Storage::fake('local');
        $old = Application::factory()->create(['created_at' => now()->subMonths(25)]);
        $oldHired = Application::factory()->create(['created_at' => now()->subMonths(30), 'stage' => Stage::Hired]);
        $oldButRecent = Applicant::factory()->create();
        Application::factory()->for($oldButRecent)->create(['created_at' => now()->subMonths(30)]);
        Application::factory()->for($oldButRecent)->create(['created_at' => now()->subMonths(3)]);
        $oldApplicant = $old->applicant;
        $hiredApplicant = $oldHired->applicant;
        $this->artisan('applicants:purge-expired')->expectsOutputToContain('1')->assertSuccessful();
        $this->assertModelMissing($oldApplicant);
        $this->assertModelExists($hiredApplicant);
        $this->assertModelExists($oldButRecent);
    }

    public function test_hired_then_moved_away_still_counts_as_hired(): void
    {
        $app = Application::factory()->create(['created_at' => now()->subMonths(30)]);
        app(StageService::class)->move($app, Stage::Hired, null);
        app(StageService::class)->move($app, Stage::Rejected, null);
        $applicant = $app->applicant;
        $this->artisan('applicants:purge-expired');
        $this->assertModelExists($applicant);
    }

    public function test_dry_run_deletes_nothing_and_prints_count(): void
    {
        $old = Application::factory()->create(['created_at' => now()->subMonths(25)]);
        $applicant = $old->applicant;
        $this->artisan('applicants:purge-expired --dry-run')->expectsOutputToContain('1')->assertSuccessful();
        $this->assertModelExists($applicant);
    }

    public function test_purge_deletes_files_and_respects_configured_months(): void
    {
        Storage::fake('local');
        config(['careergate.retention_months' => 6]);
        $old = Application::factory()->create(['created_at' => now()->subMonths(7)]);
        $cv = CvFile::factory()->pdf()->create(['application_id' => $old->id]);
        $fresh = Application::factory()->create(['created_at' => now()->subMonths(5)]);
        $oldApplicant = $old->applicant;
        $freshApplicant = $fresh->applicant;
        $this->artisan('applicants:purge-expired')->assertSuccessful();
        $this->assertModelMissing($oldApplicant);
        $this->assertModelExists($freshApplicant);
        Storage::disk('local')->assertMissing($cv->path);
    }

    public function test_purge_handles_more_than_one_chunk(): void
    {
        Application::factory()->count(5)->create(['created_at' => now()->subMonths(25)]);
        $this->artisan('applicants:purge-expired')->expectsOutputToContain('5')->assertSuccessful();
        $this->assertSame(0, Applicant::count());
    }
}
