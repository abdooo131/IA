<?php

namespace App\Enums;

enum QuestionType: string
{
    case Text = 'text';
    case YesNo = 'yes_no';
    case Choice = 'choice';
}
