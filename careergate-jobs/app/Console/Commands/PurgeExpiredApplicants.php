<?php

namespace App\Console\Commands;

use App\Models\Applicant;
use App\Services\ApplicantEraser;
use Illuminate\Console\Command;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Log;

class PurgeExpiredApplicants extends Command
{
    protected $signature = 'applicants:purge-expired {--dry-run : Only print how many applicants would be deleted}';

    protected $description = 'Permanently delete applicants who were never hired and whose latest application is past the retention period';

    public function handle(ApplicantEraser $eraser): int
    {
        $cutoff = now()->subMonths(max(1, (int) config('careergate.retention_months')));

        $query = fn (): Builder => Applicant::query()
            // No recent application, none currently hired, and none ever moved to hired.
            ->whereDoesntHave('applications', fn (Builder $q) => $q->where('created_at', '>=', $cutoff))
            ->whereDoesntHave('applications', fn (Builder $q) => $q->where('stage', 'hired'))
            ->whereDoesntHave('applications.stageChanges', fn (Builder $q) => $q->where('to_stage', 'hired'))
            // People with no applications at all expire based on when they were created.
            ->where(fn (Builder $q) => $q->whereHas('applications')->orWhere('created_at', '<', $cutoff));

        if ($this->option('dry-run')) {
            $count = $query()->count();
            $this->info("Would delete {$count} expired applicants.");

            return self::SUCCESS;
        }

        $count = 0;
        $query()->chunkById(100, function ($applicants) use ($eraser, &$count) {
            foreach ($applicants as $applicant) {
                $eraser->erase($applicant);
                $count++;
            }
        });

        $this->info("Deleted {$count} expired applicants.");
        Log::info("applicants:purge-expired deleted {$count} applicants.");

        return self::SUCCESS;
    }
}
