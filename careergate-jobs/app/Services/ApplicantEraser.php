<?php

namespace App\Services;

use App\Models\Applicant;
use App\Models\Application;
use App\Models\Comment;
use App\Models\CvFile;
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
        $applicationIds = Application::where('applicant_id', $applicant->id)->pluck('id')->all();

        // Every CV file, including replaced versions.
        $paths = CvFile::whereIn('application_id', $applicationIds)->pluck('path')->all();

        DB::transaction(function () use ($applicant, $applicationIds) {
            CvFile::whereIn('application_id', $applicationIds)->delete();
            StageChange::whereIn('application_id', $applicationIds)->delete();
            Comment::whereIn('application_id', $applicationIds)->delete();
            Application::whereIn('id', $applicationIds)->delete();
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
    }
}
