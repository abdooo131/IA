@extends('layouts.admin')
@section('title', __('admin.talent.title'))
@section('content')
    @php
        $badge = ['new' => 'bg-gray-200 text-gray-800', 'reviewed' => 'bg-blue-100 text-blue-800', 'shortlisted' => 'bg-cg-yellow-light text-cg-navy',
                  'sent_to_client' => 'bg-purple-100 text-purple-800', 'interview' => 'bg-indigo-100 text-indigo-800', 'hired' => 'bg-green-100 text-green-800', 'rejected' => 'bg-red-100 text-red-800'];
        $input = 'mt-1 w-full rounded border border-gray-300 px-2 py-1';
    @endphp
    <h1 class="text-2xl font-bold">{{ __('admin.talent.title') }}</h1>
    <p class="mt-1 text-sm text-cg-navy-light">{{ __('admin.talent.intro') }}</p>

    @if ($errors->has('job_posting_id'))
        <div class="mt-4 rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{{ $errors->first('job_posting_id') }}</div>
    @endif

    <form method="GET" action="{{ route('admin.talent-pool.index') }}" class="mt-4 grid gap-3 rounded-lg bg-white p-4 text-sm shadow sm:grid-cols-2 lg:grid-cols-4">
        <label class="lg:col-span-2">{{ __('admin.talent.search') }}
            <input type="search" name="q" value="{{ $filters['q'] }}" placeholder="{{ __('admin.talent.search_hint') }}" class="{{ $input }}">
        </label>
        <label>{{ __('admin.talent.city') }}
            <select name="city" class="{{ $input }}">
                <option value="">{{ __('admin.actions.all') }}</option>
                @foreach ($cities as $c)<option value="{{ $c }}" @selected($filters['city'] === $c)>{{ $c }}</option>@endforeach
            </select>
        </label>
        <label>{{ __('admin.talent.area') }}
            <input type="text" name="area" value="{{ $filters['area'] }}" class="{{ $input }}">
        </label>
        <label>{{ __('admin.talent.age_min') }}
            <input type="number" name="age_min" min="0" max="120" value="{{ $filters['age_min'] }}" class="{{ $input }}">
        </label>
        <label>{{ __('admin.talent.age_max') }}
            <input type="number" name="age_max" min="0" max="120" value="{{ $filters['age_max'] }}" class="{{ $input }}">
        </label>
        <label title="{{ __('admin.talent.best_stage_note') }}">{{ __('admin.talent.best_stage') }}
            <select name="best_stage" class="{{ $input }}">
                <option value="">{{ __('admin.actions.all') }}</option>
                @foreach (\App\Enums\Stage::ordered() as $s)<option value="{{ $s->value }}" @selected($filters['best_stage'] === $s->value)>{{ $s->label() }}</option>@endforeach
            </select>
        </label>
        <label>{{ __('admin.talent.job') }}
            <select name="job_id" class="{{ $input }}">
                <option value="">{{ __('admin.actions.all') }}</option>
                @foreach ($allJobs as $j)<option value="{{ $j->id }}" @selected($filters['job_id'] === (string) $j->id)>{{ $j->localized('title') }}</option>@endforeach
            </select>
        </label>
        <label>{{ __('admin.talent.applied_from') }}
            <input type="date" name="applied_from" value="{{ $filters['applied_from'] }}" class="{{ $input }}">
        </label>
        <label>{{ __('admin.talent.applied_to') }}
            <input type="date" name="applied_to" value="{{ $filters['applied_to'] }}" class="{{ $input }}">
        </label>
        <div class="flex items-center gap-2 sm:col-span-2 lg:col-span-4">
            <button class="rounded bg-cg-navy px-4 py-2 text-white hover:bg-cg-navy-light">{{ __('admin.talent.filter') }}</button>
            <a href="{{ route('admin.talent-pool.index') }}" class="underline">{{ __('admin.talent.reset') }}</a>
            <span class="ms-auto text-cg-navy-light">{{ __('admin.talent.results', ['count' => $applicants->total()]) }}</span>
        </div>
    </form>

    <div class="mt-4 overflow-x-auto rounded-lg bg-white shadow">
        <table class="min-w-full text-sm">
            <thead class="bg-gray-50">
                <tr>
                    <th class="px-4 py-3 text-start">{{ __('admin.talent.name') }}</th>
                    <th class="px-4 py-3 text-start">{{ __('admin.talent.phone') }}</th>
                    <th class="px-4 py-3 text-start">{{ __('admin.talent.location') }}</th>
                    <th class="px-4 py-3 text-start">{{ __('admin.talent.age') }}</th>
                    <th class="px-4 py-3 text-start">{{ __('admin.talent.applications') }}</th>
                    <th class="px-4 py-3 text-start">{{ __('admin.talent.last_job') }}</th>
                    <th class="px-4 py-3 text-start">{{ __('admin.talent.best') }}</th>
                    <th class="px-4 py-3 text-start">{{ __('admin.talent.add_to_job') }}</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
            @forelse ($applicants as $ap)
                @php
                    $latest = $ap->applications->first();
                    $appliedJobIds = $ap->applications->pluck('job_posting_id')->all();
                    $available = $openJobs->reject(fn ($j) => in_array($j->id, $appliedJobIds, true));
                    $bestStage = $best[$ap->id] ?? \App\Enums\Stage::New;
                @endphp
                <tr>
                    <td class="px-4 py-3 font-medium">
                        @if ($latest)<a href="{{ route('admin.applications.show', $latest) }}" class="underline">{{ $ap->full_name }}</a>@else{{ $ap->full_name }}@endif
                    </td>
                    <td class="px-4 py-3">
                        <span dir="ltr">{{ \App\Support\PhoneNumber::toLocal($ap->phone) }}</span>
                        <a href="https://wa.me/{{ \App\Support\PhoneNumber::toWhatsApp($ap->phone) }}" target="_blank" rel="noopener" class="ms-2 text-green-700 underline" aria-label="{{ __('admin.talent.whatsapp') }}: {{ $ap->full_name }}">{{ __('admin.talent.whatsapp') }}</a>
                    </td>
                    <td class="px-4 py-3">{{ collect([$ap->area, $ap->city])->filter()->implode(', ') ?: '—' }}</td>
                    <td class="px-4 py-3">{{ $ap->age() ?? '—' }}</td>
                    <td class="px-4 py-3">{{ $ap->applications->count() }}</td>
                    <td class="px-4 py-3">{{ $latest?->jobPosting?->localized('title') ?? '—' }}</td>
                    <td class="px-4 py-3"><span class="rounded px-2 py-1 text-xs font-semibold {{ $badge[$bestStage->value] }}">{{ $bestStage->label() }}</span></td>
                    <td class="px-4 py-3">
                        @if ($available->isEmpty())
                            <span class="text-cg-navy-light">{{ __('admin.talent.no_open_jobs') }}</span>
                        @else
                            <form method="POST" action="{{ route('admin.applicants.add-to-job', $ap) }}" class="flex items-center gap-2">
                                @csrf
                                <label class="sr-only" for="job-{{ $ap->id }}">{{ __('admin.talent.add_to_job') }}: {{ $ap->full_name }}</label>
                                <select id="job-{{ $ap->id }}" name="job_posting_id" required class="max-w-48 rounded border border-gray-300 px-2 py-1">
                                    <option value="">{{ __('admin.talent.choose_job') }}</option>
                                    @foreach ($available as $j)<option value="{{ $j->id }}">{{ $j->localized('title') }}</option>@endforeach
                                </select>
                                <button class="rounded bg-cg-navy px-3 py-1 text-white hover:bg-cg-navy-light">{{ __('admin.talent.add') }}</button>
                            </form>
                        @endif
                    </td>
                </tr>
            @empty
                <tr><td colspan="8" class="px-4 py-6 text-center text-cg-navy-light">{{ __('admin.talent.empty') }}</td></tr>
            @endforelse
            </tbody>
        </table>
    </div>
    <div class="mt-4">{{ $applicants->links() }}</div>
@endsection
