<?php

namespace App\Services;

use App\Enums\Stage;
use App\Models\Application;
use App\Models\Export;
use App\Support\PhoneNumber;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use OpenSpout\Common\Entity\Row;
use OpenSpout\Writer\XLSX\Writer;
use RuntimeException;
use ZipArchive;

/**
 * Builds the client facing shortlist: an Excel sheet and a ZIP of CVs.
 * Only applicant data, stage and the application date are exported: never comments, stage history, user names or source.
 */
class ShortlistExporter
{
    public const DISK = 'local';

    public function build(Export $export): void
    {
        $job = $export->jobPosting;
        $disk = Storage::disk(self::DISK);
        $dir = "exports/{$export->id}";
        $base = ($job->slug ?: 'job').'-shortlist';
        $xlsxPath = "{$dir}/{$base}.xlsx";
        $zipPath = "{$dir}/{$base}.zip";

        $disk->makeDirectory($dir);
        $xlsxFull = $disk->path($xlsxPath);
        $zipFull = $disk->path($zipPath);

        $questions = collect($job->questions ?? [])->filter(fn ($q) => is_array($q) && isset($q['id']))->values();

        $writer = new Writer;
        $writer->openToFile($xlsxFull);
        $zip = new ZipArchive;
        if ($zip->open($zipFull, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
            throw new RuntimeException('Could not create the ZIP file.');
        }

        try {
            $header = ['Name', 'Phone', 'Email', 'City', 'Area', 'Age', 'Stage', 'Applied on'];
            foreach ($questions as $q) {
                $header[] = (string) (($q['label_en'] ?? '') !== '' ? $q['label_en'] : ($q['label_ar'] ?? $q['id']));
            }
            $writer->addRow(Row::fromValues($header));

            $stages = array_values(array_intersect((array) $export->stages, array_map(fn (Stage $s) => $s->value, Stage::cases())));
            $n = 0;
            $entries = 0;
            $used = [];

            Application::query()
                ->select('applications.*')
                ->join('applicants', 'applicants.id', '=', 'applications.applicant_id')
                ->where('applications.job_posting_id', $job->id)
                ->whereIn('applications.stage', $stages)
                ->orderBy('applicants.full_name')
                ->orderBy('applications.id')
                ->with(['applicant', 'cvFiles'])
                ->chunk(100, function ($applications) use (&$n, &$entries, &$used, $writer, $zip, $questions, $disk, $export) {
                    foreach ($applications as $application) {
                        $n++;
                        $applicant = $application->applicant;
                        $answers = (array) ($application->answers ?? []);
                        $row = [
                            (string) $applicant->full_name,
                            PhoneNumber::toLocal((string) $applicant->phone),
                            (string) $applicant->email,
                            (string) $applicant->city,
                            (string) $applicant->area,
                            $applicant->age(),
                            __('stages.'.$application->stage->value, [], 'en'),
                            $application->created_at?->timezone('Africa/Cairo')->format('Y-m-d'),
                        ];
                        foreach ($questions as $q) {
                            $row[] = $this->answerText($answers[$q['id']] ?? null);
                        }
                        $writer->addRow(Row::fromValues($row));

                        $folder = sprintf('%02d %s', $n, $this->safeName((string) $applicant->full_name, 'Applicant'));
                        $added = 0;
                        foreach ($application->cvFiles as $cv) {
                            if (! $disk->exists($cv->path)) {
                                continue;
                            }
                            $entry = $folder.'/'.$this->uniqueName($used, $folder, $this->safeName((string) $cv->original_name, 'CV'));
                            if ($zip->addFile($disk->path($cv->path), $entry)) {
                                $added++;
                                $entries++;
                            }
                        }
                        if ($added === 0) {
                            Log::warning('Export has an applicant without a readable CV file.', ['export_id' => $export->id]);
                        }
                    }
                });

            $writer->close();
            if ($entries > 0) {
                if (! $zip->close()) {
                    throw new RuntimeException('Could not write the ZIP file.');
                }
            } else {
                // ZipArchive writes nothing for an empty archive: write a valid empty one.
                @$zip->close();
                file_put_contents($zipFull, "PK\x05\x06".str_repeat("\0", 18));
            }
        } catch (\Throwable $e) {
            try {
                $writer->close();
            } catch (\Throwable) {
            }
            @$zip->close();
            $disk->deleteDirectory($dir);
            throw $e;
        }

        $export->forceFill(['xlsx_path' => $xlsxPath, 'zip_path' => $zipPath])->save();
    }

    private function answerText(mixed $value): string
    {
        if ($value === null) {
            return '';
        }
        if ($value === 'yes' || $value === true) {
            return 'Yes';
        }
        if ($value === 'no' || $value === false) {
            return 'No';
        }
        if (is_array($value)) {
            return implode(', ', array_map(fn ($v) => $this->answerText($v), $value));
        }

        return (string) $value;
    }

    /** Strip path separators, reserved and control characters; never return an empty or dots-only name. */
    private function safeName(string $name, string $fallback): string
    {
        $name = preg_replace('/[\/\\\\:*?"<>|\x00-\x1F\x7F]+/u', '', $name) ?? '';
        $name = trim(preg_replace('/\s+/u', ' ', $name) ?? '');
        $name = ltrim($name, ". \t");
        $name = rtrim($name, '. ');

        return $name === '' ? $fallback : mb_substr($name, 0, 120);
    }

    /** @param array<string, bool> $used */
    private function uniqueName(array &$used, string $folder, string $name): string
    {
        $candidate = $name;
        $i = 2;
        while (isset($used[mb_strtolower($folder.'/'.$candidate)])) {
            $candidate = $name.' ('.$i++.')';
        }
        $used[mb_strtolower($folder.'/'.$candidate)] = true;

        return $candidate;
    }
}
