<?php

namespace Tests\Feature\Admin;

use App\Enums\Stage;
use App\Models\Applicant;
use App\Models\Application;
use App\Models\Comment;
use App\Models\JobPosting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class JobApplicationsTest extends TestCase
{
    use RefreshDatabase;

    public function test_filters_by_stage_and_search(): void
    {
        $job = JobPosting::factory()->create();
        Application::factory()->for($job)->for(Applicant::factory()->state(['full_name' => 'Mona Hassan', 'phone' => '+201111111111']))->create(['stage' => Stage::Shortlisted]);
        Application::factory()->for($job)->for(Applicant::factory()->state(['full_name' => 'Omar Said']))->create();
        $this->actingAs(User::factory()->create())->get("/admin/jobs/{$job->id}/applications?stage=shortlisted")
            ->assertSee('Mona Hassan')->assertDontSee('Omar Said');
        $this->get("/admin/jobs/{$job->id}/applications?q=01111111111")->assertSee('Mona Hassan')->assertDontSee('Omar Said');
        $this->get("/admin/jobs/{$job->id}/applications?q=omar")->assertSee('Omar Said')->assertDontSee('Mona Hassan');
    }

    public function test_list_shows_whatsapp_link_comment_count_and_tab_counts(): void
    {
        $job = JobPosting::factory()->create();
        $app = Application::factory()->for($job)->for(Applicant::factory()->state(['full_name' => 'Mona Hassan', 'phone' => '+201111111111']))->create();
        Comment::factory()->count(3)->create(['application_id' => $app->id]);
        $this->actingAs(User::factory()->create())->get("/admin/jobs/{$job->id}/applications")
            ->assertOk()
            ->assertSee('https://wa.me/201111111111', false)
            ->assertSee('01111111111')
            ->assertSee('data-comment-count="3"', false)
            ->assertSee('data-tab-count="new">1<', false)
            ->assertSee('data-tab-count="hired">0<', false);
    }

    public function test_filters_by_city_area_and_dates_and_sorts(): void
    {
        $job = JobPosting::factory()->create();
        $a = Application::factory()->for($job)->for(Applicant::factory()->state(['full_name' => 'Aaa One', 'city' => 'Cairo', 'area' => 'Nasr City']))->create(['created_at' => '2026-01-10 10:00:00']);
        $b = Application::factory()->for($job)->for(Applicant::factory()->state(['full_name' => 'Bbb Two', 'city' => 'Giza', 'area' => 'Dokki']))->create(['created_at' => '2026-02-10 10:00:00']);
        $this->actingAs(User::factory()->create());
        $this->get("/admin/jobs/{$job->id}/applications?city=Giza")->assertSee('Bbb Two')->assertDontSee('Aaa One');
        $this->get("/admin/jobs/{$job->id}/applications?area=nasr")->assertSee('Aaa One')->assertDontSee('Bbb Two');
        $this->get("/admin/jobs/{$job->id}/applications?from=2026-01-10&to=2026-01-10")->assertSee('Aaa One')->assertDontSee('Bbb Two');
        $this->get("/admin/jobs/{$job->id}/applications?sort=asc")->assertSeeInOrder(['Aaa One', 'Bbb Two']);
        $this->get("/admin/jobs/{$job->id}/applications")->assertSeeInOrder(['Bbb Two', 'Aaa One']);
    }

    public function test_bulk_stage_change_ignores_other_jobs(): void
    {
        $job = JobPosting::factory()->create();
        $mine = Application::factory()->for($job)->count(2)->create();
        $other = Application::factory()->create();
        $this->actingAs(User::factory()->create())->patch("/admin/jobs/{$job->id}/applications/bulk-stage",
            ['ids' => [...$mine->pluck('id'), $other->id], 'stage' => 'rejected'])->assertSessionHasErrors('ids');
        $this->assertSame(0, Application::where('stage', 'rejected')->count());
        $this->patch("/admin/jobs/{$job->id}/applications/bulk-stage", ['ids' => $mine->pluck('id')->all(), 'stage' => 'rejected']);
        $this->assertSame(2, Application::where('stage', 'rejected')->count());
        $this->assertDatabaseCount('stage_changes', 2);
    }

    public function test_bulk_requires_valid_stage_and_ids(): void
    {
        $job = JobPosting::factory()->create();
        $this->actingAs(User::factory()->create())->patch("/admin/jobs/{$job->id}/applications/bulk-stage", ['stage' => 'nope'])
            ->assertSessionHasErrors(['ids', 'stage']);
    }

    public function test_single_stage_change(): void
    {
        $app = Application::factory()->create();
        $this->actingAs(User::factory()->create())->from('/back')->patch("/admin/applications/{$app->id}/stage", ['stage' => 'interview'])
            ->assertRedirect('/back')->assertSessionHas('status');
        $this->assertSame(Stage::Interview, $app->fresh()->stage);
    }

    public function test_guests_are_redirected(): void
    {
        $job = JobPosting::factory()->create();
        $this->get("/admin/jobs/{$job->id}/applications")->assertRedirect();
    }
}
