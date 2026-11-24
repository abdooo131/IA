<?php

namespace Tests\Feature\Admin;

use App\Enums\JobStatus;
use App\Enums\Stage;
use App\Models\Applicant;
use App\Models\Application;
use App\Models\Comment;
use App\Models\CvFile;
use App\Models\JobPosting;
use App\Models\StageChange;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ApplicationPageTest extends TestCase
{
    use RefreshDatabase;

    public function test_comment_added_and_shown_with_author(): void
    {
        $app = Application::factory()->create();
        $u = User::factory()->create(['name' => 'Sara']);
        $this->actingAs($u)->post("/admin/applications/{$app->id}/comments", ['body' => 'Strong warehouse experience']);
        $this->get("/admin/applications/{$app->id}")->assertSee('Strong warehouse experience')->assertSee('Sara');
    }

    public function test_comment_validation_and_escaping(): void
    {
        $app = Application::factory()->create();
        $u = User::factory()->create();
        $this->actingAs($u)->post("/admin/applications/{$app->id}/comments", ['body' => ''])->assertSessionHasErrors('body');
        $this->post("/admin/applications/{$app->id}/comments", ['body' => str_repeat('a', 2001)])->assertSessionHasErrors('body');
        $this->post("/admin/applications/{$app->id}/comments", ['body' => "<script>alert(1)</script>\nline2"]);
        $this->get("/admin/applications/{$app->id}")
            ->assertDontSee('<script>alert(1)</script>', false)
            ->assertSee('&lt;script&gt;alert(1)&lt;/script&gt;<br />', false);
    }

    public function test_comments_never_on_public_pages(): void
    {
        $app = Application::factory()->create();
        Comment::factory()->for($app)->create(['body' => 'SECRET NOTE']);
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

    public function test_replace_rejects_mixed_and_bad_files(): void
    {
        Storage::fake('local');
        $app = Application::factory()->hasCvFiles(1)->create();
        $this->actingAs(User::factory()->create())->post("/admin/applications/{$app->id}/cv", ['cv' => [
            UploadedFile::fake()->create('a.pdf', 10, 'application/pdf'),
            UploadedFile::fake()->image('b.jpg'),
        ]])->assertSessionHasErrors('cv');
        $this->post("/admin/applications/{$app->id}/cv", ['cv' => [UploadedFile::fake()->create('x.exe', 10, 'application/x-msdownload')]])
            ->assertSessionHasErrors('cv.0');
        $this->post("/admin/applications/{$app->id}/cv", [])->assertSessionHasErrors('cv');
        $this->assertNull($app->cvFiles->first()->fresh()->replaced_at);
    }

    public function test_only_author_or_admin_deletes_comment(): void
    {
        $c = Comment::factory()->create();
        $this->actingAs(User::factory()->recruiter()->create())->delete("/admin/comments/{$c->id}")->assertForbidden();
        $this->assertModelExists($c);
        $this->actingAs(User::factory()->admin()->create())->delete("/admin/comments/{$c->id}")->assertRedirect();
        $this->assertModelMissing($c);
        $c2 = Comment::factory()->create();
        $this->actingAs($c2->user)->delete("/admin/comments/{$c2->id}")->assertRedirect();
        $this->assertModelMissing($c2);
    }

    public function test_guest_is_redirected_from_page_and_actions(): void
    {
        $app = Application::factory()->create();
        $this->get("/admin/applications/{$app->id}")->assertRedirect('/admin/login');
        $this->post("/admin/applications/{$app->id}/comments", ['body' => 'x'])->assertRedirect('/admin/login');
        $this->post("/admin/applications/{$app->id}/cv", [])->assertRedirect('/admin/login');
    }

    public function test_page_shows_details_answers_history_and_other_applications(): void
    {
        Storage::fake('local');
        $job = JobPosting::factory()->create(['questions' => [
            ['id' => 'q1', 'type' => 'text', 'label_en' => 'Years of experience', 'label_ar' => 'سنوات الخبرة', 'options_en' => [], 'options_ar' => [], 'required' => true],
            ['id' => 'q2', 'type' => 'yes_no', 'label_en' => '', 'label_ar' => 'هل لديك رخصة', 'options_en' => [], 'options_ar' => [], 'required' => false],
        ]]);
        $applicant = Applicant::factory()->create(['full_name' => 'Omar Hassan', 'phone' => '+201012345678', 'city' => 'Cairo', 'date_of_birth' => now()->subYears(30)->subDay()]);
        $app = Application::factory()->for($job)->for($applicant)->create([
            'answers' => ['q1' => '5 years', 'q2' => 'yes', 'gone' => 'legacy value'],
        ]);
        CvFile::factory()->pdf()->create(['application_id' => $app->id]);
        $other = Application::factory()->for($applicant)->create(['stage' => Stage::Hired]);
        $admin = User::factory()->create(['name' => 'Mona']);
        StageChange::create(['application_id' => $app->id, 'from_stage' => Stage::New, 'to_stage' => Stage::Reviewed, 'user_id' => $admin->id]);
        StageChange::create(['application_id' => $app->id, 'from_stage' => Stage::Reviewed, 'to_stage' => Stage::Rejected, 'user_id' => null]);

        $r = $this->actingAs($admin)->get("/admin/applications/{$app->id}")->assertOk();
        $r->assertSee('Omar Hassan')->assertSee('01012345678')->assertSee('https://wa.me/201012345678', false)
            ->assertSee('Years of experience')->assertSee('5 years')
            ->assertSee('هل لديك رخصة')->assertSee('gone')->assertSee('legacy value')
            ->assertSee('Mona')->assertSee('Applicant')
            ->assertSee('<iframe', false)
            ->assertSee(route('admin.applications.show', $other), false);
        $r->assertSeeInOrder(['Rejected', 'Reviewed']);
    }

    public function test_page_has_no_n_plus_one(): void
    {
        Storage::fake('local');
        $mk = function () {
            $a = Application::factory()->hasCvFiles(2)->hasComments(2)->create();
            StageChange::create(['application_id' => $a->id, 'from_stage' => Stage::New, 'to_stage' => Stage::Reviewed, 'user_id' => User::factory()->create()->id]);
            Application::factory()->for($a->applicant)->count(2)->create();

            return $a;
        };
        $user = User::factory()->create();
        $a = $mk();
        $this->actingAs($user)->get("/admin/applications/{$a->id}");
        DB::enableQueryLog();
        $this->get("/admin/applications/{$a->id}");
        $few = count(DB::getQueryLog());
        DB::flushQueryLog();
        $b = $mk();
        Comment::factory()->count(4)->for($b)->create();
        DB::flushQueryLog();
        $this->get("/admin/applications/{$b->id}");
        $this->assertSame($few, count(DB::getQueryLog()));
    }
}
