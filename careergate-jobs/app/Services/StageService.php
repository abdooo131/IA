<?php

namespace App\Services;

use App\Enums\Stage;
use App\Events\ApplicationStageChanged;
use App\Models\Application;
use App\Models\StageChange;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/** The single place where an application's stage changes (phase 3 hooks WhatsApp messages on the event). */
class StageService
{
    public function move(Application $application, Stage $to, ?User $by): bool
    {
        $from = $application->stage;
        if ($from === $to) {
            return false;
        }

        DB::transaction(function () use ($application, $from, $to, $by) {
            $application->update(['stage' => $to]);
            StageChange::create([
                'application_id' => $application->id,
                'from_stage' => $from,
                'to_stage' => $to,
                'user_id' => $by?->id,
            ]);
        });

        ApplicationStageChanged::dispatch($application, $from, $to);

        return true;
    }
}
