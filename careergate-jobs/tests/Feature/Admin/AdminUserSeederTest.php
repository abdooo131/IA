<?php

namespace Tests\Feature\Admin;

use App\Models\User;
use Database\Seeders\AdminUserSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class AdminUserSeederTest extends TestCase
{
    use RefreshDatabase;

    public function test_seeder_creates_admin_and_does_not_overwrite_existing(): void
    {
        config(['careergate.admin' => ['email' => 'boss@example.com', 'password' => 'initial-pass', 'name' => 'Boss']]);
        $this->seed(AdminUserSeeder::class);
        $u = User::where('email', 'boss@example.com')->first();
        $this->assertTrue($u->isAdmin());

        $u->update(['password' => 'changed-pass', 'is_active' => false]);
        $this->seed(AdminUserSeeder::class);

        $u->refresh();
        $this->assertTrue(Hash::check('changed-pass', $u->password));
        $this->assertFalse($u->is_active);
        $this->assertSame(1, User::count());
    }
}
