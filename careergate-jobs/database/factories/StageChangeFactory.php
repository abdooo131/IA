<?php

namespace Database\Factories;

use App\Enums\Stage;
use App\Models\Application;
use App\Models\StageChange;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<StageChange> */
class StageChangeFactory extends Factory
{
    public function definition(): array
    {
        return [
            'application_id' => Application::factory(),
            'from_stage' => Stage::New,
            'to_stage' => Stage::Reviewed,
            'user_id' => null,
        ];
    }
}
