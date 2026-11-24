@extends('layouts.admin')
@section('title', $applicant->full_name)
@section('content')
    @php
        $locale = app()->getLocale();
        $badge = ['new' => 'bg-gray-200 text-gray-800', 'reviewed' => 'bg-blue-100 text-blue-800', 'shortlisted' => 'bg-cg-yellow-light text-cg-navy',
                  'sent_to_client' => 'bg-purple-100 text-purple-800', 'interview' => 'bg-indigo-100 text-indigo-800', 'hired' => 'bg-green-100 text-green-800', 'rejected' => 'bg-red-100 text-red-800'];
        $cairo = fn ($d) => $d?->copy()->timezone('Africa/Cairo')->format('Y-m-d H:i');
        $me = auth()->user();
        $none = __('admin.application.none');

        // Answers mapped to the job's question labels (current locale, falling back to the other language).
        $questions = collect($job->questions ?? [])->filter(fn ($q) => ! empty($q['id']))->keyBy('id');
        $answers = (array) ($application->answers ?? []);
        $pick = function (array $q, string $field) use ($locale) {
            $other = $locale === 'ar' ? 'en' : 'ar';
            foreach (["{$field}_{$locale}", "{$field}_{$other}"] as $k) {
                if (filled($q[$k] ?? null)) { return $q[$k]; }
            }
            return null;
        };
        $answerRows = [];
        foreach ($questions as $id => $q) {
            if (! array_key_exists($id, $answers)) { continue; }
            $value = $answers[$id];
            if (($q['type'] ?? 'text') === 'yes_no') {
                $value = $value === 'yes' ? __('admin.application.yes') : ($value === 'no' ? __('admin.application.no') : $value);
            } elseif (($q['type'] ?? 'text') === 'choice') {
                $en = array_values($q['options_en'] ?? []);
                $idx = array_search($value, $en, true);
                $ar = $q['options_ar'] ?? [];
                if ($locale === 'ar' && $idx !== false && filled($ar[$idx] ?? null)) { $value = $ar[$idx]; }
            }
            $answerRows[] = [$pick($q, 'label') ?? $id, is_array($value) ? implode(', ', $value) : (string) $value, false];
        }
        foreach ($answers as $id => $value) {
            if (! $questions->has($id)) {
                $answerRows[] = [$id, is_array($value) ? implode(', ', $value) : (string) $value, true];
            }
        }
        $cvFiles = $application->cvFiles;
        $pdf = $cvFiles->first(fn ($f) => $f->mime === 'application/pdf');
        $images = $cvFiles->filter(fn ($f) => str_starts_with($f->mime, 'image/'));
        $phoneLocal = \App\Support\PhoneNumber::toLocal($applicant->phone);
        $sourceKey = 'admin.application.sources.'.$application->source;
    @endphp

    <a href="{{ route('admin.jobs.applications', $job) }}" class="text-sm underline">&larr; {{ __('admin.application.back_to_list') }}: {{ $job->localized('title') }}</a>
    <div class="mt-2 flex flex-wrap items-center gap-3">
        <h1 class="text-2xl font-bold">{{ $applicant->full_name }}</h1>
        <span class="rounded px-2 py-1 text-xs font-semibold {{ $badge[$application->stage->value] }}">{{ $application->stage->label() }}</span>
    </div>
    <p class="mt-1 text-sm text-cg-navy-light">
        {{ __('admin.application.job') }}: <a href="{{ route('admin.jobs.show', $job) }}" class="underline">{{ $job->localized('title') }}</a>
        · {{ __('admin.application.applied_on') }}: {{ $cairo($application->created_at) }}
        @if (\Illuminate\Support\Facades\Lang::has($sourceKey)) · {{ __('admin.application.source') }}: {{ __($sourceKey) }}@endif
    </p>

    <div class="mt-6 grid gap-6 lg:grid-cols-3">
        <div class="space-y-6 lg:col-span-2">
            <section id="cv" class="rounded-lg bg-white p-4 shadow">
                <h2 class="text-lg font-semibold">{{ __('admin.application.cv') }}</h2>
                @if ($cvFiles->isEmpty())
                    <p class="mt-3 text-sm text-cg-navy-light">{{ __('admin.application.no_cv') }}</p>
                @endif
                @if ($pdf)
                    <iframe src="{{ route('admin.cv-files.show', $pdf) }}" title="{{ __('admin.application.cv_frame_title') }}" class="mt-3 h-[75vh] w-full rounded border border-gray-300"></iframe>
                @endif
                @if ($images->isNotEmpty())
                    <ul class="mt-3 grid gap-3 sm:grid-cols-2">
                        @foreach ($images as $i => $img)
                            <li>
                                <a href="{{ route('admin.cv-files.show', $img) }}" target="_blank" rel="noopener" class="block rounded border border-gray-300 p-1 hover:border-cg-navy" aria-label="{{ __('admin.application.cv_page', ['n' => $i + 1]) }}">
                                    <img src="{{ route('admin.cv-files.show', $img) }}" alt="{{ __('admin.application.cv_page', ['n' => $i + 1]) }}" loading="lazy" class="w-full rounded">
                                </a>
                            </li>
                        @endforeach
                    </ul>
                @endif
                @if ($cvFiles->isNotEmpty())
                    <ul class="mt-3 flex flex-wrap gap-4 text-sm">
                        @foreach ($cvFiles as $f)
                            <li>
                                <a href="{{ route('admin.cv-files.show', $f) }}" target="_blank" rel="noopener" class="underline">{{ __('admin.application.open_full') }}</a>
                                ·
                                <a href="{{ route('admin.cv-files.show', [$f, 'download' => 1]) }}" class="underline">{{ __('admin.application.download') }}: {{ $f->original_name }}</a>
                            </li>
                        @endforeach
                    </ul>
                @endif

                <form method="POST" action="{{ route('admin.applications.cv.replace', $application) }}" enctype="multipart/form-data" class="mt-5 border-t border-gray-200 pt-4 text-sm">
                    @csrf
                    <label for="cv-replace" class="font-medium">{{ __('admin.application.replace_cv') }}</label>
                    <p class="text-cg-navy-light">{{ __('admin.application.replace_hint') }}</p>
                    <input id="cv-replace" type="file" name="cv[]" multiple required accept="application/pdf,image/jpeg,image/png" class="mt-2 block w-full text-sm">
                    @error('cv')<p class="mt-1 text-red-700" role="alert">{{ $message }}</p>@enderror
                    @foreach ($errors->get('cv.*') as $msgs)<p class="mt-1 text-red-700" role="alert">{{ $msgs[0] }}</p>@endforeach
                    <button class="mt-3 rounded bg-cg-navy px-4 py-2 text-white hover:bg-cg-navy-light">{{ __('admin.application.replace_submit') }}</button>
                </form>

                @if ($replaced->isNotEmpty())
                    <details class="mt-4 text-sm">
                        <summary class="cursor-pointer font-medium">{{ __('admin.application.old_versions', ['count' => $replaced->count()]) }}</summary>
                        <ul class="mt-2 space-y-1">
                            @foreach ($replaced as $old)
                                <li>
                                    <a href="{{ route('admin.cv-files.show', $old) }}" target="_blank" rel="noopener" class="underline">{{ $old->original_name }}</a>
                                    <span class="text-cg-navy-light">{{ __('admin.application.replaced_on', ['date' => $cairo($old->replaced_at), 'user' => $old->replacedBy?->name ?? __('admin.application.removed_user')]) }}</span>
                                </li>
                            @endforeach
                        </ul>
                    </details>
                @endif
            </section>

            <section class="rounded-lg bg-white p-4 shadow">
                <h2 class="text-lg font-semibold">{{ __('admin.application.answers') }}</h2>
                @if ($answerRows === [])
                    <p class="mt-3 text-sm text-cg-navy-light">{{ __('admin.application.no_answers') }}</p>
                @else
                    <dl class="mt-3 space-y-3 text-sm">
                        @foreach ($answerRows as [$label, $value, $removed])
                            <div>
                                <dt class="font-medium">{{ $label }}@if ($removed) <span class="text-xs text-cg-navy-light">({{ __('admin.application.removed_question') }})</span>@endif</dt>
                                <dd class="mt-0.5 whitespace-pre-line">{{ $value !== '' ? $value : '—' }}</dd>
                            </div>
                        @endforeach
                    </dl>
                @endif
            </section>

            <section id="comments" class="rounded-lg bg-white p-4 shadow">
                <h2 class="text-lg font-semibold">{{ __('admin.application.comments') }}</h2>
                <p class="text-xs text-cg-navy-light">{{ __('admin.application.comments_hint') }}</p>
                <ul class="mt-3 space-y-3 text-sm">
                    @forelse ($application->comments as $comment)
                        <li class="rounded border border-gray-200 p-3" data-comment>
                            <div class="flex items-start justify-between gap-3">
                                <p class="text-xs text-cg-navy-light"><span class="font-semibold text-cg-navy">{{ $comment->user?->name ?? __('admin.application.removed_user') }}</span> · {{ $cairo($comment->created_at) }}</p>
                                @if ($me->isAdmin() || $comment->user_id === $me->id)
                                    <form method="POST" action="{{ route('admin.comments.destroy', $comment) }}" onsubmit="return confirm(@js(__('admin.actions.confirm_delete')))">
                                        @csrf @method('DELETE')
                                        <button class="text-xs text-red-700 underline">{{ __('admin.application.delete_comment') }}</button>
                                    </form>
                                @endif
                            </div>
                            <p class="mt-1">{!! nl2br(e($comment->body)) !!}</p>
                        </li>
                    @empty
                        <li class="text-cg-navy-light">{{ __('admin.application.no_comments') }}</li>
                    @endforelse
                </ul>
                <form method="POST" action="{{ route('admin.applications.comments.store', $application) }}" class="mt-4">
                    @csrf
                    <label for="comment-body" class="sr-only">{{ __('admin.application.add_comment') }}</label>
                    <textarea id="comment-body" name="body" rows="3" maxlength="2000" required placeholder="{{ __('admin.application.comment_placeholder') }}" class="w-full rounded border border-gray-300 px-3 py-2 text-sm">{{ old('body') }}</textarea>
                    @error('body')<p class="mt-1 text-sm text-red-700" role="alert">{{ $message }}</p>@enderror
                    <button class="mt-2 rounded bg-cg-navy px-4 py-2 text-sm text-white hover:bg-cg-navy-light">{{ __('admin.application.add_comment') }}</button>
                </form>
            </section>
        </div>

        <div class="space-y-6">
            <section class="rounded-lg bg-white p-4 shadow">
                <h2 class="text-lg font-semibold">{{ __('admin.application.applicant') }}</h2>
                <dl class="mt-3 space-y-2 text-sm">
                    <div><dt class="text-cg-navy-light">{{ __('admin.application.phone') }}</dt>
                        <dd class="flex items-center gap-3"><span dir="ltr">{{ $phoneLocal }}</span>
                            <a href="https://wa.me/{{ \App\Support\PhoneNumber::toWhatsApp($applicant->phone) }}" target="_blank" rel="noopener" class="text-green-700 underline">{{ __('admin.application.whatsapp') }}</a></dd></div>
                    <div><dt class="text-cg-navy-light">{{ __('admin.application.email') }}</dt><dd dir="ltr" class="text-start">{{ $applicant->email ?: $none }}</dd></div>
                    <div><dt class="text-cg-navy-light">{{ __('admin.application.location') }}</dt><dd>{{ collect([$applicant->city, $applicant->area])->filter()->implode(' / ') ?: $none }}</dd></div>
                    <div><dt class="text-cg-navy-light">{{ __('admin.application.age') }}</dt><dd>{{ $applicant->age() !== null ? __('admin.application.age_years', ['age' => $applicant->age()]) : $none }}</dd></div>
                </dl>
            </section>

            <section class="rounded-lg bg-white p-4 shadow">
                <h2 class="text-lg font-semibold">{{ __('admin.application.stage') }}</h2>
                <div class="mt-3 flex flex-wrap gap-2">
                    @foreach (\App\Enums\Stage::ordered() as $s)
                        <form method="POST" action="{{ route('admin.applications.stage', $application) }}">
                            @csrf @method('PATCH')
                            <input type="hidden" name="stage" value="{{ $s->value }}">
                            <button @disabled($s === $application->stage) @if ($s === $application->stage) aria-current="true" @endif
                                    class="rounded border px-3 py-1 text-sm {{ $s === $application->stage ? 'border-cg-navy bg-cg-yellow font-semibold text-cg-navy' : 'border-gray-300 bg-white hover:bg-cg-yellow-light' }}">{{ $s->label() }}</button>
                        </form>
                    @endforeach
                </div>

                <h3 class="mt-5 text-sm font-semibold">{{ __('admin.application.history') }}</h3>
                <ol class="mt-2 space-y-2 text-sm">
                    @forelse ($application->stageChanges as $change)
                        <li class="rounded border border-gray-200 p-2">
                            <p>{{ __('admin.application.history_line', ['from' => $change->from_stage?->label() ?? '—', 'to' => $change->to_stage->label()]) }}</p>
                            <p class="text-xs text-cg-navy-light">{{ $change->user_id === null ? __('admin.application.by_applicant') : ($change->user?->name ?? __('admin.application.removed_user')) }} · {{ $cairo($change->created_at) }}</p>
                        </li>
                    @empty
                        <li class="text-cg-navy-light">{{ __('admin.application.no_history') }}</li>
                    @endforelse
                </ol>
            </section>

            <section class="rounded-lg bg-white p-4 shadow">
                <h2 class="text-lg font-semibold">{{ __('admin.application.others') }}</h2>
                <ul class="mt-3 space-y-2 text-sm">
                    @forelse ($others as $o)
                        <li>
                            <a href="{{ route('admin.applications.show', $o) }}" class="font-medium underline">{{ $o->jobPosting->localized('title') }}</a>
                            <span class="ms-1 rounded px-2 py-0.5 text-xs font-semibold {{ $badge[$o->stage->value] }}">{{ $o->stage->label() }}</span>
                            <span class="text-xs text-cg-navy-light">{{ $cairo($o->created_at) }}</span>
                        </li>
                    @empty
                        <li class="text-cg-navy-light">{{ __('admin.application.no_others') }}</li>
                    @endforelse
                </ul>
            </section>

            @if ($me->isAdmin())
                <section class="rounded-lg border border-red-300 bg-white p-4 shadow">
                    <h2 class="text-lg font-semibold text-red-800">{{ __('admin.delete_applicant.title') }}</h2>
                    <p class="mt-2 text-sm">{{ __('admin.delete_applicant.warning') }}</p>
                    <form method="POST" action="{{ route('admin.applicants.destroy', $applicant) }}" class="mt-3 text-sm">
                        @csrf @method('DELETE')
                        <label for="confirm-delete" class="font-medium">{{ __('admin.delete_applicant.label', ['phone' => $phoneLocal]) }}</label>
                        <input id="confirm-delete" type="text" name="confirm" dir="ltr" required autocomplete="off" inputmode="tel" class="mt-2 w-full rounded border border-gray-300 px-3 py-2">
                        @error('confirm')<p class="mt-1 text-red-700" role="alert">{{ $message }}</p>@enderror
                        <button class="mt-3 rounded bg-red-700 px-4 py-2 text-white hover:bg-red-800">{{ __('admin.delete_applicant.submit') }}</button>
                    </form>
                </section>
            @endif
        </div>
    </div>
@endsection
