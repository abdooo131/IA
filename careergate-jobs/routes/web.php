<?php

use Illuminate\Support\Facades\Route;

// Public site: English at "/", Arabic under "/ar" (route names prefixed "ar.").
Route::middleware('public.locale')->group(function () {
    Route::redirect('/', '/jobs');
    Route::view('/jobs', 'public.jobs.index')->name('jobs.index');

    Route::prefix('ar')->as('ar.')->group(function () {
        Route::redirect('/', '/ar/jobs');
        Route::view('/jobs', 'public.jobs.index')->name('jobs.index');
    });
});
