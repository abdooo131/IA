<?php

namespace Tests\Feature\Admin;

use App\Models\User;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Support\Facades\Notification;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuthTest extends TestCase
{
    use RefreshDatabase;

    public function test_guest_is_redirected_to_login(): void
    {
        $this->get('/admin')->assertRedirect('/admin/login');
    }

    public function test_login_page_renders_in_english(): void
    {
        $this->get('/admin/login')->assertOk()->assertSee('lang="en"', false);
    }

    public function test_user_can_log_in_and_out(): void
    {
        $u = User::factory()->create();
        $this->post('/admin/login', ['email' => $u->email, 'password' => 'password'])->assertRedirect('/admin');
        $this->assertAuthenticatedAs($u);
        $this->post('/admin/logout')->assertRedirect('/admin/login');
        $this->assertGuest();
    }

    public function test_wrong_password_fails(): void
    {
        $u = User::factory()->create();
        $this->post('/admin/login', ['email' => $u->email, 'password' => 'wrong'])->assertSessionHasErrors('email');
        $this->assertGuest();
    }

    public function test_login_is_rate_limited_after_5_attempts(): void
    {
        $u = User::factory()->create();
        foreach (range(1, 5) as $_) {
            $this->post('/admin/login', ['email' => $u->email, 'password' => 'wrong']);
        }
        $this->post('/admin/login', ['email' => $u->email, 'password' => 'password'])->assertSessionHasErrors('email');
        $this->assertGuest();
    }

    public function test_deactivated_user_cannot_log_in(): void
    {
        $u = User::factory()->create(['is_active' => false]);
        $this->post('/admin/login', ['email' => $u->email, 'password' => 'password'])->assertSessionHasErrors('email');
        $this->assertGuest();
    }

    public function test_deactivated_user_is_logged_out(): void
    {
        $u = User::factory()->create(['is_active' => false]);
        $this->actingAs($u)->get('/admin')->assertRedirect('/admin/login');
        $this->assertGuest();
    }

    public function test_recruiter_cannot_manage_team(): void
    {
        $this->actingAs(User::factory()->recruiter()->create())->get('/admin/team')->assertForbidden();
    }

    public function test_admin_language_follows_user_preference(): void
    {
        $u = User::factory()->create(['locale' => 'ar']);
        $this->actingAs($u)->get('/admin')->assertSee('dir="rtl"', false);
    }

    public function test_user_can_switch_language(): void
    {
        $u = User::factory()->create(['locale' => 'en']);
        $this->actingAs($u)->post('/admin/language', ['locale' => 'ar'])->assertRedirect();
        $this->assertSame('ar', $u->fresh()->locale);
        $this->actingAs($u)->post('/admin/language', ['locale' => 'fr'])->assertSessionHasErrors('locale');
    }

    public function test_password_reset_flow(): void
    {
        Notification::fake();
        $u = User::factory()->create();
        $this->post('/admin/forgot-password', ['email' => $u->email])->assertSessionHas('status');
        $token = null;
        Notification::assertSentTo($u, ResetPassword::class, function ($n) use (&$token) {
            $token = $n->token;

            return true;
        });
        $this->post('/admin/reset-password', [
            'token' => $token, 'email' => $u->email,
            'password' => 'new-secret-pass', 'password_confirmation' => 'new-secret-pass',
        ])->assertRedirect('/admin/login');
        $this->post('/admin/login', ['email' => $u->email, 'password' => 'new-secret-pass'])->assertRedirect('/admin');
    }
}
