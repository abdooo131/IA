<?php

namespace Database\Factories;

use App\Models\Export;
use App\Models\JobPosting;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Export> */
class ExportFactory extends Factory
{
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'job_posting_id' => JobPosting::factory(),
            'stages' => ['shortlisted'],
            'status' => 'pending',
            'xlsx_path' => null,
            'zip_path' => null,
            'error' => null,
        ];
    }
}
