<?php

namespace App\Observers;

use App\Models\CvFile;
use Illuminate\Support\Facades\Storage;

class CvFileObserver
{
    /** Remove the file from disk when a single CvFile row is deleted. */
    public function deleted(CvFile $cvFile): void
    {
        if ($cvFile->path) {
            Storage::disk('local')->delete($cvFile->path);
        }
    }
}
