<?php

namespace Tests\Feature\Admin;

use App\Models\Applicant;
use App\Models\Application;
use App\Models\Comment;
use App\Models\CvFile;
use App\Models\StageChange;
use App\Models\User;
use App\Services\ApplicantEraser;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ApplicantDeletionTest extends TestCase
{
    use RefreshDatabase;

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

    public function test_real_files_including_replaced_versions_and_directories_are_removed(): void
    {
        Storage::fake('local');
        $app = Application::factory()->create();
        $current = CvFile::factory()->pdf()->create(['application_id' => $app->id]);
        $old = CvFile::factory()->pdf()->create(['application_id' => $app->id, 'replaced_at' => now()]);
        $keep = CvFile::factory()->pdf()->create();
        Storage::disk('local')->put("cvs/{$app->id}/a.pdf", 'x');
        Storage::disk('local')->put("cvs/{$app->id}/b.pdf", 'x');
        $current->update(['path' => "cvs/{$app->id}/a.pdf"]);
        $old->update(['path' => "cvs/{$app->id}/b.pdf"]);

        $this->actingAs(User::factory()->admin()->create())
            ->delete("/admin/applicants/{$app->applicant_id}", ['confirm' => \App\Support\PhoneNumber::toLocal($app->applicant->phone)])
            ->assertRedirect('/admin/talent-pool')
            ->assertSessionHas('status');

        Storage::disk('local')->assertMissing("cvs/{$app->id}/a.pdf");
        Storage::disk('local')->assertMissing("cvs/{$app->id}/b.pdf");
        $this->assertFalse(Storage::disk('local')->exists("cvs/{$app->id}"));
        Storage::disk('local')->assertExists($keep->path);
    }

    public function test_flash_does_not_contain_name_or_phone(): void
    {
        $app = Application::factory()->create();
        $name = $app->applicant->full_name;
        $phone = $app->applicant->phone;
        $this->actingAs(User::factory()->admin()->create())
            ->delete("/admin/applicants/{$app->applicant_id}", ['confirm' => $phone]);
        $flash = (string) session('status');
        $this->assertNotSame('', $flash);
        $this->assertStringNotContainsString($name, $flash);
        $this->assertStringNotContainsString($phone, $flash);
    }

    public function test_deleting_a_cv_file_model_removes_its_file(): void
    {
        Storage::fake('local');
        $cv = CvFile::factory()->pdf()->create();
        $cv->delete();
        Storage::disk('local')->assertMissing($cv->path);
    }

    public function test_eraser_keeps_other_applicants(): void
    {
        $a = Application::factory()->create();
        $b = Application::factory()->create();
        app(ApplicantEraser::class)->erase($a->applicant);
        $this->assertModelMissing($a->applicant);
        $this->assertModelExists($b->applicant);
    }

    public function test_delete_button_visible_to_admin_only_on_application_page(): void
    {
        $app = Application::factory()->create();
        $this->actingAs(User::factory()->recruiter()->create())->get("/admin/applications/{$app->id}")
            ->assertOk()->assertDontSee('/admin/applicants/'.$app->applicant_id, false);
        $this->actingAs(User::factory()->admin()->create())->get("/admin/applications/{$app->id}")
            ->assertOk()->assertSee('/admin/applicants/'.$app->applicant_id, false);
    }
}
