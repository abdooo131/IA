@extends('layouts.public')

@php
    $title = $job->localized('title');
    $where = collect([$job->city, $job->area])->filter()->implode(' - ');
    $desc = trim($title.($where ? ' - '.$where : ''));
@endphp

@section('title', $title)

@push('meta')
    <meta property="og:type" content="website">
    <meta property="og:title" content="{{ $title }} | {{ __('public.brand') }}">
    <meta property="og:description" content="{{ $desc }}">
    <meta property="og:image" content="{{ asset('brand/facebook-cover-1920x640.png') }}">
    <meta property="og:url" content="{{ $job->publicUrl(app()->getLocale()) }}">
    <meta name="description" content="{{ $desc }}">
@endpush

@section('content')
    <a href="{{ \App\Support\LocalizedRoute::url('jobs.index') }}" class="text-sm underline">&larr; {{ __('public.nav.jobs') }}</a>

    @if (session('job_closed'))
        <div class="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 font-semibold text-red-800" role="alert">{{ __('public.job_closed_notice') }}</div>
    @endif

    <h1 class="mt-3 text-2xl font-bold sm:text-3xl">{{ $title }}</h1>

    <dl class="mt-4 grid grid-cols-1 gap-3 rounded-lg bg-cg-yellow-light p-4 text-sm sm:grid-cols-2">
        @if ($where)
            <div><dt class="font-semibold">{{ __('public.fields.location') }}</dt><dd>{{ $where }}</dd></div>
        @endif
        @if ($job->employment_type)
            <div><dt class="font-semibold">{{ __('public.fields.type') }}</dt><dd>{{ __('public.employment_type.'.$job->employment_type->value) }}</dd></div>
        @endif
        @if ($job->salary_text)
            <div><dt class="font-semibold">{{ __('public.fields.salary') }}</dt><dd>{{ $job->salary_text }}</dd></div>
        @endif
        @if ($job->closes_on)
            <div><dt class="font-semibold">{{ __('public.fields.closes_on') }}</dt><dd>{{ $job->closes_on->format('Y-m-d') }}</dd></div>
        @endif
        @if ($job->show_client_name && $job->clientCompany)
            <div><dt class="font-semibold">{{ __('public.fields.client') }}</dt><dd>{{ $job->clientCompany->name }}</dd></div>
        @endif
    </dl>

    @if (filled($job->localized('responsibilities')))
        <section class="mt-6">
            <h2 class="text-xl font-bold">{{ __('public.fields.responsibilities') }}</h2>
            @include('public.jobs._bullets', ['text' => $job->localized('responsibilities')])
        </section>
    @endif

    @if (filled($job->localized('requirements')))
        <section class="mt-6">
            <h2 class="text-xl font-bold">{{ __('public.fields.requirements') }}</h2>
            @include('public.jobs._bullets', ['text' => $job->localized('requirements')])
        </section>
    @endif

    @if ($accepting)
        <section id="apply" class="mt-8 scroll-mt-4 rounded-lg border border-cg-yellow p-4">
            <h2 class="text-xl font-bold">{{ __('public.apply_now') }}</h2>
            @include('public.jobs._apply_form', ['job' => $job])
        </section>
    @else
        <section class="mt-8 rounded-lg bg-cg-yellow-light p-4">
            <p class="font-semibold">{{ __('public.job_closed') }}</p>
            <a href="{{ \App\Support\LocalizedRoute::url('jobs.index') }}" class="mt-2 inline-block underline">{{ __('public.other_jobs') }}</a>
        </section>
    @endif
@endsection
