<?php

namespace App\Services;

use App\Models\Applicant;
use App\Models\Application;
use App\Models\Comment;
use App\Models\CvFile;
use App\Models\Export;
use App\Models\StageChange;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * Permanently erases an applicant and everything attached to them.
 * DB level cascades do not fire model events, so files are collected up front
 * and removed from disk only after the transaction has committed.
 */
class ApplicantEraser
{
    public function erase(Applicant $applicant): void
    {
        $applicationIds = [];
        $paths = [];
        $exportIds = [];

        // Collect inside the transaction (with a lock) so an application added concurrently
        // is never cascaded away without its files being collected.
        DB::transaction(function () use ($applicant, &$applicationIds, &$paths, &$exportIds) {
            $applicationIds = Application::where('applicant_id', $applicant->id)->lockForUpdate()->pluck('id')->all();
            $jobIds = Application::where('applicant_id', $applicant->id)->pluck('job_posting_id')->unique()->all();

            // Every CV file, including replaced versions.
            $paths = CvFile::whereIn('application_id', $applicationIds)->pluck('path')->all();

            // Exports of the applicant's jobs hold their name, phone, email, age and CV copies.
            $exportIds = Export::whereIn('job_posting_id', $jobIds)->pluck('id')->all();

            CvFile::whereIn('application_id', $applicationIds)->delete();
            StageChange::whereIn('application_id', $applicationIds)->delete();
            Comment::whereIn('application_id', $applicationIds)->delete();
            Application::whereIn('id', $applicationIds)->delete();
            Export::whereIn('id', $exportIds)->delete();
            $applicant->delete();
        });

        $disk = Storage::disk('local');
        foreach ($paths as $path) {
            $disk->delete($path);
        }
        foreach ($applicationIds as $id) {
            $dir = "cvs/{$id}";
            if ($disk->directoryExists($dir) && $disk->allFiles($dir) === []) {
                $disk->deleteDirectory($dir);
            }
        }
        foreach ($exportIds as $id) {
            $disk->deleteDirectory("exports/{$id}");
        }
    }
}
