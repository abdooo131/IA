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

    'cv' => [
        'max_kb' => 10240,
        'max_images' => 4,
    ],
];
