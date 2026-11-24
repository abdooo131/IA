<?php

namespace App\Services;

use App\Models\Application;
use App\Models\CvFile;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Collection;
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

                $path = $disk->putFileAs("cvs/{$app->id}", $file, Str::uuid()->toString().'.'.$ext);
                if ($path === false) {
                    throw new \RuntimeException('Could not write CV file.');
                }
                $written[] = $path;

                $rows->push($app->allCvFiles()->create([
                    'original_name' => Str::limit(basename(str_replace('\\', '/', (string) $file->getClientOriginalName())), 250, ''),
                    'path' => $path,
                    'mime' => $mime,
                    'size' => (int) $file->getSize(),
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
     * Mark the current files as replaced and store the new ones.
     *
     * @param  array<int, UploadedFile>  $files
     * @return Collection<int, CvFile>
     */
    public function replace(Application $app, array $files, User $by): Collection
    {
        $new = $this->store($app, $files);

        $app->allCvFiles()
            ->whereNull('replaced_at')
            ->whereNotIn('id', $new->pluck('id'))
            ->update(['replaced_at' => now(), 'replaced_by' => $by->id]);

        return $new;
    }

    /** @param  iterable<int, string>  $paths */
    public function delete(iterable $paths): void
    {
        Storage::disk(self::DISK)->delete(collect($paths)->all());
    }
}
