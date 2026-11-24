<?php

namespace Database\Factories;

use App\Models\ClientCompany;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<ClientCompany> */
class ClientCompanyFactory extends Factory
{
    public function definition(): array
    {
        return [
            'name' => fake()->company(),
            'contact_person' => fake()->name(),
            'phone' => '+2010'.fake()->numerify('########'),
            'email' => fake()->unique()->companyEmail(),
            'notes' => null,
        ];
    }
}
