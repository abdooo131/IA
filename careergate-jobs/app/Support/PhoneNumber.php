<?php

namespace App\Support;

class PhoneNumber
{
    /**
     * Normalize an Egyptian mobile number to +20 followed by 10 digits, or null.
     */
    public static function normalize(string $input): ?string
    {
        $digits = strtr($input, [
            '٠' => '0', '١' => '1', '٢' => '2', '٣' => '3', '٤' => '4',
            '٥' => '5', '٦' => '6', '٧' => '7', '٨' => '8', '٩' => '9',
            '۰' => '0', '۱' => '1', '۲' => '2', '۳' => '3', '۴' => '4',
            '۵' => '5', '۶' => '6', '۷' => '7', '۸' => '8', '۹' => '9',
        ]);
        $digits = preg_replace('/\D+/', '', $digits);

        foreach (['0020', '20', '0'] as $prefix) {
            if (str_starts_with($digits, $prefix)) {
                $digits = substr($digits, strlen($prefix));
                break;
            }
        }

        return preg_match('/^1[0125]\d{8}$/', $digits) ? '+20'.$digits : null;
    }
}
