<?php

return [
    'locales' => ['en', 'ar'],

    // Delete applicants never hired whose latest application is older than this.
    'retention_months' => (int) env('CAREERGATE_RETENTION_MONTHS', 24),

    // First admin account, created by AdminUserSeeder.
    'admin' => [
        'email' => env('ADMIN_EMAIL'),
        'password' => env('ADMIN_PASSWORD'),
        'name' => env('ADMIN_NAME', 'Admin'),
    ],

    // Set TRUSTED_PROXIES (comma separated IPs, or * ) only when the site sits behind a
    // proxy such as Cloudflare, so login throttling sees the real visitor IP.
    'trusted_proxies' => env('TRUSTED_PROXIES'),

    'cv' => [
        'max_kb' => 10240,
        'max_images' => 4,
    ],
];
