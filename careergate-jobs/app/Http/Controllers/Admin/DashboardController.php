<?php

namespace App\Http\Controllers\Admin;

use App\Enums\Stage;
use App\Http\Controllers\Controller;
use App\Models\Application;
use App\Models\JobPosting;
use Illuminate\Support\Facades\DB;
use Illuminate\View\View;

class DashboardController extends Controller
{
    public function __invoke(): View
    {
        $stages = Stage::ordered();
        $jobs = JobPosting::query()->open()->with('clientCompany')->latest('id')->get();

        $counts = $jobs->isEmpty() ? collect() : Application::query()
            ->whereIn('job_posting_id', $jobs->pluck('id'))
            ->select('job_posting_id', 'stage', DB::raw('count(*) as total'))
            ->groupBy('job_posting_id', 'stage')
            ->get()
            ->groupBy('job_posting_id');

        $rows = $jobs->map(function (JobPosting $job) use ($counts, $stages) {
            $byStage = ($counts[$job->id] ?? collect())->mapWithKeys(
                fn ($r) => [($r->stage instanceof Stage ? $r->stage->value : $r->stage) => (int) $r->total]
            );
            $perStage = [];
            foreach ($stages as $s) {
                $perStage[$s->value] = $byStage[$s->value] ?? 0;
            }

            return ['job' => $job, 'counts' => $perStage, 'total' => array_sum($perStage)];
        });

        $newest = Application::query()->with(['applicant', 'jobPosting'])->latest('created_at')->latest('id')->limit(10)->get();

        return view('admin.dashboard', [
            'stages' => $stages,
            'rows' => $rows,
            'newest' => $newest,
            'openJobs' => $jobs->count(),
            'recent' => Application::query()->where('created_at', '>=', now()->subDays(7))->count(),
            'shortlisted' => Application::query()->where('stage', Stage::Shortlisted->value)->count(),
        ]);
    }
}
