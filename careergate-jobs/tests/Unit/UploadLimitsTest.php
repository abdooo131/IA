<?php

namespace Tests\Unit;

use App\Support\UploadLimits;
use PHPUnit\Framework\TestCase;

class UploadLimitsTest extends TestCase
{
    public function test_parses_ini_shorthand(): void
    {
        $this->assertSame(2097152, UploadLimits::toBytes('2M'));
        $this->assertSame(1024, UploadLimits::toBytes('1K'));
        $this->assertSame(1073741824, UploadLimits::toBytes('1G'));
        $this->assertSame(500, UploadLimits::toBytes('500'));
        $this->assertSame(0, UploadLimits::toBytes('0'));
        $this->assertSame(-1, UploadLimits::toBytes('-1'));
    }

    public function test_config_wins_when_host_allows_more(): void
    {
        $this->assertSame(10240, UploadLimits::maxFileKb(10240, '12M', '50M'));
    }

    public function test_host_upload_limit_wins_when_lower(): void
    {
        $this->assertSame(2048, UploadLimits::maxFileKb(10240, '2M', '50M'));
    }

    public function test_post_max_size_also_caps_a_single_file(): void
    {
        $this->assertSame(8192, UploadLimits::maxFileKb(10240, '12M', '8M'));
    }

    public function test_zero_or_unlimited_means_no_host_cap(): void
    {
        $this->assertSame(10240, UploadLimits::maxFileKb(10240, '0', '-1'));
    }

    public function test_request_limit_and_megabytes(): void
    {
        $this->assertSame(51200, UploadLimits::maxRequestKb('50M'));
        $this->assertNull(UploadLimits::maxRequestKb('0'));
        $this->assertSame(10, UploadLimits::toMb(10240));
        $this->assertSame(1.5, UploadLimits::toMb(1536));
    }
}
