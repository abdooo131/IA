<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // Per IP: 10 apply requests a minute. The per phone limit (3 successful
        // applications an hour) is enforced in ApplyController.
        RateLimiter::for('apply', fn (Request $request) => Limit::perMinute(10)->by($request->ip()));
    }
}
