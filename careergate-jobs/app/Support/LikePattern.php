<?php

namespace App\Support;

class LikePattern
{
    public const ESCAPE = '!';

    /** "Contains" LIKE pattern, lowercased, with %, _ and the escape char escaped (portable: no backslash). */
    public static function contains(string $term): string
    {
        return '%'.str_replace(['!', '%', '_'], ['!!', '!%', '!_'], mb_strtolower($term)).'%';
    }
}
