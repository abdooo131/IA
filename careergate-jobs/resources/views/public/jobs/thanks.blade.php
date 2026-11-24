@extends('layouts.public')

@section('title', __($already ? 'public.thanks.already_heading' : 'public.thanks.heading'))

@section('content')
    @php $title = $job->localized('title'); @endphp
    <div class="mx-auto max-w-xl rounded-lg border border-cg-yellow bg-cg-yellow-light p-6 text-center">
        <h1 class="text-2xl font-bold">{{ __($already ? 'public.thanks.already_heading' : 'public.thanks.heading') }}</h1>
        <p class="mt-3">{{ __($already ? 'public.thanks.already_body' : 'public.thanks.body', ['job' => $title]) }}</p>
        <a href="{{ \App\Support\LocalizedRoute::url('jobs.index') }}"
           class="mt-5 inline-block min-h-12 rounded-lg bg-cg-navy px-5 py-3 font-semibold text-white">{{ __('public.thanks.more_jobs') }}</a>
    </div>
@endsection
