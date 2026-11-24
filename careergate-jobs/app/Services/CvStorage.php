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
