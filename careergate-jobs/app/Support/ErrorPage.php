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
            $locale = $request->user()?->locale;
            if ($locale === null) {
                try {
                    $locale = $request->hasSession() ? $request->session()->get('admin_locale') : null;
                } catch (\Throwable) {
                    $locale = null;
                }
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
