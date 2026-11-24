<?php

namespace Database\Factories;

use App\Enums\EmploymentType;
use App\Enums\JobStatus;
use App\Models\ClientCompany;
use App\Models\JobPosting;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<JobPosting> */
class JobPostingFactory extends Factory
{
    public function definition(): array
    {
        return [
            'client_company_id' => ClientCompany::factory(),
            'title_en' => fake()->jobTitle(),
            'title_ar' => 'وظيفة '.fake()->numberBetween(1, 999),
            'city' => 'Cairo',
            'area' => fake()->streetName(),
            'employment_type' => EmploymentType::FullTime,
            'salary_text' => null,
            'responsibilities_en' => fake()->paragraph(),
            'responsibilities_ar' => 'المسؤوليات',
            'requirements_en' => fake()->paragraph(),
            'requirements_ar' => 'المتطلبات',
            'questions' => [],
            'show_client_name' => false,
            'status' => JobStatus::Draft,
            'closes_on' => null,
            'created_by' => User::factory(),
        ];
    }

    public function open(): static
    {
        return $this->state(fn () => ['status' => JobStatus::Open]);
    }
}
