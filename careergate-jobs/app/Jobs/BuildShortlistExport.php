<?php

namespace App\Jobs;

use App\Models\Export;
use App\Services\ShortlistExporter;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;
use Throwable;

class BuildShortlistExport implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public int $timeout = 300;

    public function __construct(public Export $export) {}

    public function handle(ShortlistExporter $exporter): void
    {
        try {
            $exporter->build($this->export);
            $this->export->forceFill(['status' => 'ready', 'error' => null])->save();
        } catch (Throwable $e) {
            $this->failed($e);
        }
    }

    public function failed(?Throwable $e): void
    {
        Log::error('Shortlist export failed.', ['export_id' => $this->export->id, 'exception' => $e ? $e::class : null]);

        // Short message only: no stack trace and no personal data.
        $this->export->forceFill([
            'status' => 'failed',
            'error' => 'The export could not be built'.($e ? ' ('.class_basename($e).')' : '').'. Please try again.',
        ])->save();
    }
}
