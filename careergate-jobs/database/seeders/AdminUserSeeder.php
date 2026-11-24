<?php

namespace Database\Seeders;

use App\Enums\Role;
use App\Models\User;
use Illuminate\Database\Seeder;

class AdminUserSeeder extends Seeder
{
    public function run(): void
    {
        $email = config('careergate.admin.email');
        $password = config('careergate.admin.password');

        if (! $email || ! $password) {
            $this->command?->warn('ADMIN_EMAIL and ADMIN_PASSWORD are not set; no admin created.');

            return;
        }

        // Only create; never touch an existing account (password, role, status).
        User::firstOrCreate(
            ['email' => $email],
            ['name' => config('careergate.admin.name'), 'password' => $password, 'role' => Role::Admin, 'is_active' => true],
        );
    }
}
