<?php

namespace App\Events;

use App\Enums\Stage;
use App\Models\Application;
use Illuminate\Foundation\Events\Dispatchable;

class ApplicationStageChanged
{
    use Dispatchable;

    public function __construct(
        public Application $application,
        public Stage $from,
        public Stage $to,
    ) {}
}
