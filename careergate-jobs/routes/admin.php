<?php

use App\Http\Controllers\Admin\LanguageController;
use App\Http\Controllers\Admin\LoginController;
use App\Http\Controllers\Admin\PasswordResetController;
use App\Http\Controllers\Admin\TeamController;
use Illuminate\Support\Facades\Route;

Route::prefix('admin')->group(function () {
    Route::middleware('guest')->group(function () {
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

        Route::middleware('admin')->group(function () {
            Route::get('team', [TeamController::class, 'index'])->name('team.index');
            Route::post('team', [TeamController::class, 'store'])->name('team.store');
            Route::patch('team/{user}', [TeamController::class, 'update'])->name('team.update');
        });
    });
});
