<?php

namespace App\Console\Commands;

use App\Enums\JobStatus;
use App\Models\JobPosting;
use Illuminate\Console\Command;

class CloseExpiredJobs extends Command
{
    protected $signature = 'jobs:close-expired';

    protected $description = 'Close open jobs whose closing date is before today (Africa/Cairo)';

    public function handle(): int
    {
        $today = now('Africa/Cairo')->toDateString();

        $count = JobPosting::where('status', JobStatus::Open->value)
            ->whereNotNull('closes_on')
            ->whereDate('closes_on', '<', $today)
            ->update(['status' => JobStatus::Closed->value]);

        $this->info("Closed {$count} expired job(s).");

        return self::SUCCESS;
    }
}
