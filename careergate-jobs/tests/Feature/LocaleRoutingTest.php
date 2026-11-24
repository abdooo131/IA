<?php

namespace Tests\Feature;

use App\Support\LocalizedRoute;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class LocaleRoutingTest extends TestCase
{
    use RefreshDatabase;

    public function test_english_and_arabic_home_render_with_direction(): void
    {
        $this->get('/jobs')->assertOk()->assertSee('lang="en"', false)->assertSee('dir="ltr"', false);
        $this->get('/ar/jobs')->assertOk()->assertSee('lang="ar"', false)->assertSee('dir="rtl"', false);
    }

    public function test_root_redirects_to_jobs(): void
    {
        $this->get('/')->assertRedirect('/jobs');
        $this->get('/ar')->assertRedirect('/ar/jobs');
    }

    public function test_language_switch_links_to_same_page_other_language(): void
    {
        $this->get('/jobs')->assertSee('href="'.url('/ar/jobs').'"', false);
        $this->get('/ar/jobs')->assertSee('href="'.url('/jobs').'"', false);
    }

    public function test_localized_route_builds_urls_per_locale(): void
    {
        $this->assertSame(url('/jobs'), LocalizedRoute::url('jobs.index', [], 'en'));
        $this->assertSame(url('/ar/jobs'), LocalizedRoute::url('jobs.index', [], 'ar'));
    }

    public function test_config_values(): void
    {
        $this->assertSame(['en', 'ar'], config('careergate.locales'));
        $this->assertSame(24, config('careergate.retention_months'));
        $this->assertSame(10240, config('careergate.cv.max_kb'));
        $this->assertSame(4, config('careergate.cv.max_images'));
        $this->assertSame('Africa/Cairo', config('app.timezone'));
    }
}
