<?php

namespace Tests\Feature\Admin;

use App\Models\User;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Support\Facades\Notification;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class TeamTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_adds_team_member(): void
    {
        Notification::fake();
        $this->actingAs(User::factory()->admin()->create())
            ->post('/admin/team', ['name' => 'Sara', 'email' => 'sara@example.com', 'role' => 'recruiter'])
            ->assertRedirect();
        $this->assertDatabaseHas('users', ['email' => 'sara@example.com', 'role' => 'recruiter', 'is_active' => true]);
        Notification::assertSentTo(User::where('email', 'sara@example.com')->first(), ResetPassword::class);
    }

    public function test_invalid_role_is_rejected(): void
    {
        $this->actingAs(User::factory()->admin()->create())
            ->post('/admin/team', ['name' => 'X', 'email' => 'x@example.com', 'role' => 'superuser'])
            ->assertSessionHasErrors('role');
    }

    public function test_recruiter_cannot_add_or_update(): void
    {
        $r = User::factory()->recruiter()->create();
        $this->actingAs($r)->post('/admin/team', ['name' => 'X', 'email' => 'x@example.com', 'role' => 'admin'])->assertForbidden();
        $this->actingAs($r)->patch("/admin/team/{$r->id}", ['role' => 'admin'])->assertForbidden();
    }

    public function test_admin_lists_team(): void
    {
        $this->actingAs(User::factory()->admin()->create())->get('/admin/team')->assertOk();
    }

    public function test_admin_updates_other_member(): void
    {
        $admin = User::factory()->admin()->create();
        $m = User::factory()->recruiter()->create();
        $this->actingAs($admin)->patch("/admin/team/{$m->id}", ['name' => 'New', 'role' => 'admin', 'is_active' => false])->assertRedirect();
        $m->refresh();
        $this->assertSame('New', $m->name);
        $this->assertTrue($m->isAdmin());
        $this->assertFalse($m->is_active);
    }

    public function test_admin_cannot_deactivate_themself(): void
    {
        $admin = User::factory()->admin()->create();
        $this->actingAs($admin)->patch("/admin/team/{$admin->id}", ['is_active' => false])->assertSessionHasErrors();
        $this->assertTrue($admin->fresh()->is_active);
    }

    public function test_admin_cannot_change_own_role(): void
    {
        $admin = User::factory()->admin()->create();
        $this->actingAs($admin)->patch("/admin/team/{$admin->id}", ['role' => 'recruiter'])->assertSessionHasErrors();
        $this->assertTrue($admin->fresh()->isAdmin());
    }
}
