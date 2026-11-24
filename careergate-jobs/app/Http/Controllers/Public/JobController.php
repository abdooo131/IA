<?php

namespace App\Http\Controllers\Public;

use App\Enums\JobStatus;
use App\Http\Controllers\Controller;
use App\Models\JobPosting;
use Illuminate\Http\Request;
use Illuminate\View\View;

class JobController extends Controller
{
    public function index(Request $request): View
    {
        $city = trim((string) $request->query('city', ''));
        $q = trim((string) $request->query('q', ''));

        $jobs = JobPosting::open()
            ->when($city !== '', fn ($query) => $query->where('city', $city))
            ->when($q !== '', function ($query) use ($q) {
                $like = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], mb_strtolower($q)).'%';
                $query->where(function ($w) use ($like) {
                    $w->whereRaw("LOWER(title_en) LIKE ? ESCAPE '\\'", [$like])
                        ->orWhereRaw("LOWER(title_ar) LIKE ? ESCAPE '\\'", [$like]);
                });
            })
            ->latest('created_at')->latest('id')
            ->paginate(20)
            ->withQueryString();

        $cities = JobPosting::open()->whereNotNull('city')->where('city', '!=', '')
            ->distinct()->orderBy('city')->pluck('city');

        return view('public.jobs.index', compact('jobs', 'cities', 'city', 'q'));
    }

    public function show(JobPosting $jobPosting): View
    {
        abort_if($jobPosting->status === JobStatus::Draft, 404);

        return view('public.jobs.show', [
            'job' => $jobPosting->load('clientCompany'),
            'accepting' => $jobPosting->isAcceptingApplications(),
        ]);
    }
}
