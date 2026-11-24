@php
    $locale = app()->getLocale();
    $input = 'mt-1 block min-h-12 w-full rounded-lg border border-cg-navy-light/40 bg-white px-3 py-2 text-base text-cg-navy focus:border-cg-navy focus:outline-none focus:ring-2 focus:ring-cg-yellow';
    $label = 'block text-sm font-semibold';
    $err = 'mt-1 text-sm font-semibold text-red-700';
    $cvErrors = collect($errors->get('cv'))->merge(collect($errors->get('cv.*'))->flatten())->unique()->values();
    $dobMin = now()->subYears(70)->toDateString();
    $dobMax = now()->subYears(15)->toDateString();
    $questions = collect($job->questions ?? [])->filter(fn ($q) => ! empty($q['id']));
@endphp

<form method="POST" action="{{ \App\Support\LocalizedRoute::url('jobs.apply', [$job]) }}" enctype="multipart/form-data"
      class="mt-3 space-y-4" data-apply-form
      data-msg-uploading="{{ __('public.apply.uploading') }}"
      data-msg-processing="{{ __('public.apply.processing') }}"
      data-msg-remove="{{ __('public.apply.remove') }}"
      data-msg-mixed="{{ __('public.apply.js_pdf_or_images') }}"
      data-msg-too-many="{{ __('public.apply.js_too_many') }}"
      data-msg-too-large="{{ __('public.apply.js_too_large') }}"
      data-msg-type="{{ __('public.apply.js_type') }}"
      data-msg-failed="{{ __('public.apply.js_failed') }}"
      data-msg-required="{{ __('public.apply.cv_required') }}"
      data-msg-one-pdf="{{ __('public.apply.js_one_pdf') }}"
      data-max-kb="{{ config('careergate.cv.max_kb') }}" data-max-images="{{ config('careergate.cv.max_images') }}">
    @csrf

    <p class="text-cg-navy-light">{{ __('public.apply.intro') }}</p>

    @if ($errors->any())
        <div class="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800" role="alert">
            <p class="font-semibold">{{ __('public.apply.errors_title') }}</p>
            <ul class="mt-1 list-disc ps-5">
                @foreach (collect($errors->all())->unique() as $message)
                    <li>{{ $message }}</li>
                @endforeach
            </ul>
        </div>
    @endif

    {{-- Honeypot: hidden from people, bots tend to fill it. --}}
    <div class="sr-only" aria-hidden="true">
        <label>Website <input type="text" name="website" value="" tabindex="-1" autocomplete="off"></label>
    </div>

    <div>
        <label for="full_name" class="{{ $label }}">{{ __('public.apply.full_name') }} *</label>
        <input id="full_name" name="full_name" type="text" required maxlength="120" autocomplete="name"
               value="{{ old('full_name') }}" class="{{ $input }}">
        @error('full_name')<p class="{{ $err }}">{{ $message }}</p>@enderror
    </div>

    <div>
        <label for="phone" class="{{ $label }}">{{ __('public.apply.phone') }} *</label>
        <input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" required maxlength="30" dir="ltr"
               placeholder="010 1234 5678" value="{{ old('phone') }}" aria-describedby="phone-hint"
               class="{{ $input }} rtl:text-right">
        <p id="phone-hint" class="mt-1 text-sm text-cg-navy-light">{{ __('public.apply.phone_hint') }}</p>
        @error('phone')<p class="{{ $err }}">{{ $message }}</p>@enderror
    </div>

    <div>
        <label for="email" class="{{ $label }}">{{ __('public.apply.email') }}</label>
        <input id="email" name="email" type="email" inputmode="email" autocomplete="email" maxlength="190" dir="ltr"
               value="{{ old('email') }}" class="{{ $input }} rtl:text-right">
        @error('email')<p class="{{ $err }}">{{ $message }}</p>@enderror
    </div>

    <div class="grid gap-4 sm:grid-cols-2">
        <div>
            <label for="city" class="{{ $label }}">{{ __('public.apply.city') }} *</label>
            <input id="city" name="city" type="text" required maxlength="100" autocomplete="address-level2"
                   value="{{ old('city', $job->city) }}" class="{{ $input }}">
            @error('city')<p class="{{ $err }}">{{ $message }}</p>@enderror
        </div>
        <div>
            <label for="area" class="{{ $label }}">{{ __('public.apply.area') }}</label>
            <input id="area" name="area" type="text" maxlength="100" autocomplete="address-level3"
                   value="{{ old('area') }}" class="{{ $input }}">
            @error('area')<p class="{{ $err }}">{{ $message }}</p>@enderror
        </div>
    </div>

    <div>
        <label for="date_of_birth" class="{{ $label }}">{{ __('public.apply.date_of_birth') }}</label>
        <input id="date_of_birth" name="date_of_birth" type="date" min="{{ $dobMin }}" max="{{ $dobMax }}" autocomplete="bday"
               value="{{ old('date_of_birth') }}" class="{{ $input }}">
        @error('date_of_birth')<p class="{{ $err }}">{{ $message }}</p>@enderror
    </div>

    @foreach ($questions as $q)
        @php
            $qid = $q['id'];
            $qLabel = filled($q['label_'.$locale] ?? null) ? $q['label_'.$locale] : ($q['label_en'] ?? $q['label_ar'] ?? '');
            $required = ! empty($q['required']);
            $en = $q['options_en'] ?? [];
            $ar = $q['options_ar'] ?? [];
            $val = old('answers.'.$qid);
        @endphp
        <div>
            <label for="answers_{{ $qid }}" class="{{ $label }}">{{ $qLabel }}@if ($required) *@endif</label>
            @if (($q['type'] ?? 'text') === 'yes_no')
                <select id="answers_{{ $qid }}" name="answers[{{ $qid }}]" @required($required) class="{{ $input }}">
                    <option value="">{{ __('public.apply.select') }}</option>
                    <option value="yes" @selected($val === 'yes')>{{ __('public.apply.yes') }}</option>
                    <option value="no" @selected($val === 'no')>{{ __('public.apply.no') }}</option>
                </select>
            @elseif (($q['type'] ?? 'text') === 'choice')
                <select id="answers_{{ $qid }}" name="answers[{{ $qid }}]" @required($required) class="{{ $input }}">
                    <option value="">{{ __('public.apply.select') }}</option>
                    @for ($i = 0, $n = max(count($en), count($ar)); $i < $n; $i++)
                        @php
                            $value = filled($en[$i] ?? null) ? $en[$i] : ($ar[$i] ?? '');
                            $text = $locale === 'ar' && filled($ar[$i] ?? null) ? $ar[$i] : $value;
                        @endphp
                        @continue(! filled($value))
                        <option value="{{ $value }}" @selected($val === $value)>{{ $text }}</option>
                    @endfor
                </select>
            @else
                <input id="answers_{{ $qid }}" name="answers[{{ $qid }}]" type="text" maxlength="500" @required($required)
                       value="{{ $val }}" class="{{ $input }}">
            @endif
            @error('answers.'.$qid)<p class="{{ $err }}">{{ $message }}</p>@enderror
        </div>
    @endforeach

    <fieldset class="rounded-lg bg-cg-yellow-light p-3" data-cv>
        <legend class="px-1 text-sm font-semibold">{{ __('public.apply.cv') }} *</legend>
        <p class="text-sm text-cg-navy-light">{{ __('public.apply.cv_hint') }}</p>

        {{-- Plain input: works without JavaScript. JS hides it and shows the buttons below. --}}
        <input id="cv" name="cv[]" type="file" multiple required data-cv-input
               accept="application/pdf,image/jpeg,image/png,image/heic,image/heif,.pdf,.jpg,.jpeg,.png,.heic,.heif"
               class="mt-2 block w-full text-base file:me-3 file:min-h-12 file:rounded-lg file:border-0 file:bg-cg-navy file:px-4 file:py-2 file:font-semibold file:text-white">

        <div class="mt-2 hidden gap-2" data-cv-buttons>
            <button type="button" data-cv-camera
                    class="min-h-12 flex-1 rounded-lg bg-cg-navy px-4 py-2 font-semibold text-white">{{ __('public.apply.take_photo') }}</button>
            <button type="button" data-cv-choose
                    class="min-h-12 flex-1 rounded-lg border-2 border-cg-navy px-4 py-2 font-semibold text-cg-navy">{{ __('public.apply.choose_file') }}</button>
        </div>
        <input type="file" accept="image/*" capture="environment" class="hidden" data-cv-camera-input tabindex="-1">

        <ul class="mt-2 space-y-2" data-cv-list></ul>
        <p class="mt-2 hidden text-sm font-semibold text-red-700" data-cv-error role="alert"></p>

        @foreach ($cvErrors as $message)
            <p class="{{ $err }}">{{ $message }}</p>
        @endforeach
    </fieldset>

    <div>
        <label class="flex items-start gap-3 text-sm">
            <input type="checkbox" name="consent" value="1" required @checked(old('consent'))
                   class="mt-0.5 h-6 w-6 shrink-0 accent-cg-navy">
            <span>{{ __('public.apply.consent') }}</span>
        </label>
        @error('consent')<p class="{{ $err }}">{{ $message }}</p>@enderror
    </div>

    <button type="submit" data-apply-submit
            class="min-h-12 w-full rounded-lg bg-cg-yellow px-4 py-3 text-lg font-bold text-cg-navy hover:bg-cg-yellow-light disabled:opacity-60">
        {{ __('public.apply.submit') }}
    </button>
</form>
