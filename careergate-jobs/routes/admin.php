<?php

use App\Http\Controllers\Admin\ApplicantController;
use App\Http\Controllers\Admin\ApplicationController;
use App\Http\Controllers\Admin\ApplicationStageController;
use App\Http\Controllers\Admin\ClientCompanyController;
use App\Http\Controllers\Admin\CommentController;
use App\Http\Controllers\Admin\CvFileController;
use App\Http\Controllers\Admin\JobPostingController;
use App\Http\Controllers\Admin\LanguageController;
use App\Http\Controllers\Admin\LoginController;
use App\Http\Controllers\Admin\PasswordResetController;
use App\Http\Controllers\Admin\TalentPoolController;
use App\Http\Controllers\Admin\TeamController;
use Illuminate\Support\Facades\Route;

Route::prefix('admin')->group(function () {
    Route::middleware(['guest', 'admin.locale'])->group(function () {
        Route::post('guest-language', [LanguageController::class, 'guest'])->name('admin.guest-language');
        Route::get('login', [LoginController::class, 'create'])->name('admin.login');
        Route::post('login', [LoginController::class, 'store'])->name('admin.login.store');
        Route::get('forgot-password', [PasswordResetController::class, 'request'])->name('password.request');
        Route::post('forgot-password', [PasswordResetController::class, 'email'])->name('password.email');
        Route::get('reset-password/{token}', [PasswordResetController::class, 'reset'])->name('password.reset');
        Route::post('reset-password', [PasswordResetController::class, 'update'])->name('password.update');
    });

    Route::middleware(['auth', 'active', 'admin.locale'])->as('admin.')->group(function () {
        Route::post('logout', [LoginController::class, 'destroy'])->name('logout');
        Route::view('/', 'admin.dashboard')->name('dashboard');
        Route::post('language', [LanguageController::class, 'update'])->name('language.update');

        Route::resource('clients', ClientCompanyController::class)->except(['show', 'destroy'])->parameters(['clients' => 'client']);
        Route::get('jobs', [JobPostingController::class, 'index'])->name('jobs.index');
        Route::get('jobs/create', [JobPostingController::class, 'create'])->name('jobs.create');
        Route::post('jobs', [JobPostingController::class, 'store'])->name('jobs.store');
        Route::get('jobs/{jobPosting:id}', [JobPostingController::class, 'show'])->name('jobs.show');
        Route::get('jobs/{jobPosting:id}/edit', [JobPostingController::class, 'edit'])->name('jobs.edit');
        Route::put('jobs/{jobPosting:id}', [JobPostingController::class, 'update'])->name('jobs.update');
        Route::post('jobs/{jobPosting:id}/duplicate', [JobPostingController::class, 'duplicate'])->name('jobs.duplicate');
        Route::patch('jobs/{jobPosting:id}/status', [JobPostingController::class, 'status'])->name('jobs.status');

        Route::get('jobs/{jobPosting:id}/applications', [ApplicationController::class, 'index'])->name('jobs.applications');
        Route::patch('jobs/{jobPosting:id}/applications/bulk-stage', [ApplicationStageController::class, 'bulk'])->name('jobs.applications.bulk-stage');
        Route::get('applications/{application}', [ApplicationController::class, 'show'])->name('applications.show');
        Route::post('applications/{application}/comments', [CommentController::class, 'store'])->name('applications.comments.store');
        Route::delete('comments/{comment}', [CommentController::class, 'destroy'])->name('comments.destroy');
        Route::post('applications/{application}/cv', [ApplicationController::class, 'replaceCv'])->name('applications.cv.replace');
        Route::get('cv-files/{cvFile}', [CvFileController::class, 'show'])->name('cv-files.show');
        Route::patch('applications/{application}/stage', [ApplicationStageController::class, 'update'])->name('applications.stage');

        Route::get('talent-pool', [TalentPoolController::class, 'index'])->name('talent-pool.index');
        Route::post('applicants/{applicant}/add-to-job', [ApplicantController::class, 'addToJob'])->name('applicants.add-to-job');

        Route::middleware('admin')->group(function () {
            Route::delete('jobs/{jobPosting:id}', [JobPostingController::class, 'destroy'])->name('jobs.destroy');
            Route::delete('clients/{client}', [ClientCompanyController::class, 'destroy'])->name('clients.destroy');
            Route::delete('applicants/{applicant}', [ApplicantController::class, 'destroy'])->name('applicants.destroy');
            Route::get('team', [TeamController::class, 'index'])->name('team.index');
            Route::post('team', [TeamController::class, 'store'])->name('team.store');
            Route::patch('team/{user}', [TeamController::class, 'update'])->name('team.update');
        });
    });
});
