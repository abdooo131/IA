<?php

namespace App\Enums;

enum Stage: string
{
    case New = 'new';
    case Reviewed = 'reviewed';
    case Shortlisted = 'shortlisted';
    case SentToClient = 'sent_to_client';
    case Interview = 'interview';
    case Hired = 'hired';
    case Rejected = 'rejected';

    public function label(): string
    {
        return __('stages.'.$this->value);
    }

    /** @return array<int, Stage> */
    public static function ordered(): array
    {
        return self::cases();
    }
}
