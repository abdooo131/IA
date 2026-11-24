<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\CvFile;
use App\Services\CvStorage;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\HeaderUtils;
use Symfony\Component\HttpFoundation\StreamedResponse;

class CvFileController extends Controller
{
    /** Streams a CV from the private disk. Replaced versions stay viewable by the team. */
    public function show(Request $request, CvFile $cvFile): StreamedResponse
    {
        $disk = Storage::disk(CvStorage::DISK);
        abort_unless($disk->exists($cvFile->path), 404);

        $stream = $disk->readStream($cvFile->path);
        abort_if($stream === null || $stream === false, 404);

        $name = trim($cvFile->original_name) !== '' ? $cvFile->original_name : 'cv';
        $ext = pathinfo($cvFile->path, PATHINFO_EXTENSION);
        $fallback = trim(str_replace(['%', '"', '\\', '/'], '', Str::ascii($name)));
        if ($fallback === '' || ! preg_match('/[A-Za-z0-9]/', $fallback)) {
            $fallback = 'cv'.($ext !== '' ? '.'.$ext : '');
        }
        $disposition = HeaderUtils::makeDisposition(
            $request->boolean('download') ? HeaderUtils::DISPOSITION_ATTACHMENT : HeaderUtils::DISPOSITION_INLINE,
            $name,
            $fallback,
        );

        return response()->stream(function () use ($stream) {
            fpassthru($stream);
            if (is_resource($stream)) {
                fclose($stream);
            }
        }, 200, [
            'Content-Type' => $cvFile->mime,
            'Content-Disposition' => $disposition,
            'X-Content-Type-Options' => 'nosniff',
            'Cache-Control' => 'private, no-store',
            'Content-Length' => (string) $disk->size($cvFile->path),
        ]);
    }
}
