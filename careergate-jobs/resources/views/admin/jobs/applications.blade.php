@extends('layouts.admin')
@section('title', __('admin.applications.title'))
@section('content')
    @php
        $badge = ['new' => 'bg-gray-200 text-gray-800', 'reviewed' => 'bg-blue-100 text-blue-800', 'shortlisted' => 'bg-cg-yellow-light text-cg-navy',
                  'sent_to_client' => 'bg-purple-100 text-purple-800', 'interview' => 'bg-indigo-100 text-indigo-800', 'hired' => 'bg-green-100 text-green-800', 'rejected' => 'bg-red-100 text-red-800'];
        $showRoute = \Illuminate\Support\Facades\Route::has('admin.applications.show');
        $keep = fn (array $extra = []) => array_filter(array_merge(['jobPosting' => $job->id], request()->except('page'), $extra), fn ($v) => $v !== null && $v !== '');
    @endphp
    <a href="{{ route('admin.jobs.show', $job) }}" class="text-sm underline">&larr; {{ $job->localized('title') }}</a>
    <h1 class="mt-2 text-2xl font-bold">{{ __('admin.applications.title') }}</h1>

    <nav class="mt-6 flex flex-wrap gap-2 text-sm" aria-label="{{ __('admin.applications.stages') }}">
        <a href="{{ route('admin.jobs.applications', $keep(['stage' => null])) }}" class="rounded border px-3 py-2 {{ $stage === null ? 'border-cg-navy bg-cg-navy text-white' : 'border-gray-300 bg-white hover:bg-cg-yellow-light' }}">
            {{ __('admin.actions.all') }} <span class="ms-1 font-bold" data-tab-count="all">{{ $total }}</span>
        </a>
        @foreach ($tabs as $value => $count)
            <a href="{{ route('admin.jobs.applications', $keep(['stage' => $value])) }}" class="rounded border px-3 py-2 {{ $stage?->value === $value ? 'border-cg-navy bg-cg-navy text-white' : 'border-gray-300 bg-white hover:bg-cg-yellow-light' }}">
                {{ __('stages.'.$value) }} <span class="ms-1 font-bold" data-tab-count="{{ $value }}">{{ $count }}</span>
            </a>
        @endforeach
    </nav>

    <form method="GET" action="{{ route('admin.jobs.applications', $job) }}" class="mt-4 grid gap-3 rounded-lg bg-white p-4 text-sm shadow sm:grid-cols-2 lg:grid-cols-6">
        @if ($stage)<input type="hidden" name="stage" value="{{ $stage->value }}">@endif
        <label class="lg:col-span-2">{{ __('admin.applications.search') }}
            <input type="search" name="q" value="{{ $filters['q'] }}" placeholder="{{ __('admin.applications.search_hint') }}" class="mt-1 w-full rounded border border-gray-300 px-2 py-1">
        </label>
        <label>{{ __('admin.applications.city') }}
            <select name="city" class="mt-1 w-full rounded border border-gray-300 px-2 py-1">
                <option value="">{{ __('admin.actions.all') }}</option>
                @foreach ($cities as $c)<option value="{{ $c }}" @selected($filters['city'] === $c)>{{ $c }}</option>@endforeach
            </select>
        </label>
        <label>{{ __('admin.applications.area') }}
            <input type="text" name="area" value="{{ $filters['area'] }}" class="mt-1 w-full rounded border border-gray-300 px-2 py-1">
        </label>
        <label>{{ __('admin.applications.from') }}
            <input type="date" name="from" value="{{ $filters['from'] }}" class="mt-1 w-full rounded border border-gray-300 px-2 py-1">
        </label>
        <label>{{ __('admin.applications.to') }}
            <input type="date" name="to" value="{{ $filters['to'] }}" class="mt-1 w-full rounded border border-gray-300 px-2 py-1">
        </label>
        <div class="flex items-center gap-2 sm:col-span-2 lg:col-span-6">
            <button class="rounded bg-cg-navy px-4 py-2 text-white hover:bg-cg-navy-light">{{ __('admin.applications.filter') }}</button>
            <a href="{{ route('admin.jobs.applications', $job) }}" class="underline">{{ __('admin.applications.reset') }}</a>
        </div>
    </form>

    <form method="POST" action="{{ route('admin.jobs.applications.bulk-stage', $job) }}" data-bulk-form class="mt-4">
        @csrf @method('PATCH')
        <div class="flex flex-wrap items-center gap-3 rounded-t-lg bg-cg-yellow-light px-4 py-3 text-sm">
            <label class="flex items-center gap-2"><input type="checkbox" data-select-all> {{ __('admin.applications.select_all') }}</label>
            <span><span data-selected-count>0</span> {{ __('admin.applications.selected') }}</span>
            <label class="sr-only" for="bulk-stage">{{ __('admin.applications.move_to') }}</label>
            <select id="bulk-stage" name="stage" class="rounded border border-gray-300 px-2 py-1">
                @foreach (\App\Enums\Stage::ordered() as $s)<option value="{{ $s->value }}">{{ $s->label() }}</option>@endforeach
            </select>
            <button class="rounded bg-cg-navy px-3 py-1 text-white hover:bg-cg-navy-light">{{ __('admin.applications.apply') }}</button>
            @error('ids')<span class="text-red-700" role="alert">{{ $message }}</span>@enderror
            @error('stage')<span class="text-red-700" role="alert">{{ $message }}</span>@enderror
        </div>

        <div class="overflow-x-auto rounded-b-lg bg-white shadow">
            <table class="min-w-full text-sm">
                <thead class="bg-gray-50">
                    <tr>
                        <th class="w-10 px-4 py-3"></th>
                        <th class="px-4 py-3 text-start">{{ __('admin.common.name') }}</th>
                        <th class="px-4 py-3 text-start">{{ __('admin.applications.phone') }}</th>
                        <th class="px-4 py-3 text-start">{{ __('admin.applications.location') }}</th>
                        <th class="px-4 py-3 text-start">{{ __('admin.common.status') }}</th>
                        <th class="px-4 py-3 text-start">
                            <a href="{{ route('admin.jobs.applications', $keep(['sort' => $filters['sort'] === 'asc' ? 'desc' : 'asc'])) }}" class="underline">
                                {{ __('admin.applications.applied') }} {{ $filters['sort'] === 'asc' ? '▲' : '▼' }}
                            </a>
                        </th>
                        <th class="px-4 py-3 text-start">{{ __('admin.applications.comments') }}</th>
                        <th class="px-4 py-3 text-start">{{ __('admin.applications.whatsapp') }}</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">
                @forelse ($applications as $app)
                    @php($ap = $app->applicant)
                    <tr>
                        <td class="px-4 py-3"><input type="checkbox" name="ids[]" value="{{ $app->id }}" data-row-check aria-label="{{ $ap->full_name }}"></td>
                        <td class="px-4 py-3 font-medium">
                            @if ($showRoute)<a href="{{ route('admin.applications.show', $app) }}" class="underline">{{ $ap->full_name }}</a>@else{{ $ap->full_name }}@endif
                        </td>
                        <td class="px-4 py-3" dir="ltr">{{ '0'.substr($ap->phone, 3) }}</td>
                        <td class="px-4 py-3">{{ collect([$ap->area, $ap->city])->filter()->implode(', ') ?: '—' }}</td>
                        <td class="px-4 py-3"><span class="rounded px-2 py-1 text-xs font-semibold {{ $badge[$app->stage->value] }}">{{ $app->stage->label() }}</span></td>
                        <td class="px-4 py-3">{{ $app->created_at->timezone('Africa/Cairo')->format('Y-m-d') }}</td>
                        <td class="px-4 py-3" data-comment-count="{{ $app->comments_count }}">{{ $app->comments_count }}</td>
                        <td class="px-4 py-3">
                            <a href="https://wa.me/{{ substr($ap->phone, 1) }}" target="_blank" rel="noopener" class="inline-flex text-green-700 hover:text-green-900" aria-label="{{ __('admin.applications.whatsapp') }}: {{ $ap->full_name }}">
                                <svg viewBox="0 0 24 24" class="h-5 w-5" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.3 14.2c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.800-1.100-4.600-4-4.700-4.200-.1-.2-1.100-1.500-1.100-2.900s.7-2.100 1-2.400c.2-.3.500-.3.700-.3h.5c.2 0 .4 0 .6.500l.8 2c.1.200.1.300 0 .5l-.3.400-.4.500c-.1.100-.3.300-.1.600.2.300.8 1.300 1.700 2.100 1.100 1 2.100 1.300 2.400 1.400.3.100.5.100.6-.1l.9-1.100c.2-.3.400-.2.600-.1l1.900.9c.3.100.5.200.5.300.1.200.1.800-.1 1.300Z"/></svg>
                            </a>
                        </td>
                    </tr>
                @empty
                    <tr><td colspan="8" class="px-4 py-6 text-center text-cg-navy-light">{{ __('admin.applications.empty') }}</td></tr>
                @endforelse
                </tbody>
            </table>
        </div>
    </form>
    <div class="mt-4">{{ $applications->links() }}</div>
@endsection
