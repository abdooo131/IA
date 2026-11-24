<?php

namespace App\Models;

use App\Enums\Stage;
use Database\Factories\ApplicationFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Application extends Model
{
    /** @use HasFactory<ApplicationFactory> */
    use HasFactory;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'stage' => Stage::class,
            'answers' => 'array',
        ];
    }

    public function jobPosting(): BelongsTo
    {
        return $this->belongsTo(JobPosting::class);
    }

    public function applicant(): BelongsTo
    {
        return $this->belongsTo(Applicant::class);
    }

    public function addedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'added_by');
    }

    /** Current (not replaced) CV files, in order. */
    public function cvFiles(): HasMany
    {
        return $this->hasMany(CvFile::class)->whereNull('replaced_at')->orderBy('position');
    }

    public function allCvFiles(): HasMany
    {
        return $this->hasMany(CvFile::class)->orderBy('position');
    }

    public function stageChanges(): HasMany
    {
        return $this->hasMany(StageChange::class)->orderBy('id');
    }

    public function comments(): HasMany
    {
        return $this->hasMany(Comment::class)->orderBy('id');
    }
}
