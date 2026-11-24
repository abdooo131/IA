@extends('layouts.admin')
@section('title', $job->exists ? __('admin.jobs.edit') : __('admin.jobs.add'))
@section('content')
    @php
        $initialQuestions = old('questions', $job->questions ?? []);
        $initialQuestions = collect($initialQuestions)->map(fn ($q) => [
            'id' => $q['id'] ?? '',
            'type' => $q['type'] ?? 'text',
            'label_en' => $q['label_en'] ?? '',
            'label_ar' => $q['label_ar'] ?? '',
            'options_en' => implode("\n", (array) ($q['options_en'] ?? [])),
            'options_ar' => implode("\n", (array) ($q['options_ar'] ?? [])),
            'required' => (bool) ($q['required'] ?? false),
        ])->values();
        $input = 'mt-1 block w-full rounded border border-gray-300 px-3 py-2 focus:border-cg-yellow focus:ring-2 focus:ring-cg-yellow focus:outline-none';
        $closes = old('closes_on', $job->closes_on?->format('Y-m-d'));
        $hasArErr = $errors->has('title_ar') || $errors->has('responsibilities_ar') || $errors->has('requirements_ar');
    @endphp
    <h1 class="text-2xl font-bold">{{ $job->exists ? __('admin.jobs.edit') : __('admin.jobs.add') }}</h1>

    <form method="POST" action="{{ $job->exists ? route('admin.jobs.update', $job) : route('admin.jobs.store') }}" class="mt-6 max-w-4xl space-y-6"
          x-data="jobForm({{ \Illuminate\Support\Js::from(['tab' => $hasArErr && ! $errors->has('title_en') ? 'ar' : 'en', 'questions' => $initialQuestions]) }})">
        @csrf
        @if ($job->exists) @method('PUT') @endif

        <section class="rounded-lg bg-white p-6 shadow">
            <div class="grid gap-4 sm:grid-cols-2">
                <div>
                    <label for="client_company_id" class="block text-sm font-medium">{{ __('admin.jobs.client') }}</label>
                    <select id="client_company_id" name="client_company_id" required class="{{ $input }}">
                        <option value=""></option>
                        @foreach ($clients as $c)
                            <option value="{{ $c->id }}" @selected((string) old('client_company_id', $job->client_company_id) === (string) $c->id)>{{ $c->name }}</option>
                        @endforeach
                    </select>
                    @error('client_company_id')<p class="mt-1 text-sm text-red-700">{{ $message }}</p>@enderror
                </div>
                <div>
                    <label for="employment_type" class="block text-sm font-medium">{{ __('admin.jobs.employment_type') }}</label>
                    <select id="employment_type" name="employment_type" class="{{ $input }}">
                        @foreach (\App\Enums\EmploymentType::cases() as $t)
                            <option value="{{ $t->value }}" @selected(old('employment_type', $job->employment_type?->value ?? $job->employment_type) === $t->value)>{{ __('admin.jobs.employment.'.$t->value) }}</option>
                        @endforeach
                    </select>
                    @error('employment_type')<p class="mt-1 text-sm text-red-700">{{ $message }}</p>@enderror
                </div>
                <div>
                    <label for="city" class="block text-sm font-medium">{{ __('admin.jobs.city') }}</label>
                    <input id="city" name="city" required value="{{ old('city', $job->city) }}" class="{{ $input }}">
                    @error('city')<p class="mt-1 text-sm text-red-700">{{ $message }}</p>@enderror
                </div>
                <div>
                    <label for="area" class="block text-sm font-medium">{{ __('admin.jobs.area') }}</label>
                    <input id="area" name="area" value="{{ old('area', $job->area) }}" class="{{ $input }}">
                    @error('area')<p class="mt-1 text-sm text-red-700">{{ $message }}</p>@enderror
                </div>
                <div>
                    <label for="salary_text" class="block text-sm font-medium">{{ __('admin.jobs.salary_text') }}</label>
                    <input id="salary_text" name="salary_text" maxlength="120" value="{{ old('salary_text', $job->salary_text) }}" class="{{ $input }}">
                    @error('salary_text')<p class="mt-1 text-sm text-red-700">{{ $message }}</p>@enderror
                </div>
                <div>
                    <label for="closes_on" class="block text-sm font-medium">{{ __('admin.jobs.closes_on') }}</label>
                    <input id="closes_on" name="closes_on" type="date" value="{{ $closes }}" class="{{ $input }}">
                    @error('closes_on')<p class="mt-1 text-sm text-red-700">{{ $message }}</p>@enderror
                </div>
                <div>
                    <label for="status" class="block text-sm font-medium">{{ __('admin.jobs.status') }}</label>
                    <select id="status" name="status" class="{{ $input }}">
                        @foreach (\App\Enums\JobStatus::cases() as $s)
                            <option value="{{ $s->value }}" @selected(old('status', $job->status?->value ?? $job->status) === $s->value)>{{ __('admin.jobs.statuses.'.$s->value) }}</option>
                        @endforeach
                    </select>
                    @error('status')<p class="mt-1 text-sm text-red-700">{{ $message }}</p>@enderror
                </div>
                <label class="flex items-center gap-2 self-end pb-2 text-sm">
                    <input type="hidden" name="show_client_name" value="0">
                    <input type="checkbox" name="show_client_name" value="1" @checked(old('show_client_name', $job->show_client_name))>
                    {{ __('admin.jobs.show_client_name') }}
                </label>
            </div>
        </section>

        <section class="rounded-lg bg-white p-6 shadow">
            <div class="flex gap-2 border-b border-gray-200" role="tablist">
                <button type="button" role="tab" @click="tab = 'en'" :aria-selected="tab === 'en'" :class="tab === 'en' ? 'border-cg-yellow font-semibold' : 'border-transparent'" class="border-b-4 px-4 py-2">{{ __('admin.jobs.tab_en') }}</button>
                <button type="button" role="tab" @click="tab = 'ar'" :aria-selected="tab === 'ar'" :class="tab === 'ar' ? 'border-cg-yellow font-semibold' : 'border-transparent'" class="border-b-4 px-4 py-2">{{ __('admin.jobs.tab_ar') }}</button>
            </div>
            <p class="mt-3 text-sm text-cg-navy-light">{{ __('admin.jobs.title_hint') }}</p>
            @error('title_en')<p class="mt-1 text-sm text-red-700">{{ $message }}</p>@enderror

            @foreach (['en', 'ar'] as $lang)
                <div x-show="tab === '{{ $lang }}'" @if ($lang === 'ar') dir="rtl" style="display:none" @endif class="mt-4 space-y-4">
                    <div>
                        <label for="title_{{ $lang }}" class="block text-sm font-medium">{{ __('admin.jobs.title_label') }} ({{ __('admin.jobs.tab_'.$lang) }})</label>
                        <input id="title_{{ $lang }}" name="title_{{ $lang }}" value="{{ old('title_'.$lang, $job->{'title_'.$lang}) }}" class="{{ $input }}">
                        @if ($lang === 'ar') @error('title_ar')<p class="mt-1 text-sm text-red-700">{{ $message }}</p>@enderror @endif
                    </div>
                    @foreach (['responsibilities', 'requirements'] as $f)
                        <div>
                            <label for="{{ $f }}_{{ $lang }}" class="block text-sm font-medium">{{ __('admin.jobs.'.$f) }} <span class="font-normal text-cg-navy-light">— {{ __('admin.jobs.one_per_line') }}</span></label>
                            <textarea id="{{ $f }}_{{ $lang }}" name="{{ $f }}_{{ $lang }}" rows="6" class="{{ $input }}">{{ old($f.'_'.$lang, $job->{$f.'_'.$lang}) }}</textarea>
                            @error($f.'_'.$lang)<p class="mt-1 text-sm text-red-700">{{ $message }}</p>@enderror
                        </div>
                    @endforeach
                </div>
            @endforeach
        </section>

        <section class="rounded-lg bg-white p-6 shadow">
            <h2 class="font-bold">{{ __('admin.jobs.questions') }}</h2>
            <p class="text-sm text-cg-navy-light">{{ __('admin.jobs.questions_hint') }}</p>
            @foreach ($errors->get('questions.*') as $messages)
                @foreach ($messages as $m)<p class="mt-1 text-sm text-red-700">{{ $m }}</p>@endforeach
            @endforeach

            <div class="mt-4 space-y-4">
                <template x-for="(q, i) in questions" :key="q.key">
                    <div class="rounded border border-gray-200 p-4">
                        <input type="hidden" :name="`questions[${i}][id]`" :value="q.id">
                        <div class="grid gap-3 sm:grid-cols-2">
                            <div>
                                <label class="block text-sm font-medium">{{ __('admin.jobs.question_label') }} (EN)</label>
                                <input :name="`questions[${i}][label_en]`" x-model="q.label_en" class="{{ $input }}">
                            </div>
                            <div>
                                <label class="block text-sm font-medium">{{ __('admin.jobs.question_label') }} (AR)</label>
                                <input dir="rtl" :name="`questions[${i}][label_ar]`" x-model="q.label_ar" class="{{ $input }}">
                            </div>
                            <div>
                                <label class="block text-sm font-medium">{{ __('admin.jobs.question_type') }}</label>
                                <select :name="`questions[${i}][type]`" x-model="q.type" class="{{ $input }}">
                                    @foreach (\App\Enums\QuestionType::cases() as $t)
                                        <option value="{{ $t->value }}">{{ __('admin.jobs.types.'.$t->value) }}</option>
                                    @endforeach
                                </select>
                            </div>
                            <label class="flex items-center gap-2 self-end pb-2 text-sm">
                                <input type="hidden" :name="`questions[${i}][required]`" value="0">
                                <input type="checkbox" :name="`questions[${i}][required]`" value="1" x-model="q.required">
                                {{ __('admin.jobs.required') }}
                            </label>
                        </div>
                        <div class="mt-3 grid gap-3 sm:grid-cols-2" x-show="q.type === 'choice'">
                            <div>
                                <label class="block text-sm font-medium">{{ __('admin.jobs.options') }} (EN)</label>
                                <textarea rows="3" x-model="q.options_en" class="{{ $input }}"></textarea>
                                <template x-for="o in lines(q.options_en)"><input type="hidden" :name="`questions[${i}][options_en][]`" :value="o"></template>
                            </div>
                            <div>
                                <label class="block text-sm font-medium">{{ __('admin.jobs.options') }} (AR)</label>
                                <textarea rows="3" dir="rtl" x-model="q.options_ar" class="{{ $input }}"></textarea>
                                <template x-for="o in lines(q.options_ar)"><input type="hidden" :name="`questions[${i}][options_ar][]`" :value="o"></template>
                            </div>
                        </div>
                        <div class="mt-3 flex gap-3 text-sm">
                            <button type="button" class="underline disabled:opacity-40" :disabled="i === 0" @click="move(i, -1)">{{ __('admin.jobs.move_up') }}</button>
                            <button type="button" class="underline disabled:opacity-40" :disabled="i === questions.length - 1" @click="move(i, 1)">{{ __('admin.jobs.move_down') }}</button>
                            <button type="button" class="text-red-700 underline" @click="questions.splice(i, 1)">{{ __('admin.jobs.remove_question') }}</button>
                        </div>
                    </div>
                </template>
            </div>
            <button type="button" @click="add()" class="mt-4 rounded border border-cg-navy px-4 py-2 text-sm hover:bg-cg-yellow-light">{{ __('admin.jobs.add_question') }}</button>
        </section>

        <div class="flex items-center gap-4">
            <button class="rounded bg-cg-yellow px-6 py-2 font-semibold text-cg-navy hover:brightness-95">{{ __('admin.common.save') }}</button>
            <a href="{{ $job->exists ? route('admin.jobs.show', $job) : route('admin.jobs.index') }}" class="underline">{{ __('admin.actions.cancel') }}</a>
        </div>
    </form>
@endsection
