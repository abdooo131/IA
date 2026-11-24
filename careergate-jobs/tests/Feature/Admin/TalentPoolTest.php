<?php

namespace Tests\Feature\Admin;

use App\Enums\JobStatus;
use App\Enums\Stage;
use App\Models\Applicant;
use App\Models\Application;
use App\Models\CvFile;
use App\Models\JobPosting;
use App\Models\StageChange;
use App\Models\User;
use App\Services\TalentPoolQuery;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class TalentPoolTest extends TestCase
{
    use RefreshDatabase;

    private function names(array $filters): array
    {
        return TalentPoolQuery::apply(Applicant::query(), $filters)->pluck('full_name')->all();
    }

    private function applicant(string $name, array $attrs = [], ?Stage $stage = Stage::New, ?JobPosting $job = null, $at = null): Applicant
    {
        $a = Applicant::factory()->create(['full_name' => $name] + $attrs);
        if ($stage) {
            $this->apply($a, $stage, $job, $at);
        }

        return $a;
    }

    private function apply(Applicant $a, Stage $stage, ?JobPosting $job = null, $at = null): Application
    {
        return Application::factory()->create([
            'applicant_id' => $a->id,
            'job_posting_id' => ($job ?? JobPosting::factory()->open()->create())->id,
            'stage' => $stage,
            'created_at' => $at ?? now(),
        ]);
    }

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
        $prev = Application::factory()->has(CvFile::factory()->count(2)->pdf(), 'cvFiles')->create();
        $job = JobPosting::factory()->open()->create();
        $u = User::factory()->create();
        $this->actingAs($u)->post("/admin/applicants/{$prev->applicant_id}/add-to-job", ['job_posting_id' => $job->id])->assertRedirect();
        $new = Application::where('job_posting_id', $job->id)->sole();
        $this->assertSame('talent_pool', $new->source);
        $this->assertSame($u->id, $new->added_by);
        $this->assertCount(2, $new->cvFiles);
        $this->assertNotEquals($prev->cvFiles->pluck('path'), $new->cvFiles->pluck('path'));
        foreach ($new->cvFiles as $f) {
            $this->assertStringStartsWith("cvs/{$new->id}/", $f->path);
            Storage::disk('local')->assertExists($f->path);
        }
        foreach ($prev->cvFiles as $f) {
            Storage::disk('local')->assertExists($f->path);
        }
        $change = StageChange::where('application_id', $new->id)->sole();
        $this->assertNull($change->from_stage);
        $this->assertSame(Stage::New, $change->to_stage);
        $this->assertSame($u->id, $change->user_id);
    }

    public function test_cannot_add_twice_or_to_closed_job(): void
    {
        $app = Application::factory()->create();
        $closed = JobPosting::factory()->create(['status' => JobStatus::Closed]);
        $this->actingAs(User::factory()->create());
        $this->post("/admin/applicants/{$app->applicant_id}/add-to-job", ['job_posting_id' => $app->job_posting_id])->assertSessionHasErrors('job_posting_id');
        $this->post("/admin/applicants/{$app->applicant_id}/add-to-job", ['job_posting_id' => $closed->id])->assertSessionHasErrors('job_posting_id');
    }

    public function test_refuses_when_applicant_has_no_cv_files(): void
    {
        $prev = Application::factory()->create();
        $job = JobPosting::factory()->open()->create();
        $this->actingAs(User::factory()->create())
            ->post("/admin/applicants/{$prev->applicant_id}/add-to-job", ['job_posting_id' => $job->id])
            ->assertSessionHasErrors('job_posting_id');
        $this->assertSame(0, Application::where('job_posting_id', $job->id)->count());
    }

    public function test_failed_copy_rolls_back_and_cleans_up(): void
    {
        Storage::fake('local');
        $prev = Application::factory()->has(CvFile::factory()->count(2)->pdf(), 'cvFiles')->create();
        // Second file is missing on disk, so the copy fails midway.
        Storage::disk('local')->delete($prev->cvFiles()->get()[1]->path);
        $job = JobPosting::factory()->open()->create();
        $this->actingAs(User::factory()->create())
            ->post("/admin/applicants/{$prev->applicant_id}/add-to-job", ['job_posting_id' => $job->id])
            ->assertSessionHasErrors('job_posting_id');
        $this->assertSame(0, Application::where('job_posting_id', $job->id)->count());
        $this->assertSame(0, CvFile::count() - 2);
        $this->assertCount(1, Storage::disk('local')->allFiles());
    }

    public function test_copies_from_latest_application_with_cv_files(): void
    {
        Storage::fake('local');
        $a = Applicant::factory()->create();
        $old = Application::factory()->create(['applicant_id' => $a->id, 'created_at' => now()->subDays(5)]);
        CvFile::factory()->pdf()->create(['application_id' => $old->id, 'original_name' => 'old.pdf']);
        $newer = Application::factory()->create(['applicant_id' => $a->id, 'created_at' => now()->subDay()]);
        CvFile::factory()->pdf()->create(['application_id' => $newer->id, 'original_name' => 'newer.pdf']);
        Application::factory()->create(['applicant_id' => $a->id, 'created_at' => now()]); // latest, no cv
        $job = JobPosting::factory()->open()->create();
        $this->actingAs(User::factory()->create())->post("/admin/applicants/{$a->id}/add-to-job", ['job_posting_id' => $job->id])->assertRedirect();
        $new = Application::where('job_posting_id', $job->id)->sole();
        $this->assertSame(['newer.pdf'], $new->cvFiles->pluck('original_name')->all());
    }

    public function test_redirects_to_new_application_page(): void
    {
        Storage::fake('local');
        $prev = Application::factory()->has(CvFile::factory()->pdf(), 'cvFiles')->create();
        $job = JobPosting::factory()->open()->create();
        $r = $this->actingAs(User::factory()->create())->post("/admin/applicants/{$prev->applicant_id}/add-to-job", ['job_posting_id' => $job->id]);
        $new = Application::where('job_posting_id', $job->id)->sole();
        $r->assertRedirect(route('admin.applications.show', $new))->assertSessionHas('status');
    }

    public function test_requires_login(): void
    {
        $this->get('/admin/talent-pool')->assertRedirect();
    }

    public function test_q_filters_by_name_or_normalized_phone(): void
    {
        $this->applicant('Nour Hassan', ['phone' => '+201012345678']);
        $this->applicant('Karim', ['phone' => '+201112345678']);
        $this->assertSame(['Nour Hassan'], $this->names(['q' => 'nour']));
        $this->assertSame(['Nour Hassan'], $this->names(['q' => '010 1234 5678']));
        $this->assertSame(['Karim'], $this->names(['q' => '+20 111 234 5678']));
    }

    public function test_city_area_job_and_applied_date_filters(): void
    {
        $job = JobPosting::factory()->open()->create();
        $this->applicant('A', ['city' => 'Giza', 'area' => 'Dokki'], Stage::New, $job, '2026-01-10 12:00:00');
        $this->applicant('B', ['city' => 'Cairo', 'area' => 'Maadi'], Stage::New, null, '2026-02-10 12:00:00');
        $this->assertSame(['A'], $this->names(['city' => 'Giza']));
        $this->assertSame(['B'], $this->names(['area' => 'maa']));
        $this->assertSame(['A'], $this->names(['job_id' => $job->id]));
        $this->assertSame(['A'], $this->names(['applied_from' => '2026-01-10', 'applied_to' => '2026-01-10']));
        $this->assertSame(['B'], $this->names(['applied_from' => '2026-02-01']));
        $this->assertSame(['A'], $this->names(['applied_to' => '2026-01-31']));
    }

    public function test_age_filters_boundaries_and_null_dob(): void
    {
        $this->travelTo(now('Africa/Cairo')->setDate(2026, 6, 15)->startOfDay());
        $this->applicant('Exactly25', ['date_of_birth' => '2001-06-15']);
        $this->applicant('Still24', ['date_of_birth' => '2001-06-16']);
        $this->applicant('Exactly30', ['date_of_birth' => '1996-06-15']);
        $this->applicant('Almost31', ['date_of_birth' => '1995-06-16']);
        $this->applicant('Is31', ['date_of_birth' => '1995-06-15']);
        $this->applicant('NoDob', ['date_of_birth' => null]);
        $this->assertEqualsCanonicalizing(['Exactly25', 'Exactly30', 'Almost31', 'Is31'], $this->names(['age_min' => 25]));
        $this->assertEqualsCanonicalizing(['Still24', 'Exactly25', 'Exactly30', 'Almost31'], $this->names(['age_max' => 30]));
        $this->assertEqualsCanonicalizing(['Exactly25', 'Exactly30', 'Almost31'], $this->names(['age_min' => 25, 'age_max' => 30]));
        $this->assertContains('NoDob', $this->names([]));
    }

    public function test_best_stage_is_highest_ever_reached(): void
    {
        $job = JobPosting::factory()->open()->create();
        $reachedInterview = $this->applicant('WasInterviewed', [], Stage::Rejected, $job);
        $app = $reachedInterview->applications()->first();
        StageChange::create(['application_id' => $app->id, 'from_stage' => Stage::New, 'to_stage' => Stage::Interview]);
        StageChange::create(['application_id' => $app->id, 'from_stage' => Stage::Interview, 'to_stage' => Stage::Rejected]);
        $this->applicant('JustNew', [], Stage::New);
        $this->applicant('Short', [], Stage::Shortlisted);
        $this->applicant('Hired', [], Stage::Hired);
        $this->applicant('Rejected', [], Stage::Rejected);

        $this->assertEqualsCanonicalizing(['WasInterviewed', 'Hired'], $this->names(['best_stage' => 'interview']));
        $this->assertEqualsCanonicalizing(['WasInterviewed', 'Hired', 'Short'], $this->names(['best_stage' => 'shortlisted']));
        $this->assertCount(5, $this->names(['best_stage' => 'new']));
        $this->assertEqualsCanonicalizing(['WasInterviewed', 'Rejected'], $this->names(['best_stage' => 'rejected']));
        $this->assertSame(['Hired'], $this->names(['best_stage' => 'hired']));
    }

    public function test_results_page_shows_details_sorted_latest_first(): void
    {
        $j1 = JobPosting::factory()->open()->create(['title_en' => 'Cashier']);
        $j2 = JobPosting::factory()->open()->create(['title_en' => 'Driver']);
        $old = $this->applicant('Older', ['phone' => '+201012345678'], Stage::Reviewed, $j1, now()->subDays(3));
        $this->apply($old, Stage::Shortlisted, $j2, now()->subDays(2));
        $this->applicant('Newer', ['phone' => '+201112345678'], Stage::New, $j1, now());

        $this->actingAs(User::factory()->create())->get('/admin/talent-pool')
            ->assertSeeInOrder(['Newer', 'Older'])
            ->assertSee('01012345678')
            ->assertSee('https://wa.me/201012345678', false)
            ->assertSee('Driver')
            ->assertSee('Shortlisted');
    }

    public function test_list_page_runs_constant_queries(): void
    {
        $job = JobPosting::factory()->open()->create();
        foreach (range(1, 12) as $i) {
            $a = $this->applicant("P{$i}", [], Stage::New, $job);
            $this->apply($a, Stage::Reviewed);
        }
        $this->actingAs(User::factory()->create());
        \DB::enableQueryLog();
        $this->get('/admin/talent-pool')->assertOk();
        $this->assertLessThan(20, count(\DB::getQueryLog()));
    }
}
