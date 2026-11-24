<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Http\Middleware\ValidatePostSize;
use Illuminate\Http\Exceptions\PostTooLargeException;
use Illuminate\Http\Request;
use Illuminate\Http\Exceptions\ThrottleRequestsException;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->alias([
            'public.locale' => \App\Http\Middleware\SetPublicLocale::class,
            'admin.locale' => \App\Http\Middleware\SetAdminLocale::class,
            'active' => \App\Http\Middleware\EnsureActiveUser::class,
            'admin' => \App\Http\Middleware\EnsureAdmin::class,
        ]);
        // Check the body size inside the web group (after the session starts, before the
        // CSRF check, which would otherwise fail first on an emptied oversized body) so
        // the "file too large" error can be flashed back to the form.
        $middleware->remove(ValidatePostSize::class);
        $middleware->web(replace: [PreventRequestForgery::class => [ValidatePostSize::class, PreventRequestForgery::class]]);
        // Proxies are trusted only when TRUSTED_PROXIES is set (see docs/deployment.md).
        $middleware->replace(\Illuminate\Http\Middleware\TrustProxies::class, \App\Http\Middleware\TrustProxies::class);
        $middleware->append(\App\Http\Middleware\SecurityHeaders::class);
        $middleware->redirectGuestsTo(fn () => route('admin.login'));
        $middleware->redirectUsersTo(fn () => route('admin.dashboard'));
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->render(function (PostTooLargeException $e, Request $request) {
            if ($request->expectsJson()) {
                return null;
            }
            $locale = $request->segment(1) === 'ar' ? 'ar' : 'en';

            return back()->withErrors(['cv' => __('public.cv_too_large', ['mb' => \App\Support\UploadLimits::maxFileMb()], $locale)]);
        });
        $exceptions->render(function (ThrottleRequestsException $e, Request $request) {
            if ($request->expectsJson() || ! $request->routeIs('jobs.apply', 'ar.jobs.apply')) {
                return null;
            }
            $locale = $request->segment(1) === 'ar' ? 'ar' : 'en';

            return back()->withInput($request->except('cv'))
                ->withErrors(['form' => __('public.too_many_requests', [], $locale)]);
        });
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
    })->create();
