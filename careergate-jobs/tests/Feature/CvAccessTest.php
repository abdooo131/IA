<?php

namespace Tests\Feature;

use App\Models\CvFile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class CvAccessTest extends TestCase
{
    use RefreshDatabase;

    public function test_guest_cannot_fetch_cv_and_files_are_not_public(): void
    {
        Storage::fake('local');
        $cv = CvFile::factory()->create();
        $this->get("/admin/cv-files/{$cv->id}")->assertRedirect('/admin/login');
        $this->assertFalse(str_starts_with($cv->path, 'public/'));
        $this->get('/storage/'.$cv->path)->assertNotFound();
    }

    public function test_real_file_is_not_reachable_through_storage_url(): void
    {
        Storage::fake('local');
        $cv = CvFile::factory()->pdf()->create();
        Storage::disk('local')->assertExists($cv->path);
        $this->get('/storage/'.$cv->path)->assertNotFound();
        $this->actingAs(User::factory()->create())->get('/storage/'.$cv->path)->assertNotFound();
    }

    public function test_team_member_views_cv_inline(): void
    {
        Storage::fake('local');
        $cv = CvFile::factory()->pdf()->create();
        $this->actingAs(User::factory()->create())->get("/admin/cv-files/{$cv->id}")
            ->assertOk()->assertHeader('Content-Type', 'application/pdf')
            ->assertHeader('X-Content-Type-Options', 'nosniff')
            ->assertHeader('Content-Disposition', 'inline; filename=cv.pdf');
        $this->assertStringContainsString('no-store', $this->get("/admin/cv-files/{$cv->id}")->headers->get('Cache-Control'));
        $this->assertStringContainsString('private', $this->get("/admin/cv-files/{$cv->id}")->headers->get('Cache-Control'));
    }

    public function test_download_flag_and_arabic_filename(): void
    {
        Storage::fake('local');
        $cv = CvFile::factory()->pdf()->create(['original_name' => 'السيرة الذاتية.pdf']);
        $r = $this->actingAs(User::factory()->create())->get("/admin/cv-files/{$cv->id}?download=1")->assertOk();
        $cd = $r->headers->get('Content-Disposition');
        $this->assertStringStartsWith('attachment;', $cd);
        $this->assertStringContainsStringIgnoringCase("filename*=utf-8''", $cd);
        $this->assertMatchesRegularExpression('/^[\x20-\x7e]+$/', $cd);
    }

    public function test_replaced_file_still_viewable_and_missing_file_is_404(): void
    {
        Storage::fake('local');
        $user = User::factory()->create();
        $old = CvFile::factory()->pdf()->create(['replaced_at' => now(), 'replaced_by' => $user->id]);
        $this->actingAs($user)->get("/admin/cv-files/{$old->id}")->assertOk();
        $gone = CvFile::factory()->create();
        $this->actingAs($user)->get("/admin/cv-files/{$gone->id}")->assertNotFound();
    }
}
