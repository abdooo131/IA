<?php

namespace Database\Factories;

use App\Enums\Stage;
use App\Models\Applicant;
use App\Models\Application;
use App\Models\JobPosting;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Application> */
class ApplicationFactory extends Factory
{
    public function definition(): array
    {
        return [
            'job_posting_id' => JobPosting::factory(),
            'applicant_id' => Applicant::factory(),
            'stage' => Stage::New,
            'answers' => [],
            'source' => 'applied',
            'added_by' => null,
        ];
    }
}
