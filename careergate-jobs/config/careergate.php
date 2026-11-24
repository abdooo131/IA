<?php

return [
    'locales' => ['en', 'ar'],

    // Delete applicants never hired whose latest application is older than this.
    'retention_months' => (int) env('CAREERGATE_RETENTION_MONTHS', 24),

    'cv' => [
        'max_kb' => 10240,
        'max_images' => 4,
    ],
];
