<?php

namespace Tests\Feature;

use App\Models\JobPosting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ProductionConfigTest extends TestCase
{
    use RefreshDatabase;

    public function test_security_headers_and_no_debug_leaks(): void
    {
        config(['app.debug' => false]);
        $this->get('/jobs')->assertHeader('X-Frame-Options', 'SAMEORIGIN')->assertHeader('X-Content-Type-Options', 'nosniff')
            ->assertHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
            ->assertHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
        $this->get('/jobs/does-not-exist')->assertNotFound()->assertDontSee('Stack trace');
    }

    public function test_security_headers_are_on_error_responses_too(): void
    {
        $this->get('/jobs/does-not-exist')->assertNotFound()->assertHeader('X-Content-Type-Options', 'nosniff');
    }

    public function test_admin_pages_are_not_indexed(): void
    {
        $this->get('/admin/login')->assertHeader('X-Robots-Tag', 'noindex, nofollow');
        $this->actingAs(User::factory()->admin()->create())->get('/admin')->assertHeader('X-Robots-Tag', 'noindex, nofollow');
        $this->get('/jobs')->assertHeaderMissing('X-Robots-Tag');
    }

    public function test_robots_txt_disallows_admin(): void
    {
        $this->assertStringContainsString('Disallow: /admin', file_get_contents(public_path('robots.txt')));
    }

    public function test_branded_404_in_both_languages(): void
    {
        config(['app.debug' => false]);
        $this->get('/jobs/nope')->assertNotFound()->assertSee('dir="ltr"', false)->assertSee('/jobs', false)
            ->assertSee('Page not found');
        $this->get('/ar/jobs/nope')->assertNotFound()->assertSee('dir="rtl"', false)->assertSee('/ar/jobs', false)
            ->assertSee('الصفحة غير موجودة');
    }

    public function test_error_pages_follow_admin_user_locale(): void
    {
        config(['app.debug' => false]);
        $u = User::factory()->recruiter()->create(['locale' => 'ar']);
        $this->actingAs($u)->get('/admin/does-not-exist')->assertNotFound()->assertSee('dir="rtl"', false);
    }

    public function test_page_expired_419_is_friendly(): void
    {
        config(['app.debug' => false]);
        \Illuminate\Support\Facades\Route::get('/_expired', fn () => abort(419));
        \Illuminate\Support\Facades\Route::get('/ar/_expired', fn () => abort(419));
        $this->get('/_expired')->assertStatus(419)->assertSee('go back and try again', false);
        $this->get('/ar/_expired')->assertStatus(419)->assertSee('dir="rtl"', false);
    }

    public function test_every_error_view_renders_in_both_languages(): void
    {
        foreach ([404, 419, 429, 500, 503] as $code) {
            foreach (['en', 'ar'] as $locale) {
                app()->setLocale($locale);
                $html = view("errors.$code", ['exception' => new \Symfony\Component\HttpKernel\Exception\HttpException($code)])->render();
                $this->assertStringContainsString($locale === 'ar' ? 'dir="rtl"' : 'dir="ltr"', $html);
                $this->assertStringNotContainsString('Stack trace', $html);
            }
        }
    }

    public function test_proxies_are_not_trusted_by_default(): void
    {
        $this->assertNull(config('careergate.trusted_proxies'));
        \Illuminate\Support\Facades\Route::get('/_ip', fn (\Illuminate\Http\Request $r) => $r->ip());
        $this->withServerVariables(['REMOTE_ADDR' => '10.0.0.1'])->get('/_ip', ['X-Forwarded-For' => '203.0.113.9'])->assertSee('10.0.0.1');
    }

    public function test_trusted_proxies_setting_exposes_the_real_client_ip(): void
    {
        config(['careergate.trusted_proxies' => '10.0.0.1']);
        \Illuminate\Support\Facades\Route::get('/_ip', fn (\Illuminate\Http\Request $r) => $r->ip());
        $this->withServerVariables(['REMOTE_ADDR' => '10.0.0.1'])->get('/_ip', ['X-Forwarded-For' => '203.0.113.9'])->assertSee('203.0.113.9');
    }

    public function test_apply_form_shows_effective_upload_limit(): void
    {
        \App\Support\UploadLimits::fake('4M', '8M');
        $job = JobPosting::factory()->open()->create();
        $this->get("/jobs/{$job->slug}")->assertOk()->assertSee('data-max-kb="4096"', false)->assertSee('4 MB');
        \App\Support\UploadLimits::fake(null, null);
    }

    public function test_security_headers_are_first_in_the_global_stack_and_backup_monitor_matches(): void
    {
        $this->assertSame(\App\Http\Middleware\SecurityHeaders::class, $this->app->make(\Illuminate\Contracts\Http\Kernel::class)->getGlobalMiddleware()[0]);
        $this->assertSame(config('backup.backup.name'), config('backup.monitor_backups.0.name'));
    }
}
