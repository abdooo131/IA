<?php

namespace Tests\Feature\Public;

use App\Enums\JobStatus;
use App\Models\JobPosting;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class JobPagesTest extends TestCase
{
    use RefreshDatabase;

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
        $this->get('/jobs?q=WARE')->assertSee('Warehouse Associate');
    }

    public function test_arabic_list_and_empty_state(): void
    {
        $this->get('/ar/jobs')->assertOk()->assertSee(__('public.jobs_empty', [], 'ar'));
        JobPosting::factory()->open()->create(['title_ar' => 'مسؤول مخازن']);
        $this->get('/ar/jobs?q=مخازن')->assertSee('مسؤول مخازن');
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
        $this->get("/ar/jobs/{$job->slug}")->assertNotFound();
    }

    public function test_client_name_hidden_unless_enabled(): void
    {
        $job = JobPosting::factory()->open()->create(['show_client_name' => false]);
        $this->get("/jobs/{$job->slug}")->assertDontSee($job->clientCompany->name);

        $shown = JobPosting::factory()->open()->create(['show_client_name' => true]);
        $this->get("/jobs/{$shown->slug}")->assertSee($shown->clientCompany->name);
    }

    public function test_bullets_one_per_line_and_apply_section_when_open(): void
    {
        $job = JobPosting::factory()->open()->create([
            'responsibilities_en' => "Pick orders\n\nPack boxes",
        ]);
        $this->get("/jobs/{$job->slug}")->assertOk()
            ->assertSee('<li>Pick orders</li>', false)
            ->assertSee('<li>Pack boxes</li>', false)
            ->assertSee('id="apply"', false);
    }

    public function test_about_pages(): void
    {
        $this->get('/about')->assertOk()->assertSee('https://www.facebook.com/Careergateegypt', false);
        $this->get('/ar/about')->assertOk()->assertSee('https://www.facebook.com/Careergateegypt', false);
    }
}
