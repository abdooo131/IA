<?php

namespace Tests\Feature\Admin;

use App\Enums\Stage;
use App\Models\Application;
use App\Models\JobPosting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class DashboardTest extends TestCase
{
    use RefreshDatabase;

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

    public function test_dashboard_links_and_summary_cards(): void
    {
        $job = JobPosting::factory()->open()->create(['title_en' => 'Picker']);
        $closed = JobPosting::factory()->create(['title_en' => 'Closed Job', 'status' => 'closed']);
        $apps = Application::factory()->for($job)->count(12)->create();
        Application::factory()->for($closed)->create(['stage' => Stage::Shortlisted]);
        Application::factory()->for($job)->create(['stage' => Stage::Shortlisted, 'created_at' => now()->subDays(20)]);

        $r = $this->actingAs(User::factory()->create())->get('/admin')->assertOk();
        $r->assertSee(route('admin.jobs.applications', $job), false);
        $r->assertSee(route('admin.applications.show', $apps->first()), false);
        $r->assertDontSee(route('admin.jobs.applications', $closed), false);
        $r->assertSee('data-card="open-jobs">1<', false);
        $r->assertSee('data-card="applications-7d">13<', false);
        $r->assertSee('data-card="shortlisted">2<', false);
        $this->assertCount(10, $r->viewData('newest'));
    }

    public function test_dashboard_empty_states_offer_post_a_job(): void
    {
        $this->actingAs(User::factory()->create())->get('/admin')->assertOk()
            ->assertSee('Post a job')->assertSee(route('admin.jobs.create'), false);
    }
}
