<?php

namespace Tests\Feature\Admin;

use App\Enums\Stage;
use App\Jobs\BuildShortlistExport;
use App\Models\Applicant;
use App\Models\Application;
use App\Models\Comment;
use App\Models\CvFile;
use App\Models\Export;
use App\Models\JobPosting;
use App\Models\User;
use App\Services\ShortlistExporter;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use OpenSpout\Reader\XLSX\Reader;
use RuntimeException;
use Tests\TestCase;
use ZipArchive;

class ExportTest extends TestCase
{
    use RefreshDatabase;

    /** @return array<int, array<int, mixed>> */
    private function readXlsx(string $path): array
    {
        $reader = new Reader;
        $reader->open($path);
        $rows = [];
        foreach ($reader->getSheetIterator() as $sheet) {
            foreach ($sheet->getRowIterator() as $row) {
                $rows[] = $row->toArray();
            }
            break;
        }
        $reader->close();

        return $rows;
    }

    private function cv(): Factory
    {
        return CvFile::factory()->pdf();
    }

    public function test_export_contains_selected_stages_without_internal_data(): void
    {
        Storage::fake('local');
        $job = JobPosting::factory()->create(['questions' => [['id' => 'q1', 'type' => 'yes_no', 'label_en' => 'Near Nasr City?', 'required' => true]]]);
        $a = Application::factory()->for($job)->for(Applicant::factory()->state(['full_name' => 'محمد علي', 'phone' => '+201012345678']))->has($this->cv(), 'cvFiles')
            ->create(['stage' => Stage::Shortlisted, 'answers' => ['q1' => 'yes']]);
        Application::factory()->for($job)->for(Applicant::factory()->state(['full_name' => 'محمد علي']))->has($this->cv(), 'cvFiles')->create(['stage' => Stage::Shortlisted]);
        Application::factory()->for($job)->for(Applicant::factory()->state(['full_name' => 'Rejected Person']))->create(['stage' => Stage::Rejected]);
        Comment::factory()->for($a)->create(['body' => 'INTERNAL']);

        $this->actingAs(User::factory()->create())->post("/admin/jobs/{$job->id}/exports", ['stages' => ['shortlisted']]);
        $export = Export::sole();
        $this->assertSame('ready', $export->fresh()->status);
        $rows = $this->readXlsx(Storage::disk('local')->path($export->fresh()->xlsx_path));
        $this->assertSame(['Name', 'Phone', 'Email', 'City', 'Area', 'Age', 'Stage', 'Applied on', 'Near Nasr City?'], $rows[0]);
        $this->assertSame('محمد علي', $rows[1][0]);
        $this->assertCount(3, $rows);
        $this->assertSame('01012345678', $rows[1][1]);
        $this->assertSame('Shortlisted', $rows[1][6]);
        $this->assertContains('Yes', array_merge($rows[1], $rows[2]));
        $this->assertStringNotContainsString('INTERNAL', json_encode($rows, JSON_UNESCAPED_UNICODE));
        $this->assertStringNotContainsString('Rejected Person', json_encode($rows, JSON_UNESCAPED_UNICODE));

        $zip = new ZipArchive;
        $zip->open(Storage::disk('local')->path($export->fresh()->zip_path));
        $names = collect(range(0, $zip->numFiles - 1))->map(fn ($i) => $zip->getNameIndex($i));
        $this->assertCount(2, $names);
        $this->assertTrue($names->contains(fn ($n) => str_starts_with($n, '01 محمد علي/')));
        $this->assertTrue($names->contains(fn ($n) => str_starts_with($n, '02 محمد علي/')));
    }

    public function test_applicant_without_cv_file_keeps_excel_row_and_skips_zip_entry(): void
    {
        Storage::fake('local');
        $job = JobPosting::factory()->create();
        Application::factory()->for($job)->for(Applicant::factory()->state(['full_name' => 'Amr A']))->create(['stage' => Stage::Shortlisted]);
        Application::factory()->for($job)->for(Applicant::factory()->state(['full_name' => 'Bola B']))->has($this->cv(), 'cvFiles')->create(['stage' => Stage::Shortlisted]);

        $this->actingAs(User::factory()->create())->post("/admin/jobs/{$job->id}/exports", [])->assertRedirect();
        $export = Export::sole()->fresh();
        $this->assertSame(['shortlisted'], $export->stages);
        $this->assertSame('ready', $export->status);
        $this->assertCount(3, $this->readXlsx(Storage::disk('local')->path($export->xlsx_path)));
        $zip = new ZipArchive;
        $zip->open(Storage::disk('local')->path($export->zip_path));
        $this->assertSame(1, $zip->numFiles);
        $this->assertStringStartsWith('02 Bola B/', $zip->getNameIndex(0));
    }

    public function test_unsafe_names_are_sanitized_and_duplicates_suffixed(): void
    {
        Storage::fake('local');
        $job = JobPosting::factory()->create();
        $app = Application::factory()->for($job)->for(Applicant::factory()->state(['full_name' => 'A/B:C*']))->create(['stage' => Stage::Shortlisted]);
        CvFile::factory()->pdf()->create(['application_id' => $app->id, 'original_name' => '../cv?.pdf', 'position' => 0]);
        CvFile::factory()->pdf()->create(['application_id' => $app->id, 'original_name' => '../cv?.pdf', 'position' => 1]);

        $this->actingAs(User::factory()->create())->post("/admin/jobs/{$job->id}/exports", ['stages' => ['shortlisted']]);
        $export = Export::sole()->fresh();
        $zip = new ZipArchive;
        $zip->open(Storage::disk('local')->path($export->zip_path));
        $names = [$zip->getNameIndex(0), $zip->getNameIndex(1)];
        sort($names);
        $this->assertSame(['01 ABC/cv (2).pdf', '01 ABC/cv.pdf'], $names);
    }

    public function test_download_requires_login_and_ready(): void
    {
        $export = Export::factory()->create(['status' => 'pending']);
        $this->get("/admin/exports/{$export->id}/xlsx")->assertRedirect('/admin/login');
        $this->actingAs(User::factory()->create())->get("/admin/exports/{$export->id}/xlsx")->assertNotFound();
    }

    public function test_ready_export_downloads_as_attachment(): void
    {
        Storage::fake('local');
        $job = JobPosting::factory()->create(['slug' => 'driver']);
        Application::factory()->for($job)->create(['stage' => Stage::Shortlisted]);
        $user = User::factory()->create();
        $this->actingAs($user)->post("/admin/jobs/{$job->id}/exports", []);
        $export = Export::sole();
        $res = $this->get("/admin/exports/{$export->id}/xlsx");
        $res->assertOk();
        $this->assertStringContainsString('attachment', $res->headers->get('content-disposition'));
        $this->assertStringContainsString('driver-shortlist.xlsx', $res->headers->get('content-disposition'));
        $this->get("/admin/exports/{$export->id}/zip")->assertOk();
        $this->get("/admin/exports/{$export->id}/pdf")->assertNotFound();
    }

    public function test_job_page_lists_exports(): void
    {
        $job = JobPosting::factory()->create();
        Export::factory()->create(['job_posting_id' => $job->id, 'status' => 'ready', 'xlsx_path' => 'x', 'zip_path' => 'y']);
        $this->actingAs(User::factory()->create())->get("/admin/jobs/{$job->id}")
            ->assertOk()->assertSee('exports/', false)->assertSee('name="stages[]"', false);
    }

    public function test_failed_build_marks_export_failed(): void
    {
        $export = Export::factory()->create(['job_posting_id' => JobPosting::factory()->create()->id]);
        $exporter = new class extends ShortlistExporter
        {
            public function build(Export $export): void
            {
                throw new RuntimeException('disk full');
            }
        };
        (new BuildShortlistExport($export))->handle($exporter);
        $export = $export->fresh();
        $this->assertSame('failed', $export->status);
        $this->assertNotEmpty($export->error);
    }

    public function test_prune_deletes_old_exports_and_files(): void
    {
        Storage::fake('local');
        $old = Export::factory()->create(['status' => 'ready', 'created_at' => now()->subDays(31)]);
        $new = Export::factory()->create(['status' => 'ready']);
        Storage::disk('local')->put("exports/{$old->id}/a.xlsx", 'x');
        Storage::disk('local')->put("exports/{$new->id}/a.xlsx", 'x');
        $this->artisan('exports:prune')->assertSuccessful();
        $this->assertNull(Export::find($old->id));
        $this->assertNotNull(Export::find($new->id));
        Storage::disk('local')->assertMissing("exports/{$old->id}/a.xlsx");
        Storage::disk('local')->assertExists("exports/{$new->id}/a.xlsx");
    }

    public function test_queue_retry_after_exceeds_export_timeout(): void
    {
        $job = new BuildShortlistExport(Export::factory()->make());
        $this->assertGreaterThan($job->timeout, config('queue.connections.database.retry_after'));
    }

    public function test_only_yes_no_questions_are_converted(): void
    {
        Storage::fake('local');
        $job = JobPosting::factory()->create(['questions' => [
            ['id' => 'q1', 'type' => 'text', 'label_en' => 'Notice?', 'required' => false],
            ['id' => 'q2', 'type' => 'yes_no', 'label_en' => 'Car?', 'required' => false],
        ]]);
        Application::factory()->for($job)->create(['stage' => Stage::Shortlisted, 'answers' => ['q1' => 'no', 'q2' => 'no']]);
        $this->actingAs(User::factory()->create())->post("/admin/jobs/{$job->id}/exports", []);
        $rows = $this->readXlsx(Storage::disk('local')->path(Export::sole()->xlsx_path));
        $this->assertSame(['no', 'No'], array_slice($rows[1], 8, 2));
    }
}
