<?php

namespace App\Http\Requests;

use App\Support\CvRules;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

class ReplaceCvRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return CvRules::rules();
    }

    public function messages(): array
    {
        return CvRules::messages();
    }

    public function after(): array
    {
        return [function (Validator $validator) {
            CvRules::check($validator, array_values((array) $this->file('cv', [])));
        }];
    }
}
