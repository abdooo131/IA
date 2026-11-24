@extends('layouts.public')

@section('title', __('public.about.title'))

@push('meta')
    <meta property="og:type" content="website">
    <meta property="og:title" content="{{ __('public.about.title') }} | {{ __('public.brand') }}">
    <meta property="og:description" content="{{ __('public.about.lead') }}">
    <meta property="og:image" content="{{ asset('brand/facebook-cover-1920x640.png') }}">
@endpush

@section('content')
    <h1 class="text-2xl font-bold sm:text-3xl">{{ __('public.about.title') }}</h1>
    <p class="mt-4 text-lg font-semibold">{{ __('public.about.lead') }}</p>
    <p class="mt-3">{{ __('public.about.body') }}</p>
    <div class="mt-6 flex flex-col gap-3 sm:flex-row">
        <a href="https://www.facebook.com/Careergateegypt" rel="noopener" target="_blank"
           class="rounded bg-cg-yellow px-4 py-2 text-center font-semibold text-cg-navy hover:bg-cg-yellow-light">{{ __('public.about.facebook') }}</a>
        <a href="{{ \App\Support\LocalizedRoute::url('jobs.index') }}"
           class="rounded border border-cg-navy px-4 py-2 text-center font-semibold">{{ __('public.about.browse') }}</a>
    </div>
@endsection
