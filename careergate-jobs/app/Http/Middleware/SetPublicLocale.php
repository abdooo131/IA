<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class SetPublicLocale
{
    public function handle(Request $request, Closure $next): Response
    {
        app()->setLocale($request->segment(1) === 'ar' ? 'ar' : 'en');

        return $next($request);
    }
}
