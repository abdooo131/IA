<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Schedule::command('jobs:close-expired')->dailyAt('00:05')->timezone('Africa/Cairo');

Schedule::command('backup:clean')->dailyAt('02:00')->timezone('Africa/Cairo');
Schedule::command('backup:run --only-db')->dailyAt('02:00')->timezone('Africa/Cairo');
Schedule::command('applicants:purge-expired')->dailyAt('03:00')->timezone('Africa/Cairo');

// Shared hosting has no long running worker: drain the queue (export jobs) from the once a minute cron.
Schedule::command('queue:work --stop-when-empty --max-time=50')->everyMinute()->withoutOverlapping();
