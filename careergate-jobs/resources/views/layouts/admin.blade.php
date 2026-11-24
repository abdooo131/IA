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
@auth
    @php
        $nav = [
            ['admin.dashboard', 'admin/', 'dashboard', url('/admin')],
            ['admin.jobs.index', 'admin/jobs*', 'jobs', url('/admin/jobs')],
            ['admin.talent-pool.index', 'admin/talent-pool*', 'talent', route('admin.talent-pool.index')],
            ['admin.clients.index', 'admin/clients*', 'clients', url('/admin/clients')],
        ];
        if (auth()->user()->isAdmin()) {
            $nav[] = ['admin.team.index', 'admin/team*', 'team', route('admin.team.index')];
        }
    @endphp
    <div class="md:flex md:min-h-screen">
        <aside class="bg-cg-navy text-white md:w-64 md:shrink-0">
            <div class="flex items-center justify-between px-4 py-3 md:block md:py-6">
                <a href="{{ route('admin.dashboard') }}">
                    <img src="{{ asset('brand/careergate-logo-for-dark-bg.png') }}" alt="Career Gate" class="h-10 w-auto">
                </a>
                <button type="button" class="rounded px-3 py-2 text-sm md:hidden" aria-label="{{ __('admin.nav.menu') }}"
                        onclick="document.getElementById('admin-nav').classList.toggle('hidden')">&#9776;</button>
            </div>
            <nav id="admin-nav" class="hidden px-2 pb-4 md:block">
                <ul class="space-y-1">
                    @foreach ($nav as [$name, $pattern, $key, $href])
                        <li>
                            <a href="{{ $href }}"
                               class="block rounded px-3 py-2 text-sm font-medium {{ request()->is(rtrim($pattern, '/') ?: '/') ? 'bg-cg-yellow text-cg-navy' : 'text-white hover:bg-cg-navy-light' }}">
                                {{ __('admin.nav.'.$key) }}
                            </a>
                        </li>
                    @endforeach
                </ul>

                <div class="mt-6 border-t border-cg-navy-light px-3 pt-4 text-sm">
                    <p class="truncate font-semibold">{{ auth()->user()->name }}</p>
                    <form method="POST" action="{{ route('admin.language.update') }}" class="mt-3 flex items-center gap-2">
                        @csrf
                        <span class="text-gray-300">{{ __('admin.nav.language') }}</span>
                        <button name="locale" value="en" class="rounded px-2 py-1 {{ app()->getLocale() === 'en' ? 'bg-cg-yellow text-cg-navy' : 'bg-cg-navy-light' }}">EN</button>
                        <button name="locale" value="ar" class="rounded px-2 py-1 {{ app()->getLocale() === 'ar' ? 'bg-cg-yellow text-cg-navy' : 'bg-cg-navy-light' }}">عربي</button>
                    </form>
                    <form method="POST" action="{{ route('admin.logout') }}" class="mt-3">
                        @csrf
                        <button class="text-gray-300 underline hover:text-white">{{ __('admin.nav.logout') }}</button>
                    </form>
                </div>
            </nav>
        </aside>

        <main class="min-w-0 flex-1 px-4 py-8 md:px-8">
            @if (session('status'))
                <div class="mb-6 rounded border border-cg-yellow bg-cg-yellow-light px-4 py-3 text-sm" role="status">{{ session('status') }}</div>
            @endif
            @foreach (['client', 'job', 'status'] as $errKey)
                @error($errKey)<div class="mb-6 rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{{ $message }}</div>@enderror
            @endforeach
            @yield('content')
        </main>
    </div>
@else
    <div class="flex min-h-screen flex-col items-center justify-center px-4 py-10">
        <div class="w-full max-w-md">
            <img src="{{ asset('brand/careergate-logo-for-light-bg.png') }}" alt="Career Gate" class="mx-auto mb-8 h-12 w-auto">
            <form method="POST" action="{{ route('admin.guest-language') }}" class="mb-3 flex justify-end gap-2 text-sm">
                @csrf
                <button name="locale" value="en" class="rounded px-2 py-1 {{ app()->getLocale() === 'en' ? 'bg-cg-yellow' : 'bg-white' }}">EN</button>
                <button name="locale" value="ar" class="rounded px-2 py-1 {{ app()->getLocale() === 'ar' ? 'bg-cg-yellow' : 'bg-white' }}">عربي</button>
            </form>
            <div class="rounded-lg bg-white p-6 shadow">
                @if (session('status'))
                    <div class="mb-4 rounded border border-cg-yellow bg-cg-yellow-light px-4 py-3 text-sm" role="status">{{ session('status') }}</div>
                @endif
                @yield('content')
            </div>
        </div>
    </div>
@endauth
</body>
</html>
