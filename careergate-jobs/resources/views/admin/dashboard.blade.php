@extends('layouts.admin')
@section('title', __('admin.dashboard.title'))
@section('content')
    @php
        $badge = ['new' => 'bg-gray-200 text-gray-800', 'reviewed' => 'bg-blue-100 text-blue-800', 'shortlisted' => 'bg-cg-yellow-light text-cg-navy',
                  'sent_to_client' => 'bg-purple-100 text-purple-800', 'interview' => 'bg-indigo-100 text-indigo-800', 'hired' => 'bg-green-100 text-green-800', 'rejected' => 'bg-red-100 text-red-800'];
        $postJob = fn () => '<a href="'.e(route('admin.jobs.create')).'" class="inline-block rounded bg-cg-yellow px-4 py-2 font-semibold text-cg-navy hover:brightness-95">'.e(__('admin.dashboard.post_job')).'</a>';
    @endphp
    <div class="flex flex-wrap items-center justify-between gap-4">
        <div>
            <h1 class="text-2xl font-bold">{{ __('admin.dashboard.title') }}</h1>
            <p class="mt-1 text-cg-navy-light">{{ __('admin.dashboard.welcome', ['name' => auth()->user()->name]) }}</p>
        </div>
        <a href="{{ route('admin.jobs.create') }}" class="rounded bg-cg-yellow px-4 py-2 font-semibold text-cg-navy hover:brightness-95">{{ __('admin.dashboard.post_job') }}</a>
    </div>

    <div class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        @foreach ([['open-jobs', 'open_jobs', $openJobs], ['applications-7d', 'applications_7d', $recent], ['shortlisted', 'shortlisted_now', $shortlisted]] as [$key, $label, $value])
            <div class="rounded-lg bg-white p-4 shadow">
                <div class="text-sm text-cg-navy-light">{{ __('admin.dashboard.'.$label) }}</div>
                <div class="mt-1 text-3xl font-bold" data-card="{{ $key }}">{{ $value }}</div>
            </div>
        @endforeach
    </div>

    <h2 class="mt-8 text-lg font-bold">{{ __('admin.dashboard.open_jobs_table') }}</h2>
    <div class="mt-3 overflow-x-auto rounded-lg bg-white shadow">
        @if ($rows->isEmpty())
            <div class="p-8 text-center text-cg-navy-light">
                <p class="mb-4">{{ __('admin.dashboard.no_open_jobs') }}</p>
                {!! $postJob() !!}
            </div>
        @else
            <table class="min-w-full text-sm">
                <thead class="bg-cg-yellow-light">
                    <tr>
                        <th class="px-4 py-3 text-start">{{ __('admin.jobs.job') }}</th>
                        <th class="px-4 py-3 text-start">{{ __('admin.jobs.client') }}</th>
                        <th class="px-4 py-3 text-start whitespace-nowrap">{{ __('admin.jobs.closes_on') }}</th>
                        @foreach ($stages as $s)
                            <th class="px-3 py-3 text-center whitespace-nowrap">{{ $s->label() }}</th>
                        @endforeach
                        <th class="px-3 py-3 text-center whitespace-nowrap">{{ __('admin.dashboard.total') }}</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">
                @foreach ($rows as $row)
                    <tr>
                        <td class="px-4 py-3 font-medium"><a href="{{ route('admin.jobs.applications', $row['job']) }}" class="underline">{{ $row['job']->localized('title') ?? '—' }}</a></td>
                        <td class="px-4 py-3">{{ $row['job']->clientCompany?->name }}</td>
                        <td class="px-4 py-3 whitespace-nowrap">{{ $row['job']->closes_on?->format('Y-m-d') ?? '—' }}</td>
                        @foreach ($stages as $s)
                            <td class="px-3 py-3 text-center {{ $row['counts'][$s->value] === 0 ? 'text-gray-400' : '' }}">{{ $row['counts'][$s->value] }}</td>
                        @endforeach
                        <td class="px-3 py-3 text-center font-bold">{{ $row['total'] }}</td>
                    </tr>
                @endforeach
                </tbody>
            </table>
        @endif
    </div>

    <h2 class="mt-8 text-lg font-bold">{{ __('admin.dashboard.newest') }}</h2>
    <div class="mt-3 overflow-x-auto rounded-lg bg-white shadow">
        @if ($newest->isEmpty())
            <div class="p-8 text-center text-cg-navy-light">
                <p class="mb-4">{{ __('admin.dashboard.no_applications') }}</p>
                {!! $postJob() !!}
            </div>
        @else
            <table class="min-w-full text-sm">
                <thead class="bg-cg-yellow-light">
                    <tr>
                        <th class="px-4 py-3 text-start">{{ __('admin.dashboard.applicant') }}</th>
                        <th class="px-4 py-3 text-start">{{ __('admin.dashboard.job') }}</th>
                        <th class="px-4 py-3 text-start">{{ __('admin.common.status') }}</th>
                        <th class="px-4 py-3 text-start whitespace-nowrap">{{ __('admin.dashboard.applied') }}</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">
                @foreach ($newest as $app)
                    @php($at = $app->created_at->copy()->timezone('Africa/Cairo')->locale(app()->getLocale()))
                    <tr>
                        <td class="px-4 py-3 font-medium"><a href="{{ route('admin.applications.show', $app) }}" class="underline">{{ $app->applicant->full_name }}</a></td>
                        <td class="px-4 py-3">{{ $app->jobPosting->localized('title') ?? '—' }}</td>
                        <td class="px-4 py-3"><span class="rounded px-2 py-1 text-xs font-semibold whitespace-nowrap {{ $badge[$app->stage->value] }}">{{ $app->stage->label() }}</span></td>
                        <td class="px-4 py-3 whitespace-nowrap" title="{{ $at->format('Y-m-d H:i') }}">{{ $at->diffForHumans() }}</td>
                    </tr>
                @endforeach
                </tbody>
            </table>
        @endif
    </div>
@endsection
