<?php

namespace App\Support;

/**
 * The upload size we can honestly promise: the smaller of our own limit
 * (config careergate.cv.max_kb) and what the host's PHP actually accepts.
 */
class UploadLimits
{
    /** @var array{0: string|null, 1: string|null}|null Test override: [upload_max_filesize, post_max_size]. */
    private static ?array $fake = null;

    /** Override the PHP ini values (tests). Pass null, null to go back to the real ones. */
    public static function fake(?string $uploadMax, ?string $postMax): void
    {
        self::$fake = $uploadMax === null && $postMax === null ? null : [$uploadMax, $postMax];
    }

    /** Convert php.ini shorthand ("2M", "512K", "1G", "8") to bytes. -1 stays -1. */
    public static function toBytes(string|int|false|null $value): int
    {
        $value = trim((string) $value);
        if ($value === '') {
            return 0;
        }
        $number = (int) $value;
        return match (strtoupper(substr($value, -1))) {
            'G' => $number * 1024 ** 3,
            'M' => $number * 1024 ** 2,
            'K' => $number * 1024,
            default => $number,
        };
    }

    /** Effective per file limit in KB, never above what PHP will accept. */
    public static function maxFileKb(?int $configKb = null, ?string $uploadMax = null, ?string $postMax = null): int
    {
        $configKb ??= (int) config('careergate.cv.max_kb');
        $uploadMax ??= self::$fake[0] ?? ini_get('upload_max_filesize');
        $postMax ??= self::$fake[1] ?? ini_get('post_max_size');

        $limits = [$configKb];
        foreach ([$uploadMax, $postMax] as $ini) {
            $bytes = self::toBytes($ini);
            if ($bytes > 0) { // 0 and -1 mean "no limit"
                $limits[] = intdiv($bytes, 1024);
            }
        }

        return min($limits);
    }

    /** The whole request limit in KB (post_max_size), or null when unlimited. */
    public static function maxRequestKb(?string $postMax = null): ?int
    {
        $bytes = self::toBytes($postMax ?? self::$fake[1] ?? ini_get('post_max_size'));

        return $bytes > 0 ? intdiv($bytes, 1024) : null;
    }

    /** KB to MB for display: 10240 gives 10, 1536 gives 1.5. */
    public static function toMb(int $kb): int|float
    {
        $mb = round($kb / 1024, 1);

        return $mb == (int) $mb ? (int) $mb : $mb;
    }

    /** The per file limit in MB, for messages. */
    public static function maxFileMb(): int|float
    {
        return self::toMb(self::maxFileKb());
    }
}
