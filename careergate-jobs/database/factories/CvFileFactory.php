<?php

namespace Database\Factories;

use App\Models\Application;
use App\Models\CvFile;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/** @extends Factory<CvFile> */
class CvFileFactory extends Factory
{
    public function definition(): array
    {
        return [
            'application_id' => Application::factory(),
            'original_name' => 'cv.pdf',
            'path' => 'cvs/'.Str::uuid().'.pdf',
            'mime' => 'application/pdf',
            'size' => 1024,
            'position' => 0,
            'replaced_at' => null,
            'replaced_by' => null,
        ];
    }

    /** A PDF whose (fake) file really exists on the local disk. */
    public function pdf(): static
    {
        return $this->state(function () {
            $path = 'cvs/'.Str::uuid().'.pdf';
            $content = "%PDF-1.4\n%fake cv\n%%EOF\n";
            Storage::disk('local')->put($path, $content);

            return ['original_name' => 'cv.pdf', 'path' => $path, 'mime' => 'application/pdf', 'size' => strlen($content)];
        });
    }
}
