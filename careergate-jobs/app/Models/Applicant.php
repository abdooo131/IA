<?php

namespace App\Models;

use App\Enums\Stage;
use Database\Factories\ApplicantFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Applicant extends Model
{
    /** @use HasFactory<ApplicantFactory> */
    use HasFactory;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'date_of_birth' => 'date',
            'consented_at' => 'datetime',
        ];
    }

    public function applications(): HasMany
    {
        return $this->hasMany(Application::class);
    }

    public function latestApplication(): HasOne
    {
        return $this->hasOne(Application::class)->latestOfMany();
    }

    public function age(): ?int
    {
        return $this->date_of_birth?->age;
    }

    /** True if any application is currently Hired or ever moved to Hired. */
    public function wasEverHired(): bool
    {
        return $this->applications()->where('stage', Stage::Hired->value)->exists()
            || StageChange::where('to_stage', Stage::Hired->value)
                ->whereIn('application_id', $this->applications()->select('id'))
                ->exists();
    }
}
