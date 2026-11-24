<?php

namespace App\Support;

use Illuminate\Http\Request;

/** Picks the language and the "back to jobs" link for the branded error pages. */
class ErrorPage
{
    public static function locale(?Request $request = null): string
    {
        $request ??= request();

        if ($request->segment(1) === 'ar') {
            return 'ar';
        }

        if ($request->is('admin', 'admin/*')) {
            // A database outage must not stop the branded 500 page from rendering.
            try {
                $locale = $request->user()?->locale;
                if ($locale === null && $request->hasSession()) {
                    $locale = $request->session()->get('admin_locale');
                }
            } catch (\Throwable) {
                $locale = null;
            }

            return $locale === 'ar' ? 'ar' : 'en';
        }

        // Anything else: whatever the request's middleware chose (English by default).
        return app()->getLocale() === 'ar' ? 'ar' : 'en';
    }

    public static function jobsUrl(string $locale): string
    {
        return url($locale === 'ar' ? '/ar/jobs' : '/jobs');
    }
}
