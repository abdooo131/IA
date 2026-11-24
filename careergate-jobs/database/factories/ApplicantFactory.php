<?php

namespace Database\Factories;

use App\Models\Applicant;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Applicant> */
class ApplicantFactory extends Factory
{
    public function definition(): array
    {
        return [
            'full_name' => fake()->name(),
            'phone' => '+201'.fake()->randomElement([0, 1, 2, 5]).fake()->unique()->numerify('########'),
            'email' => fake()->safeEmail(),
            'city' => 'Cairo',
            'area' => fake()->streetName(),
            'date_of_birth' => fake()->dateTimeBetween('-45 years', '-20 years')->format('Y-m-d'),
            'consented_at' => now(),
        ];
    }
}
