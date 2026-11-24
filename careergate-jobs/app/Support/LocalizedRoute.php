<?php

namespace App\Support;

class LocalizedRoute
{
    /**
     * URL for a public route in the given (default: current) locale.
     * Arabic routes share the English names, prefixed with "ar.".
     */
    public static function url(string $name, array $params = [], ?string $locale = null): string
    {
        $locale ??= app()->getLocale();

        if (str_starts_with($name, 'ar.')) {
            $name = substr($name, 3);
        }

        return route($locale === 'ar' ? 'ar.'.$name : $name, $params);
    }

    /**
     * URL of the current page in another locale (falls back to the jobs index).
     */
    public static function switchUrl(string $locale): string
    {
        $route = request()->route();
        $name = $route?->getName();

        if ($name === null) {
            return self::url('jobs.index', [], $locale);
        }

        // Only URI parameters: Route::view() adds defaults that must not leak into the URL.
        $params = array_intersect_key($route->parameters(), array_flip($route->parameterNames()));

        return self::url($name, $params, $locale);
    }
}
