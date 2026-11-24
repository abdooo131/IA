<?php

namespace Tests\Feature\Admin;

use App\Enums\JobStatus;
use App\Models\Application;
use App\Models\ClientCompany;
use App\Models\JobPosting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

class JobPostingTest extends TestCase
{
    use RefreshDatabase;

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
        $job = JobPosting::factory()->open()->create(['questions' => [['id' => 'qabc123', 'type' => 'text', 'label_en' => 'Why?', 'required' => false]]]);
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

    public function test_existing_question_ids_are_kept_on_update(): void
    {
        $job = JobPosting::factory()->create(['questions' => [['id' => 'qkeep01', 'type' => 'text', 'label_en' => 'A', 'label_ar' => '', 'options_en' => [], 'options_ar' => [], 'required' => false]]]);
        $this->actingAs(User::factory()->create())->put("/admin/jobs/{$job->id}", [
            'client_company_id' => $job->client_company_id, 'title_en' => 'T', 'city' => 'Cairo', 'employment_type' => 'shift', 'status' => 'draft',
            'questions' => [['id' => 'qkeep01', 'type' => 'text', 'label_en' => 'A2']],
        ])->assertRedirect();
        $this->assertSame('qkeep01', $job->fresh()->questions[0]['id']);
        $this->assertSame('A2', $job->fresh()->questions[0]['label_en']);
    }

    public function test_choice_question_needs_options(): void
    {
        $this->actingAs(User::factory()->create())->post('/admin/jobs', [
            'client_company_id' => ClientCompany::factory()->create()->id, 'title_en' => 'T', 'city' => 'Cairo',
            'employment_type' => 'full_time', 'status' => 'draft',
            'questions' => [['type' => 'choice', 'label_en' => 'Pick']],
        ])->assertSessionHasErrors('questions.0.options_en');
    }

    public function test_choice_options_must_match_in_count_across_languages(): void
    {
        $this->actingAs(User::factory()->create())->post('/admin/jobs', [
            'client_company_id' => ClientCompany::factory()->create()->id, 'title_en' => 'T', 'city' => 'Cairo',
            'employment_type' => 'full_time', 'status' => 'draft',
            'questions' => [['type' => 'choice', 'label_en' => 'Shift?', 'label_ar' => 'الوردية؟', 'options_en' => ['Morning', 'Night'], 'options_ar' => ['صباحي']]],
        ])->assertSessionHasErrors('questions.0.options_ar');
        $this->assertSame(0, JobPosting::count());
    }

    public function test_reopening_expired_job_requires_new_date(): void
    {
        $job = JobPosting::factory()->create(['status' => JobStatus::Closed, 'closes_on' => now('Africa/Cairo')->subDays(3)]);
        $user = User::factory()->create();
        $this->actingAs($user)->patch("/admin/jobs/{$job->id}/status", ['status' => 'open'])->assertSessionHasErrors('status');
        $this->assertSame(JobStatus::Closed, $job->fresh()->status);
        $job->update(['closes_on' => null]);
        $this->actingAs($user)->patch("/admin/jobs/{$job->id}/status", ['status' => 'open'])->assertRedirect();
        $this->assertSame(JobStatus::Open, $job->fresh()->status);
    }

    public function test_jobs_index_and_show_render(): void
    {
        $job = JobPosting::factory()->open()->create();
        Application::factory()->create(['job_posting_id' => $job->id]);
        $user = User::factory()->create();
        $this->actingAs($user)->get('/admin/jobs?status=open')->assertOk()->assertSee($job->title_en);
        $this->actingAs($user)->get("/admin/jobs/{$job->id}")->assertOk()->assertSee($job->publicUrl('ar'), false)->assertSee($job->publicUrl('en'), false);
        $this->actingAs($user)->get('/admin/jobs/create')->assertOk();
        $this->actingAs($user)->get("/admin/jobs/{$job->id}/edit")->assertOk();
    }
}
