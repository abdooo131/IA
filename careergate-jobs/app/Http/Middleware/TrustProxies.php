<?php

namespace App\Http\Middleware;

use Illuminate\Http\Middleware\TrustProxies as BaseTrustProxies;

/**
 * Reads the trusted proxies from config('careergate.trusted_proxies') (the TRUSTED_PROXIES
 * env value) at request time, so it still works after `php artisan config:cache`, when
 * env() is no longer available. Unset by default: nothing is trusted.
 */
class TrustProxies extends BaseTrustProxies
{
    protected function proxies(): array|string|null
    {
        $value = config('careergate.trusted_proxies');

        return is_string($value) && trim($value) !== '' ? trim($value) : null;
    }
}
