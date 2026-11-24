<?php

namespace App\Models;

use App\Enums\EmploymentType;
use App\Enums\JobStatus;
use Database\Factories\JobPostingFactory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Str;

class JobPosting extends Model
{
    /** @use HasFactory<JobPostingFactory> */
    use HasFactory;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'employment_type' => EmploymentType::class,
            'status' => JobStatus::class,
            'questions' => 'array',
            'show_client_name' => 'boolean',
            'closes_on' => 'date',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (JobPosting $job) {
            if (empty($job->slug)) {
                $base = Str::slug((string) $job->title_en) ?: 'job';
                do {
                    $slug = $base.'-'.Str::lower(Str::random(6));
                } while (static::where('slug', $slug)->exists());
                $job->slug = $slug;
            }
        });
    }

    public function clientCompany(): BelongsTo
    {
        return $this->belongsTo(ClientCompany::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function applications(): HasMany
    {
        return $this->hasMany(Application::class);
    }

    public function getRouteKeyName(): string
    {
        return 'slug';
    }

    /** Value of `{field}_{locale}`, falling back to the other language when empty. */
    public function localized(string $field, ?string $locale = null): ?string
    {
        $locale ??= app()->getLocale();
        $other = $locale === 'ar' ? 'en' : 'ar';

        $value = $this->{$field.'_'.$locale};

        return filled($value) ? $value : (filled($this->{$field.'_'.$other}) ? $this->{$field.'_'.$other} : null);
    }

    public function isAcceptingApplications(): bool
    {
        if ($this->status !== JobStatus::Open) {
            return false;
        }

        return $this->closes_on === null
            || $this->closes_on->toDateString() >= now('Africa/Cairo')->toDateString();
    }

    public function scopeOpen(Builder $query): Builder
    {
        return $query->where('status', JobStatus::Open->value);
    }

    public function publicUrl(string $locale = 'en'): string
    {
        return url(($locale === 'ar' ? '/ar' : '').'/jobs/'.$this->slug);
    }
}
