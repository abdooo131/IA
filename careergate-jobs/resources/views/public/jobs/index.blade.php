@extends('layouts.public')

@section('title', __('public.jobs.title'))

@push('meta')
    <meta property="og:type" content="website">
    <meta property="og:title" content="{{ __('public.jobs.title') }} | {{ __('public.brand') }}">
    <meta property="og:description" content="{{ __('public.jobs.intro') }}">
    <meta property="og:image" content="{{ asset('brand/facebook-cover-1920x640.png') }}">
    <meta property="og:url" content="{{ url()->current() }}">
@endpush

@section('content')
    <img src="{{ asset('brand/careergate-hero-1200.jpg') }}" alt="{{ __('public.brand') }}" width="1200" height="400" fetchpriority="high" decoding="async"
         class="mb-6 aspect-[3/1] w-full rounded-lg object-cover">

    <h1 class="text-2xl font-bold sm:text-3xl">{{ __('public.jobs.title') }}</h1>
    <p class="mt-2 text-cg-navy-light">{{ __('public.jobs.intro') }}</p>

    <form method="GET" action="{{ \App\Support\LocalizedRoute::url('jobs.index') }}"
          class="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_12rem_auto]">
        <input type="search" name="q" value="{{ $q }}" placeholder="{{ __('public.filters.search') }}"
               aria-label="{{ __('public.filters.search') }}"
               class="w-full rounded border border-cg-navy-light/30 px-3 py-2">
        <select name="city" aria-label="{{ __('public.filters.city') }}"
                class="w-full rounded border border-cg-navy-light/30 px-3 py-2">
            <option value="">{{ __('public.filters.all_cities') }}</option>
            @foreach ($cities as $c)
                <option value="{{ $c }}" @selected($c === $city)>{{ $c }}</option>
            @endforeach
        </select>
        <div class="flex gap-2">
            <button type="submit" class="rounded bg-cg-yellow px-4 py-2 font-semibold text-cg-navy hover:bg-cg-yellow-light">{{ __('public.filters.submit') }}</button>
            @if ($q !== '' || $city !== '')
                <a href="{{ \App\Support\LocalizedRoute::url('jobs.index') }}" class="px-3 py-2 text-sm underline">{{ __('public.filters.reset') }}</a>
            @endif
        </div>
    </form>

    <div class="mt-6 space-y-4">
        @forelse ($jobs as $job)
            <a href="{{ \App\Support\LocalizedRoute::url('jobs.show', ['jobPosting' => $job]) }}"
               class="block rounded-lg border border-cg-yellow-light p-4 shadow-sm hover:border-cg-yellow">
                <h2 class="text-lg font-bold">{{ $job->localized('title') }}</h2>
                <p class="mt-1 text-sm text-cg-navy-light">
                    {{ collect([$job->city, $job->area])->filter()->implode(' - ') }}
                    @if ($job->employment_type)
                        &middot; {{ __('public.employment_type.'.$job->employment_type->value) }}
                    @endif
                </p>
                @if ($job->salary_text)
                    <p class="mt-1 text-sm font-semibold">{{ $job->salary_text }}</p>
                @endif
                <span class="mt-3 inline-block text-sm font-semibold underline">{{ __('public.view_job') }}</span>
            </a>
        @empty
            <p class="rounded-lg bg-cg-yellow-light p-4">{{ __('public.jobs_empty') }}</p>
        @endforelse
    </div>

    <div class="mt-6">{{ $jobs->links() }}</div>
@endsection
