<!DOCTYPE html>
<html lang="{{ app()->getLocale() }}" dir="{{ app()->getLocale() === 'ar' ? 'rtl' : 'ltr' }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>@yield('title', __('public.brand')) | {{ __('public.brand') }}</title>
    <link rel="icon" href="{{ asset('brand/favicon.ico') }}" sizes="any">
    <link rel="icon" type="image/png" sizes="32x32" href="{{ asset('brand/careergate-icon-32.png') }}">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    @stack('meta')
    @vite(['resources/css/app.css', 'resources/js/app.js'])
</head>
<body class="min-h-screen bg-white text-cg-navy antialiased">
    <header class="bg-white border-b border-cg-yellow-light">
        <div class="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <a href="{{ \App\Support\LocalizedRoute::url('jobs.index') }}">
                <img src="{{ asset('brand/careergate-logo-for-light-bg.png') }}" alt="{{ __('public.brand') }}" class="h-10 w-auto">
            </a>
            <nav class="flex items-center gap-4 text-sm font-semibold">
                <a href="{{ \App\Support\LocalizedRoute::url('jobs.index') }}" class="hover:text-cg-navy-light">{{ __('public.nav.jobs') }}</a>
                <a href="{{ \App\Support\LocalizedRoute::switchUrl(app()->getLocale() === 'ar' ? 'en' : 'ar') }}"
                   class="rounded bg-cg-yellow px-3 py-1 text-cg-navy hover:bg-cg-yellow-light">{{ __('public.nav.language') }}</a>
            </nav>
        </div>
    </header>

    <main class="mx-auto max-w-5xl px-4 py-8">
        @yield('content')
    </main>

    <footer class="bg-cg-navy py-6 text-center text-sm text-cg-yellow-light">
        &copy; {{ now()->year }} {{ __('public.footer') }}
    </footer>
</body>
</html>
