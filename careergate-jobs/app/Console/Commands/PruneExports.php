<?php

namespace App\Console\Commands;

use App\Models\Export;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

class PruneExports extends Command
{
    protected $signature = 'exports:prune';

    protected $description = 'Delete shortlist exports (rows and files) older than 30 days';

    public function handle(): int
    {
        $count = 0;
        Export::where('created_at', '<', now()->subDays(30))->each(function (Export $export) use (&$count) {
            Storage::disk('local')->deleteDirectory("exports/{$export->id}");
            $export->delete();
            $count++;
        });
        $this->info("Deleted {$count} old export(s).");

        return self::SUCCESS;
    }
}
