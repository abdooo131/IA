@extends('layouts.admin')
@section('title', __('admin.jobs.title'))
@section('content')
    @php
        $badge = ['draft' => 'bg-gray-200 text-gray-800', 'open' => 'bg-green-100 text-green-800', 'closed' => 'bg-red-100 text-red-800'];
    @endphp
    <div class="flex flex-wrap items-center justify-between gap-4">
        <h1 class="text-2xl font-bold">{{ __('admin.jobs.title') }}</h1>
        <a href="{{ route('admin.jobs.create') }}" class="rounded bg-cg-yellow px-4 py-2 font-semibold text-cg-navy hover:brightness-95">{{ __('admin.jobs.add') }}</a>
    </div>

    <form method="GET" action="{{ route('admin.jobs.index') }}" class="mt-6 flex items-center gap-2 text-sm">
        <label for="status">{{ __('admin.jobs.filter_status') }}</label>
        <select id="status" name="status" onchange="this.form.submit()" class="rounded border border-gray-300 px-2 py-1">
            <option value="">{{ __('admin.actions.all') }}</option>
            @foreach (\App\Enums\JobStatus::cases() as $s)
                <option value="{{ $s->value }}" @selected($status === $s)>{{ __('admin.jobs.statuses.'.$s->value) }}</option>
            @endforeach
        </select>
        <noscript><button class="rounded bg-cg-navy px-3 py-1 text-white">OK</button></noscript>
    </form>

    <div class="mt-4 overflow-x-auto rounded-lg bg-white shadow">
        <table class="min-w-full text-sm">
            <thead class="bg-cg-yellow-light">
                <tr>
                    <th class="px-4 py-3 text-start">{{ __('admin.jobs.job') }}</th>
                    <th class="px-4 py-3 text-start">{{ __('admin.jobs.client') }}</th>
                    <th class="px-4 py-3 text-start">{{ __('admin.jobs.city') }}</th>
                    <th class="px-4 py-3 text-start">{{ __('admin.common.status') }}</th>
                    <th class="px-4 py-3 text-start">{{ __('admin.jobs.applicants') }}</th>
                    <th class="px-4 py-3 text-start">{{ __('admin.jobs.closes_on') }}</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
            @forelse ($jobs as $job)
                <tr>
                    <td class="px-4 py-3 font-medium"><a href="{{ route('admin.jobs.show', $job) }}" class="underline">{{ $job->localized('title') ?? '—' }}</a></td>
                    <td class="px-4 py-3">{{ $job->clientCompany?->name }}</td>
                    <td class="px-4 py-3">{{ $job->city }}</td>
                    <td class="px-4 py-3"><span class="rounded px-2 py-1 text-xs font-semibold {{ $badge[$job->status->value] }}">{{ __('admin.jobs.statuses.'.$job->status->value) }}</span></td>
                    <td class="px-4 py-3">{{ $job->applications_count }}</td>
                    <td class="px-4 py-3">{{ $job->closes_on?->format('Y-m-d') ?? '—' }}</td>
                </tr>
            @empty
                <tr><td colspan="6" class="px-4 py-6 text-center text-cg-navy-light">{{ __('admin.jobs.empty') }}</td></tr>
            @endforelse
            </tbody>
        </table>
    </div>
    <div class="mt-4">{{ $jobs->links() }}</div>
@endsection
