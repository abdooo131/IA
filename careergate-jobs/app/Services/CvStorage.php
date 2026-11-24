<?php

namespace App\Services;

use App\Models\Application;
use App\Models\CvFile;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Throwable;

class CvStorage
{
    public const DISK = 'local';

    private const EXTENSIONS = [
        'application/pdf' => 'pdf',
        'image/jpeg' => 'jpg',
        'image/png' => 'png',
    ];

    /**
     * Store uploaded CV files for an application and create their rows.
     * If anything fails, the files written by this call are removed again.
     *
     * @param  array<int, UploadedFile>  $files
     * @return Collection<int, CvFile>
     */
    public function store(Application $app, array $files): Collection
    {
        $disk = Storage::disk(self::DISK);
        $written = [];
        $rows = collect();

        try {
            foreach (array_values($files) as $position => $file) {
                $mime = (string) $file->getMimeType();
                $ext = self::EXTENSIONS[$mime] ?? null;
                if ($ext === null) {
                    throw new \InvalidArgumentException("Unsupported CV type: {$mime}");
                }

                $name = Str::uuid()->toString().'.'.$ext;
                // Photos are re-encoded so EXIF/GPS metadata never reaches the disk (or the client ZIP).
                $clean = $this->withoutMetadata($file, $mime);
                if ($clean !== null) {
                    $path = "cvs/{$app->id}/{$name}";
                    $path = $disk->put($path, $clean) ? $path : false;
                } else {
                    $path = $disk->putFileAs("cvs/{$app->id}", $file, $name);
                }
                if ($path === false) {
                    throw new \RuntimeException('Could not write CV file.');
                }
                $written[] = $path;

                $rows->push($app->allCvFiles()->create([
                    'original_name' => Str::limit(basename(str_replace('\\', '/', (string) $file->getClientOriginalName())), 250, ''),
                    'path' => $path,
                    'mime' => $mime,
                    'size' => $clean !== null ? strlen($clean) : (int) $file->getSize(),
                    'position' => $position,
                ]));
            }
        } catch (Throwable $e) {
            $disk->delete($written);
            throw $e;
        }

        return $rows;
    }

    /**
     * Re-encode a JPEG or PNG with GD, which drops every metadata block (EXIF, GPS, XMP).
     * JPEGs are rotated upright first so the EXIF orientation is not lost. Returns null for
     * PDFs, and for images GD cannot decode or that are too large to decode safely (the
     * original is then stored unchanged).
     */
    private function withoutMetadata(UploadedFile $file, string $mime): ?string
    {
        if (! in_array($mime, ['image/jpeg', 'image/png'], true) || ! function_exists('imagecreatefromstring')) {
            return null;
        }

        $path = (string) $file->getRealPath();
        $info = @getimagesize($path);
        if ($info === false || $info[0] * $info[1] > 30_000_000) {
            return null;
        }

        $image = $mime === 'image/jpeg' ? @imagecreatefromjpeg($path) : @imagecreatefrompng($path);
        if ($image === false) {
            return null;
        }

        try {
            if ($mime === 'image/jpeg') {
                $image = $this->orient($image, $path);
                ob_start();
                $ok = imagejpeg($image, null, 88);
            } else {
                imagealphablending($image, false);
                imagesavealpha($image, true);
                ob_start();
                $ok = imagepng($image, null, 6);
            }
            $data = (string) ob_get_clean();

            return $ok && $data !== '' ? $data : null;
        } finally {
            unset($image);
        }
    }

    /** Apply the EXIF orientation (if any) to a decoded JPEG. */
    private function orient(\GdImage $image, string $path): \GdImage
    {
        $orientation = 1;
        if (function_exists('exif_read_data')) {
            $exif = @exif_read_data($path);
            $orientation = (int) ($exif['Orientation'] ?? 1);
        }

        // Mirrored variants are rare; only the plain flips and rotations are applied.
        if ($orientation === 2 || $orientation === 4) {
            imageflip($image, $orientation === 4 ? IMG_FLIP_VERTICAL : IMG_FLIP_HORIZONTAL);
        }
        $angle = match ($orientation) {
            3 => 180,
            6 => -90,
            8 => 90,
            default => 0,
        };

        return $angle !== 0 ? (imagerotate($image, $angle, 0) ?: $image) : $image;
    }

    /**
     * Mark the current files as replaced and store the new ones.
     *
     * @param  array<int, UploadedFile>  $files
     * @return Collection<int, CvFile>
     */
    public function replace(Application $app, array $files, User $by): Collection
    {
        $newPaths = [];

        try {
            return DB::transaction(function () use ($app, $files, $by, &$newPaths) {
                $new = $this->store($app, $files);
                $newPaths = $new->pluck('path')->all();

                $app->allCvFiles()
                    ->whereNull('replaced_at')
                    ->whereNotIn('id', $new->pluck('id'))
                    ->get()
                    ->each(fn (CvFile $old) => $old->update(['replaced_at' => now(), 'replaced_by' => $by->id]));

                return $new;
            });
        } catch (Throwable $e) {
            $this->delete($newPaths);
            throw $e;
        }
    }

    /**
     * Copy the source application's current CV files to the target application: new physical
     * files under the target's folder with new names, plus matching rows. If anything fails,
     * the files written by this call are removed again and the exception is rethrown.
     *
     * @return Collection<int, CvFile>
     */
    public function copyCurrent(Application $source, Application $target): Collection
    {
        $disk = Storage::disk(self::DISK);
        $written = [];
        $rows = collect();

        try {
            foreach ($source->cvFiles()->get() as $file) {
                $ext = pathinfo($file->path, PATHINFO_EXTENSION);
                $path = "cvs/{$target->id}/".Str::uuid()->toString().($ext !== '' ? '.'.$ext : '');
                if (! $disk->exists($file->path) || ! $disk->copy($file->path, $path)) {
                    throw new \RuntimeException("Could not copy CV file {$file->id}.");
                }
                $written[] = $path;

                $rows->push($target->allCvFiles()->create([
                    'original_name' => $file->original_name,
                    'path' => $path,
                    'mime' => $file->mime,
                    'size' => $file->size,
                    'position' => $file->position,
                ]));
            }
        } catch (Throwable $e) {
            $disk->delete($written);
            throw $e;
        }

        return $rows;
    }

    /** @param  iterable<int, string>  $paths */
    public function delete(iterable $paths): void
    {
        Storage::disk(self::DISK)->delete(collect($paths)->all());
    }
}
