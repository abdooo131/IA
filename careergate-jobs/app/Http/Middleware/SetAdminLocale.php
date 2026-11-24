<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class SetAdminLocale
{
    public function handle(Request $request, Closure $next): Response
    {
        // Logged-in users keep their saved preference; guests use a session choice.
        $locale = $request->user()?->locale ?? $request->session()->get('admin_locale');
        app()->setLocale(in_array($locale, ['en', 'ar'], true) ? $locale : 'en');

        return $next($request);
    }
}
