<?php

use App\Http\Controllers\Public\ApplyController;
use App\Http\Controllers\Public\JobController;
use App\Http\Controllers\Public\PageController;
use Illuminate\Support\Facades\Route;

// Public routes are defined once and registered for both locales:
// English at "/", Arabic under "/ar" (route names prefixed "ar.").
// Add future public routes inside $publicRoutes.
$publicRoutes = function () {
    Route::get('/jobs', [JobController::class, 'index'])->name('jobs.index');
    Route::get('/jobs/{jobPosting}', [JobController::class, 'show'])->name('jobs.show');
    Route::post('/jobs/{jobPosting}/apply', [ApplyController::class, 'store'])
        ->middleware('throttle:apply')->name('jobs.apply');
    Route::get('/jobs/{jobPosting}/thanks', [ApplyController::class, 'thanks'])->name('jobs.thanks');
    Route::get('/about', [PageController::class, 'about'])->name('about');
};

Route::middleware('public.locale')->group(function () use ($publicRoutes) {
    Route::redirect('/', '/jobs');
    $publicRoutes();

    Route::prefix('ar')->as('ar.')->group(function () use ($publicRoutes) {
        Route::redirect('/', '/ar/jobs');
        $publicRoutes();
    });
});

require __DIR__.'/admin.php';
