<?php

namespace App\Http\Requests;

use App\Models\JobPosting;
use App\Support\LocalizedRoute;
use App\Support\PhoneNumber;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\UploadedFile;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class ApplyRequest extends FormRequest
{
    private const MIMES = 'application/pdf,image/jpeg,image/png';

    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        // Honeypot: bots fill the hidden field. Pretend success and store nothing.
        if (filled($this->input('website'))) {
            $job = $this->route('jobPosting');
            throw new HttpResponseException(
                redirect(LocalizedRoute::url('jobs.thanks', [$job]))->with('applied', true)
            );
        }
    }

    public function rules(): array
    {
        $rules = [
            'full_name' => ['required', 'string', 'max:120'],
            'phone' => ['required', 'string', 'max:30', function (string $attribute, mixed $value, \Closure $fail) {
                if (PhoneNumber::normalize((string) $value) === null) {
                    $fail(__('public.apply.phone_invalid'));
                }
            }],
            'email' => ['nullable', 'email', 'max:190'],
            'city' => ['required', 'string', 'max:100'],
            'area' => ['nullable', 'string', 'max:100'],
            'date_of_birth' => ['nullable', 'date',
                'before_or_equal:'.now()->subYears(15)->toDateString(),
                'after_or_equal:'.now()->subYears(70)->toDateString()],
            'consent' => ['accepted'],
            'cv' => ['required', 'array', 'min:1', 'max:'.(int) config('careergate.cv.max_images')],
            'cv.*' => ['file', 'mimetypes:'.self::MIMES, 'max:'.(int) config('careergate.cv.max_kb')],
        ];

        foreach ($this->questions() as $q) {
            $key = 'answers.'.$q['id'];
            $base = ! empty($q['required']) ? ['required'] : ['nullable'];
            $rules[$key] = match ($q['type'] ?? 'text') {
                'yes_no' => [...$base, 'in:yes,no'],
                'choice' => [...$base, Rule::in($this->choiceValues($q))],
                default => [...$base, 'string', 'max:500'],
            };
        }

        return $rules;
    }

    public function messages(): array
    {
        return [
            'cv.required' => __('public.apply.cv_required'),
            'cv.min' => __('public.apply.cv_required'),
            'cv.max' => __('public.apply.cv_too_many'),
            'cv.*.mimetypes' => __('public.apply.cv_type'),
            'cv.*.file' => __('public.apply.cv_type'),
            'cv.*.max' => __('public.cv_too_large'),
            'cv.*.uploaded' => __('public.cv_too_large'),
            'date_of_birth.before_or_equal' => __('public.apply.dob_range'),
            'date_of_birth.after_or_equal' => __('public.apply.dob_range'),
        ];
    }

    public function attributes(): array
    {
        $attributes = [];
        foreach ($this->questions() as $q) {
            $attributes['answers.'.$q['id']] = $q['label_'.app()->getLocale()] ?? $q['label_en'] ?? $q['id'];
        }

        return $attributes;
    }

    public function after(): array
    {
        return [function (Validator $validator) {
            if ($validator->errors()->has('cv') || $validator->errors()->has('cv.*')) {
                return;
            }
            /** @var array<int, UploadedFile> $files */
            $files = array_values((array) $this->file('cv', []));
            if ($files === []) {
                return;
            }

            $isPdf = fn (UploadedFile $f) => $f->getMimeType() === 'application/pdf';
            $pdfs = count(array_filter($files, $isPdf));

            if ($pdfs > 0 && (count($files) !== 1)) {
                $validator->errors()->add('cv', __('public.apply.cv_mixed'));

                return;
            }

            foreach ($files as $i => $file) {
                if ($isPdf($file)) {
                    continue;
                }
                $info = @getimagesize($file->getRealPath());
                $type = $info[2] ?? null;
                if ($info === false || ! in_array($type, [IMAGETYPE_JPEG, IMAGETYPE_PNG], true)) {
                    $validator->errors()->add("cv.$i", __('public.apply.cv_unreadable'));
                }
            }
        }];
    }

    /** @return array<int, array<string, mixed>> */
    private function questions(): array
    {
        $job = $this->route('jobPosting');

        return $job instanceof JobPosting
            ? collect($job->questions ?? [])->filter(fn ($q) => ! empty($q['id']))->values()->all()
            : [];
    }

    /** @return array<int, string> */
    private function choiceValues(array $q): array
    {
        $en = $q['options_en'] ?? [];
        $ar = $q['options_ar'] ?? [];
        $values = [];
        for ($i = 0, $n = max(count($en), count($ar)); $i < $n; $i++) {
            $values[] = filled($en[$i] ?? null) ? $en[$i] : ($ar[$i] ?? null);
        }

        return array_values(array_filter($values, 'filled'));
    }
}
