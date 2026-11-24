<?php

namespace App\Http\Requests;

use App\Enums\EmploymentType;
use App\Enums\JobStatus;
use App\Enums\QuestionType;
use App\Models\JobPosting;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class JobPostingRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    private function job(): ?JobPosting
    {
        $job = $this->route('jobPosting');

        return $job instanceof JobPosting ? $job : null;
    }

    public function rules(): array
    {
        $today = now('Africa/Cairo')->toDateString();
        $existing = $this->job()?->closes_on?->toDateString();
        $closesOn = ['nullable', 'date'];
        // On edit an unchanged (already past) date is tolerated; any new date must be today or later.
        if ($this->input('closes_on') !== $existing) {
            $closesOn[] = 'after_or_equal:'.$today;
        }

        return [
            'client_company_id' => ['required', 'integer', 'exists:client_companies,id'],
            'title_en' => ['required_without:title_ar', 'nullable', 'string', 'max:255'],
            'title_ar' => ['nullable', 'string', 'max:255'],
            'city' => ['required', 'string', 'max:120'],
            'area' => ['nullable', 'string', 'max:120'],
            'employment_type' => ['required', Rule::enum(EmploymentType::class)],
            'salary_text' => ['nullable', 'string', 'max:120'],
            'responsibilities_en' => ['nullable', 'string', 'max:10000'],
            'responsibilities_ar' => ['nullable', 'string', 'max:10000'],
            'requirements_en' => ['nullable', 'string', 'max:10000'],
            'requirements_ar' => ['nullable', 'string', 'max:10000'],
            'show_client_name' => ['nullable', 'boolean'],
            'status' => ['required', Rule::enum(JobStatus::class)],
            'closes_on' => $closesOn,
            'questions' => ['nullable', 'array', 'max:30'],
            'questions.*.id' => ['nullable', 'string', 'max:20'],
            'questions.*.type' => ['required', Rule::enum(QuestionType::class)],
            'questions.*.label_en' => ['nullable', 'string', 'max:255', 'required_without:questions.*.label_ar'],
            'questions.*.label_ar' => ['nullable', 'string', 'max:255'],
            'questions.*.options_en' => ['nullable', 'array', 'max:20'],
            'questions.*.options_en.*' => ['nullable', 'string', 'max:120'],
            'questions.*.options_ar' => ['nullable', 'array', 'max:20'],
            'questions.*.options_ar.*' => ['nullable', 'string', 'max:120'],
            'questions.*.required' => ['nullable', 'boolean'],
        ];
    }

    public function after(): array
    {
        return [function (Validator $validator) {
            foreach ((array) $this->input('questions', []) as $i => $q) {
                if (($q['type'] ?? null) !== QuestionType::Choice->value) {
                    continue;
                }
                foreach (['en', 'ar'] as $lang) {
                    $hasLabel = filled($q['label_'.$lang] ?? null);
                    $hasOptions = $this->cleanOptions($q['options_'.$lang] ?? []) !== [];
                    if (($lang === 'en' ? ! $hasOptions && ($hasLabel || ! filled($q['label_ar'] ?? null)) : $hasLabel && ! $hasOptions)) {
                        $validator->errors()->add("questions.$i.options_$lang", __('admin.jobs.options_required'));
                    }
                }
            }

            if ($this->input('status') === JobStatus::Open->value && filled($this->input('closes_on'))
                && $this->input('closes_on') < now('Africa/Cairo')->toDateString()) {
                $validator->errors()->add('closes_on', __('admin.jobs.open_needs_future_date'));
            }
        }];
    }

    /** @return array<int, string> */
    private function cleanOptions(mixed $options): array
    {
        return array_values(array_filter(array_map(fn ($o) => trim((string) $o), (array) $options), fn ($o) => $o !== ''));
    }

    /** Validated job attributes with the question list normalised and ids assigned. */
    public function jobData(): array
    {
        $data = collect($this->validated())->except('questions')->all();
        $data['show_client_name'] = $this->boolean('show_client_name');

        $used = [];
        $questions = [];
        foreach ((array) $this->input('questions', []) as $q) {
            $id = (string) ($q['id'] ?? '');
            if (! preg_match('/^q\w{6}$/', $id) || isset($used[$id])) {
                do {
                    $id = 'q'.Str::lower(Str::random(6));
                } while (isset($used[$id]));
            }
            $used[$id] = true;

            $isChoice = $q['type'] === QuestionType::Choice->value;
            $questions[] = [
                'id' => $id,
                'type' => $q['type'],
                'label_en' => trim((string) ($q['label_en'] ?? '')),
                'label_ar' => trim((string) ($q['label_ar'] ?? '')),
                'options_en' => $isChoice ? $this->cleanOptions($q['options_en'] ?? []) : [],
                'options_ar' => $isChoice ? $this->cleanOptions($q['options_ar'] ?? []) : [],
                'required' => filter_var($q['required'] ?? false, FILTER_VALIDATE_BOOLEAN),
            ];
        }
        $data['questions'] = $questions;

        return $data;
    }
}
