<!DOCTYPE html>
<html lang="{{ app()->getLocale() }}" dir="{{ app()->getLocale() === 'ar' ? 'rtl' : 'ltr' }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>@yield('title', 'Admin') | Career Gate</title>
    <link rel="icon" href="{{ asset('brand/favicon.ico') }}" sizes="any">
    <link rel="icon" type="image/png" sizes="32x32" href="{{ asset('brand/careergate-icon-32.png') }}">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    @stack('meta')
    @vite(['resources/css/app.css', 'resources/js/app.js'])
</head>
<body class="min-h-screen bg-gray-50 text-cg-navy antialiased">
    <header class="bg-cg-navy">
        <div class="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
            <img src="{{ asset('brand/careergate-logo-for-dark-bg.png') }}" alt="Career Gate" class="h-10 w-auto">
            @yield('header-actions')
        </div>
    </header>

    <main class="mx-auto max-w-7xl px-4 py-8">
        @yield('content')
    </main>
</body>
</html>
