<?php

namespace Tests\Feature\Admin;

use App\Models\User;
use App\Notifications\TeamInvitation;
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
        Notification::assertSentTo(User::where('email', 'sara@example.com')->first(), TeamInvitation::class);
        Notification::assertNotSentTo(User::where('email', 'sara@example.com')->first(), ResetPassword::class);
    }

    public function test_invitation_email_is_bilingual_and_link_valid_for_seven_days(): void
    {
        Notification::fake();
        $this->actingAs(User::factory()->admin()->create())
            ->post('/admin/team', ['name' => 'Sara', 'email' => 'sara@example.com', 'role' => 'recruiter']);
        $sara = User::where('email', 'sara@example.com')->first();
        Notification::assertSentTo($sara, TeamInvitation::class, function (TeamInvitation $n) use ($sara) {
            $mail = $n->toMail($sara);
            $text = $mail->subject.' '.implode(' ', array_map('strval', $mail->introLines)).' '.implode(' ', array_map('strval', $mail->outroLines));
            $this->assertStringContainsString('invited to the Career Gate back office', $text);
            $this->assertStringContainsString('7 days', $text);
            $this->assertStringContainsString('تمت دعوتك', $text);
            $this->assertStringContainsString('7 أيام', $text);
            $this->assertStringContainsString('/admin/reset-password/'.$n->token, $mail->actionUrl);
            $this->assertStringContainsString('invite=1', $mail->actionUrl);
            $this->assertStringContainsString(rawurlencode('sara@example.com'), $mail->actionUrl);

            return true;
        });
        $this->assertSame(10080, config('auth.passwords.invites.expire'));
        $this->assertSame('team_invitation_tokens', config('auth.passwords.invites.table'));
    }

    public function test_invited_member_can_set_password_after_two_hours_but_normal_reset_links_still_expire(): void
    {
        Notification::fake();
        $this->actingAs(User::factory()->admin()->create())
            ->post('/admin/team', ['name' => 'Sara', 'email' => 'sara@example.com', 'role' => 'recruiter']);
        $sara = User::where('email', 'sara@example.com')->first();
        $token = null;
        Notification::assertSentTo($sara, TeamInvitation::class, function ($n) use (&$token) {
            $token = $n->token;

            return true;
        });
        auth()->logout(); // the invited member is a guest
        $this->travel(2)->hours();
        $payload = ['token' => $token, 'email' => 'sara@example.com', 'password' => 'brand-new-pass1', 'password_confirmation' => 'brand-new-pass1'];
        $this->post('/admin/reset-password', $payload)->assertSessionHasErrors('email'); // default 60 minute broker
        $this->post('/admin/reset-password', $payload + ['invite' => 1])->assertRedirect('/admin/login');
        $this->post('/admin/login', ['email' => 'sara@example.com', 'password' => 'brand-new-pass1'])->assertRedirect('/admin');
    }

    public function test_invite_link_expires_after_seven_days(): void
    {
        Notification::fake();
        $this->actingAs(User::factory()->admin()->create())
            ->post('/admin/team', ['name' => 'Sara', 'email' => 'sara@example.com', 'role' => 'recruiter']);
        $token = null;
        Notification::assertSentTo(User::where('email', 'sara@example.com')->first(), TeamInvitation::class, function ($n) use (&$token) {
            $token = $n->token;

            return true;
        });
        auth()->logout();
        $this->travel(8)->days();
        $this->post('/admin/reset-password', ['token' => $token, 'email' => 'sara@example.com', 'invite' => 1,
            'password' => 'brand-new-pass1', 'password_confirmation' => 'brand-new-pass1'])->assertSessionHasErrors('email');
    }

    public function test_forgot_password_token_cannot_be_redeemed_on_the_invite_path(): void
    {
        Notification::fake();
        $u = User::factory()->recruiter()->create();
        $this->post('/admin/forgot-password', ['email' => $u->email]);
        $token = null;
        Notification::assertSentTo($u, ResetPassword::class, function ($n) use (&$token) {
            $token = $n->token;

            return true;
        });
        $this->post('/admin/reset-password', ['token' => $token, 'email' => $u->email, 'invite' => 1,
            'password' => 'brand-new-pass1', 'password_confirmation' => 'brand-new-pass1'])->assertSessionHasErrors('email');
    }

    public function test_invite_survives_a_forgot_password_request_for_the_same_email(): void
    {
        Notification::fake();
        $this->actingAs(User::factory()->admin()->create())
            ->post('/admin/team', ['name' => 'Sara', 'email' => 'sara@example.com', 'role' => 'recruiter']);
        auth()->logout();
        $sara = User::where('email', 'sara@example.com')->first();
        $token = null;
        Notification::assertSentTo($sara, TeamInvitation::class, function ($n) use (&$token) {
            $token = $n->token;

            return true;
        });
        $this->post('/admin/forgot-password', ['email' => 'sara@example.com']);
        $this->post('/admin/reset-password', ['token' => $token, 'email' => 'sara@example.com', 'invite' => 1,
            'password' => 'brand-new-pass1', 'password_confirmation' => 'brand-new-pass1'])->assertRedirect('/admin/login');
    }

    public function test_admin_can_resend_an_invite(): void
    {
        Notification::fake();
        $member = User::factory()->recruiter()->create();
        $this->actingAs(User::factory()->admin()->create())
            ->post("/admin/team/{$member->id}/invite")->assertRedirect()->assertSessionHas('status');
        Notification::assertSentTo($member, TeamInvitation::class);
    }

    public function test_recruiter_cannot_resend_invites(): void
    {
        Notification::fake();
        $member = User::factory()->recruiter()->create();
        $this->actingAs(User::factory()->recruiter()->create())->post("/admin/team/{$member->id}/invite")->assertForbidden();
        Notification::assertNothingSent();
    }

    public function test_team_page_has_resend_button_for_other_members(): void
    {
        $member = User::factory()->recruiter()->create();
        $this->actingAs(User::factory()->admin()->create())->get('/admin/team')
            ->assertOk()->assertSee("/admin/team/{$member->id}/invite", false);
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
