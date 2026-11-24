<?php

namespace App\Http\Controllers\Admin;

use App\Enums\Stage;
use App\Http\Controllers\Controller;
use App\Models\Applicant;
use App\Models\JobPosting;
use App\Services\TalentPoolQuery;
use Illuminate\Http\Request;

class TalentPoolController extends Controller
{
    public function index(Request $request)
    {
        $request->validate([
            'q' => ['nullable', 'string', 'max:100'],
            'city' => ['nullable', 'string', 'max:100'],
            'area' => ['nullable', 'string', 'max:100'],
            'age_min' => ['nullable', 'integer', 'min:0', 'max:120'],
            'age_max' => ['nullable', 'integer', 'min:0', 'max:120'],
            'best_stage' => ['nullable', 'in:'.implode(',', array_map(fn (Stage $s) => $s->value, Stage::cases()))],
            'job_id' => ['nullable', 'integer'],
            'applied_from' => ['nullable', 'date_format:Y-m-d'],
            'applied_to' => ['nullable', 'date_format:Y-m-d'],
        ]);

        $filters = $request->only(['q', 'city', 'area', 'age_min', 'age_max', 'best_stage', 'job_id', 'applied_from', 'applied_to']);

        $applicants = TalentPoolQuery::apply(Applicant::query(), $filters)
            ->with(['applications' => fn ($q) => $q->select('id', 'applicant_id', 'job_posting_id', 'created_at')->orderByDesc('created_at')->orderByDesc('id'),
                'applications.jobPosting:id,title_en,title_ar'])
            ->paginate(50)
            ->withQueryString();

        $best = TalentPoolQuery::bestStages($applicants->pluck('id')->all());

        $openJobs = JobPosting::open()->orderBy('title_en')->get()
            ->filter(fn (JobPosting $j) => $j->isAcceptingApplications())->values();

        return view('admin.talent-pool.index', [
            'applicants' => $applicants,
            'best' => $best,
            'openJobs' => $openJobs,
            'allJobs' => JobPosting::orderBy('title_en')->get(['id', 'title_en', 'title_ar']),
            'cities' => Applicant::whereNotNull('city')->distinct()->orderBy('city')->pluck('city'),
            'filters' => array_merge(array_fill_keys(['q', 'city', 'area', 'age_min', 'age_max', 'best_stage', 'job_id', 'applied_from', 'applied_to'], ''), array_map(fn ($v) => (string) $v, $filters)),
        ]);
    }
}
