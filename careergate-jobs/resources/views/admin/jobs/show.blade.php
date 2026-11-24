@extends('layouts.admin')
@section('title', $job->localized('title') ?? __('admin.jobs.title'))
@section('content')
    @php
        $badge = ['draft' => 'bg-gray-200 text-gray-800', 'open' => 'bg-green-100 text-green-800', 'closed' => 'bg-red-100 text-red-800'];
    @endphp
    <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
            <a href="{{ route('admin.jobs.index') }}" class="text-sm underline">&larr; {{ __('admin.jobs.title') }}</a>
            <h1 class="mt-2 text-2xl font-bold">{{ $job->localized('title') }}</h1>
            <p class="mt-1 text-sm text-cg-navy-light">
                {{ $job->clientCompany?->name }} · {{ $job->city }}@if ($job->area), {{ $job->area }}@endif ·
                {{ __('admin.jobs.employment.'.$job->employment_type->value) }}
                <span class="ms-2 rounded px-2 py-1 text-xs font-semibold {{ $badge[$job->status->value] }}">{{ __('admin.jobs.statuses.'.$job->status->value) }}</span>
            </p>
            <p class="mt-1 text-sm text-cg-navy-light">{{ __('admin.jobs.closes_on') }}: {{ $job->closes_on?->format('Y-m-d') ?? __('admin.jobs.no_close_date') }}</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
            <a href="{{ route('admin.jobs.edit', $job) }}" class="rounded bg-cg-navy px-4 py-2 text-white hover:bg-cg-navy-light">{{ __('admin.actions.edit') }}</a>
            <form method="POST" action="{{ route('admin.jobs.duplicate', $job) }}">@csrf
                <button class="rounded border border-cg-navy px-4 py-2 hover:bg-cg-yellow-light">{{ __('admin.jobs.duplicate') }}</button>
            </form>
            @if (auth()->user()->isAdmin() && array_sum($stageCounts) === 0)
                <form method="POST" action="{{ route('admin.jobs.destroy', $job) }}" onsubmit="return confirm(@js(__('admin.actions.confirm_delete')))">@csrf @method('DELETE')
                    <button class="rounded border border-red-700 px-4 py-2 text-red-700 hover:bg-red-50">{{ __('admin.actions.delete') }}</button>
                </form>
            @endif
        </div>
    </div>

    <section class="mt-8 rounded-lg bg-white p-6 shadow">
        <h2 class="font-bold">{{ __('admin.jobs.set_status') }}</h2>
        <div class="mt-3 flex flex-wrap gap-2">
            @foreach (\App\Enums\JobStatus::cases() as $s)
                @continue($s === $job->status)
                <form method="POST" action="{{ route('admin.jobs.status', $job) }}">@csrf @method('PATCH')
                    <input type="hidden" name="status" value="{{ $s->value }}">
                    <button class="rounded border border-gray-300 px-3 py-2 text-sm hover:bg-cg-yellow-light">{{ __('admin.jobs.status_actions.'.$s->value) }}</button>
                </form>
            @endforeach
        </div>
    </section>

    <section class="mt-6 rounded-lg bg-white p-6 shadow">
        <h2 class="font-bold">{{ __('admin.jobs.public_links') }}</h2>
        <div class="mt-3 space-y-3 text-sm">
            @foreach (['en', 'ar'] as $loc)
                <div class="flex flex-wrap items-center gap-2">
                    <span class="w-32 font-medium">{{ __('admin.jobs.link_'.$loc) }}</span>
                    <input readonly value="{{ $job->publicUrl($loc) }}" dir="ltr" id="link-{{ $loc }}" class="min-w-0 flex-1 rounded border border-gray-300 bg-gray-50 px-2 py-1">
                    <button type="button" data-copy-target="link-{{ $loc }}" data-copied="{{ __('admin.actions.copied') }}" class="rounded bg-cg-navy px-3 py-1 text-white hover:bg-cg-navy-light">{{ __('admin.actions.copy') }}</button>
                    <a href="{{ $job->publicUrl($loc) }}" target="_blank" rel="noopener" class="underline">{{ __('admin.actions.view') }}</a>
                </div>
            @endforeach
        </div>
    </section>

    <section class="mt-6 rounded-lg bg-white p-6 shadow">
        <div class="flex items-center justify-between">
            <h2 class="font-bold">{{ __('admin.jobs.applications_by_stage') }}</h2>
            @if (\Illuminate\Support\Facades\Route::has('admin.jobs.applications'))
                <a href="{{ route('admin.jobs.applications', $job) }}" class="text-sm underline">{{ __('admin.jobs.view_applications') }}</a>
            @endif
        </div>
        <dl class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            @foreach ($stageCounts as $stage => $total)
                <div class="rounded border border-gray-200 p-3 text-center">
                    <dt class="text-xs text-cg-navy-light">{{ __('stages.'.$stage) }}</dt>
                    <dd class="mt-1 text-xl font-bold" data-stage-count="{{ $stage }}">{{ $total }}</dd>
                </div>
            @endforeach
        </dl>
    </section>

    <section class="mt-6 rounded-lg bg-white p-6 shadow" id="exports">
        <h2 class="font-bold">{{ __('admin.exports.title') }}</h2>
        <p class="mt-1 text-sm text-cg-navy-light">{{ __('admin.exports.hint') }}</p>
        <form method="POST" action="{{ route('admin.jobs.exports.store', $job) }}" class="mt-4 flex flex-wrap items-end gap-3">@csrf
            <div>
                <label for="export-stages" class="block text-sm font-medium">{{ __('admin.exports.stages') }}</label>
                <select id="export-stages" name="stages[]" multiple size="7" class="mt-1 rounded border border-gray-300 px-2 py-1">
                    @foreach (\App\Enums\Stage::cases() as $stage)
                        <option value="{{ $stage->value }}" @selected($stage === \App\Enums\Stage::Shortlisted)>{{ $stage->label() }} ({{ $stageCounts[$stage->value] }})</option>
                    @endforeach
                </select>
            </div>
            <button class="rounded bg-cg-navy px-4 py-2 text-white hover:bg-cg-navy-light">{{ __('admin.exports.create') }}</button>
        </form>

        <h3 class="mt-6 text-sm font-bold">{{ __('admin.exports.recent') }}</h3>
        @forelse ($exports as $export)
            @php $statusClass = ['pending' => 'bg-yellow-100 text-yellow-800', 'ready' => 'bg-green-100 text-green-800', 'failed' => 'bg-red-100 text-red-800'][$export->status] ?? 'bg-gray-200'; @endphp
            <div class="mt-2 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-2 text-sm" data-export="{{ $export->id }}">
                <span dir="ltr">{{ $export->created_at->timezone('Africa/Cairo')->format('Y-m-d H:i') }}</span>
                <span>{{ collect($export->stages)->map(fn ($s) => __('stages.'.$s))->implode(', ') }}</span>
                <span class="rounded px-2 py-1 text-xs font-semibold {{ $statusClass }}">{{ __('admin.exports.statuses.'.$export->status) }}</span>
                @if ($export->status === 'ready')
                    <a class="underline" href="{{ route('admin.exports.download', [$export, 'xlsx']) }}">{{ __('admin.exports.download_xlsx') }}</a>
                    <a class="underline" href="{{ route('admin.exports.download', [$export, 'zip']) }}">{{ __('admin.exports.download_zip') }}</a>
                @elseif ($export->status === 'pending')
                    <span class="text-cg-navy-light">{{ __('admin.exports.pending_hint') }}</span>
                @else
                    <span class="text-red-700">{{ __('admin.exports.failed_hint') }}</span>
                @endif
            </div>
        @empty
            <p class="mt-2 text-sm text-cg-navy-light">{{ __('admin.exports.none') }}</p>
        @endforelse
    </section>
@endsection
