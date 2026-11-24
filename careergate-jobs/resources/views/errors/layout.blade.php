@php
    // Error pages can be shown before any middleware ran, so pick the language here.
    $locale = \App\Support\ErrorPage::locale();
    app()->setLocale($locale);
    $rtl = $locale === 'ar';
    $code = $code ?? 500;
@endphp
<!DOCTYPE html>
<html lang="{{ $locale }}" dir="{{ $rtl ? 'rtl' : 'ltr' }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>{{ __('errors.'.$code.'.title') }} | {{ __('errors.brand') }}</title>
    <link rel="icon" href="{{ asset('brand/favicon.ico') }}" sizes="any">
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
    {{-- Inline styles on purpose: an error page must not depend on the Vite build. --}}
    <style>
        *{box-sizing:border-box}
        body{margin:0;min-height:100vh;display:flex;flex-direction:column;background:#fff;color:#141F2D;
            font-family:{{ $rtl ? "'Cairo'" : "'Inter'" }},system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.6}
        header{border-bottom:1px solid #FFF3C4;padding:12px 16px}
        header img{height:40px;width:auto;display:block}
        main{flex:1;display:flex;align-items:center;justify-content:center;padding:32px 16px;text-align:center}
        .code{font-size:72px;font-weight:700;line-height:1;color:#FEC401;margin:0}
        h1{font-size:24px;margin:12px 0 8px}
        p{margin:0 auto 24px;max-width:28rem;color:#24344A}
        a.btn{display:inline-block;background:#FEC401;color:#141F2D;font-weight:600;text-decoration:none;
            padding:12px 24px;border-radius:8px}
        a.btn:hover{background:#FFF3C4}
        footer{background:#141F2D;color:#FFF3C4;text-align:center;font-size:14px;padding:20px 16px}
    </style>
</head>
<body>
    <header>
        <a href="{{ \App\Support\ErrorPage::jobsUrl($locale) }}">
            <img src="{{ asset('brand/careergate-logo-for-light-bg.png') }}" alt="{{ __('errors.brand') }}">
        </a>
    </header>
    <main>
        <div>
            <p class="code" aria-hidden="true">{{ $code }}</p>
            <h1>{{ __('errors.'.$code.'.title') }}</h1>
            <p>{{ __('errors.'.$code.'.message') }}</p>
            <a class="btn" href="{{ \App\Support\ErrorPage::jobsUrl($locale) }}">{{ __('errors.back_to_jobs') }}</a>
        </div>
    </main>
    <footer>&copy; {{ now()->year }} {{ __('errors.brand') }}</footer>
</body>
</html>
