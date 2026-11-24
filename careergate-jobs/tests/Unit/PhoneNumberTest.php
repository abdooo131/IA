<?php

namespace Tests\Unit;

use App\Support\PhoneNumber;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class PhoneNumberTest extends TestCase
{
    #[DataProvider('egyptianNumbers')]
    public function test_normalizes_egyptian_mobile(string $in): void
    {
        $this->assertSame('+201012345678', PhoneNumber::normalize($in));
    }

    public static function egyptianNumbers(): array
    {
        return [['01012345678'], ['+201012345678'], ['00201012345678'], ['201012345678'],
            ['+20 101 234 5678'], ['010-1234-5678'], ['٠١٠١٢٣٤٥٦٧٨'], ['۰۱۰۱۲۳۴۵۶۷۸']];
    }

    public function test_rejects_non_mobile_numbers(): void
    {
        foreach (['0223456789', '0131234567', '12345', '', '+1 555 123 4567'] as $bad) {
            $this->assertNull(PhoneNumber::normalize($bad), $bad);
        }
    }

    public function test_formats_local_and_whatsapp(): void
    {
        $this->assertSame('01012345678', PhoneNumber::toLocal('+201012345678'));
        $this->assertSame('201012345678', PhoneNumber::toWhatsApp('+201012345678'));
    }
}
