<?php

namespace App\Services;

use App\Enums\Stage;
use App\Models\Applicant;
use App\Models\Application;
use App\Models\StageChange;
use App\Support\LikePattern;
use App\Support\PhoneNumber;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class TalentPoolQuery
{
    private const TZ = 'Africa/Cairo';

    /** Pipeline stages in order (everything except Rejected). @return array<int, Stage> */
    public static function pipeline(): array
    {
        return array_values(array_filter(Stage::ordered(), fn (Stage $s) => $s !== Stage::Rejected));
    }

    /**
     * @param  Builder<Applicant>  $applicants
     * @param  array<string, mixed>  $filters
     * @return Builder<Applicant>
     */
    public static function apply(Builder $applicants, array $filters): Builder
    {
        $f = fn (string $key): string => trim((string) ($filters[$key] ?? ''));
        $today = Carbon::now(self::TZ)->startOfDay();

        if (($q = $f('q')) !== '') {
            if ($phone = PhoneNumber::normalize($q)) {
                $applicants->where('phone', $phone);
            } else {
                $applicants->whereRaw("LOWER(full_name) LIKE ? ESCAPE '!'", [LikePattern::contains($q)]);
            }
        }
        if (($city = $f('city')) !== '') {
            $applicants->where('city', $city);
        }
        if (($area = $f('area')) !== '') {
            $applicants->whereRaw("LOWER(area) LIKE ? ESCAPE '!'", [LikePattern::contains($area)]);
        }
        if (($min = $f('age_min')) !== '' && ctype_digit($min)) {
            $applicants->whereDate('date_of_birth', '<=', $today->copy()->subYears((int) $min)->toDateString());
        }
        if (($max = $f('age_max')) !== '' && ctype_digit($max)) {
            $applicants->whereDate('date_of_birth', '>', $today->copy()->subYears((int) $max + 1)->toDateString());
        }

        if ($stage = Stage::tryFrom($f('best_stage'))) {
            if ($stage === Stage::Rejected) {
                $applicants->whereHas('applications', fn ($a) => $a->where('stage', Stage::Rejected->value));
            } elseif ($stage === Stage::New) {
                $applicants->whereHas('applications');
            } else {
                $reached = [];
                foreach (self::pipeline() as $s) {
                    if ($reached || $s === $stage) {
                        $reached[] = $s->value;
                    }
                }
                $applicants->whereHas('applications', fn ($a) => $a
                    ->where(fn ($w) => $w
                        ->whereIn('stage', $reached)
                        ->orWhereHas('stageChanges', fn ($c) => $c->whereIn('to_stage', $reached))));
            }
        }

        $jobId = $f('job_id');
        $from = $f('applied_from');
        $to = $f('applied_to');
        if ($jobId !== '' || $from !== '' || $to !== '') {
            $applicants->whereHas('applications', function ($a) use ($jobId, $from, $to) {
                if ($jobId !== '') {
                    $a->where('job_posting_id', (int) $jobId);
                }
                if ($from !== '') {
                    $a->where('created_at', '>=', Carbon::parse($from, self::TZ)->startOfDay());
                }
                if ($to !== '') {
                    $a->where('created_at', '<=', Carbon::parse($to, self::TZ)->endOfDay());
                }
            });
        }

        return $applicants
            ->orderByDesc(Application::query()
                ->select(DB::raw('max(applications.created_at)'))
                ->whereColumn('applications.applicant_id', 'applicants.id'))
            ->orderByDesc('applicants.id');
    }

    /**
     * Highest pipeline stage reached per applicant (current stages and history), in two queries.
     *
     * @param  array<int, int>  $applicantIds
     * @return array<int, Stage> applicant id => best stage
     */
    public static function bestStages(array $applicantIds): array
    {
        if ($applicantIds === []) {
            return [];
        }

        $rank = [];
        foreach (self::pipeline() as $i => $s) {
            $rank[$s->value] = $i;
        }

        $best = [];
        $note = function (int $applicantId, string $stage) use (&$best, $rank) {
            $r = $rank[$stage] ?? 0; // rejected (or unknown) still means it reached at least "new"
            $best[$applicantId] = max($best[$applicantId] ?? 0, $r);
        };

        Application::whereIn('applicant_id', $applicantIds)->get(['applicant_id', 'stage'])
            ->each(fn ($a) => $note($a->applicant_id, $a->stage->value));

        StageChange::query()
            ->join('applications', 'applications.id', '=', 'stage_changes.application_id')
            ->whereIn('applications.applicant_id', $applicantIds)
            ->select('applications.applicant_id', 'stage_changes.to_stage')
            ->distinct()
            ->get()
            ->each(fn ($c) => $note($c->applicant_id, $c->to_stage->value));

        $pipeline = self::pipeline();

        return array_map(fn (int $r) => $pipeline[$r], $best);
    }
}
