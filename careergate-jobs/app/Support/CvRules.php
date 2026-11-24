<?php

namespace App\Support;

use Illuminate\Http\UploadedFile;
use Illuminate\Validation\Validator;

/** Shared CV upload validation (apply form and team CV replacement). */
class CvRules
{
    public const MIMES = 'application/pdf,image/jpeg,image/png';

    /** @return array<string, array<int, string>> */
    public static function rules(): array
    {
        return [
            'cv' => ['required', 'array', 'min:1', 'max:'.(int) config('careergate.cv.max_images')],
            'cv.*' => ['file', 'mimetypes:'.self::MIMES, 'max:'.UploadLimits::maxFileKb()],
        ];
    }

    /** @return array<string, string> */
    public static function messages(): array
    {
        return [
            'cv.required' => __('public.apply.cv_required'),
            'cv.min' => __('public.apply.cv_required'),
            'cv.max' => __('public.apply.cv_too_many'),
            'cv.*.mimetypes' => __('public.apply.cv_type'),
            'cv.*.file' => __('public.apply.cv_type'),
            'cv.*.max' => __('public.cv_too_large', ['mb' => UploadLimits::maxFileMb()]),
            'cv.*.uploaded' => __('public.cv_too_large', ['mb' => UploadLimits::maxFileMb()]),
        ];
    }

    /**
     * After-validation: a PDF must be alone; images must really decode as JPEG/PNG.
     *
     * @param  array<int, UploadedFile>  $files
     */
    public static function check(Validator $validator, array $files): void
    {
        if ($validator->errors()->has('cv') || $validator->errors()->has('cv.*')) {
            return;
        }
        $files = array_values($files);
        if ($files === []) {
            return;
        }

        $isPdf = fn (UploadedFile $f) => $f->getMimeType() === 'application/pdf';
        $pdfs = count(array_filter($files, $isPdf));

        if ($pdfs > 0 && count($files) !== 1) {
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
    }
}
