<?php

namespace Tests\Unit;

use App\Support\LikePattern;
use PHPUnit\Framework\TestCase;

class LikePatternTest extends TestCase
{
    public function test_escapes_wildcards_and_escape_char_without_backslash(): void
    {
        $this->assertSame('%100!% a!_b !!x%', LikePattern::contains('100% A_B !X'));
        $this->assertSame('%ab%', LikePattern::contains('AB'));
        $this->assertSame("ESCAPE '!'", "ESCAPE '".LikePattern::ESCAPE."'");
    }
}
