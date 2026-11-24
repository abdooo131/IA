<?php

namespace App\Http\Controllers\Admin;

use App\Enums\JobStatus;
use App\Enums\Stage;
use App\Http\Controllers\Controller;
use App\Http\Requests\JobPostingRequest;
use App\Models\ClientCompany;
use App\Models\JobPosting;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class JobPostingController extends Controller
{
    public function index(Request $request)
    {
        $status = JobStatus::tryFrom((string) $request->query('status'));

        $jobs = JobPosting::with('clientCompany')
            ->withCount('applications')
            ->when($status, fn ($q) => $q->where('status', $status->value))
            ->orderByDesc('created_at')->orderByDesc('id')
            ->paginate(25)->withQueryString();

        return view('admin.jobs.index', ['jobs' => $jobs, 'status' => $status]);
    }

    public function create()
    {
        return view('admin.jobs.form', [
            'job' => new JobPosting(['status' => JobStatus::Draft, 'employment_type' => 'full_time', 'questions' => []]),
            'clients' => ClientCompany::orderBy('name')->get(['id', 'name']),
        ]);
    }

    public function store(JobPostingRequest $request): RedirectResponse
    {
        $job = new JobPosting($request->jobData());
        $job->created_by = $request->user()->id;
        $job->save();

        return redirect()->route('admin.jobs.show', $job)->with('status', __('admin.jobs.saved'));
    }

    public function show(JobPosting $jobPosting)
    {
        $jobPosting->load('clientCompany');

        $counts = $jobPosting->applications()->selectRaw('stage, count(*) as total')->groupBy('stage')->pluck('total', 'stage');
        $stageCounts = [];
        foreach (Stage::cases() as $stage) {
            $stageCounts[$stage->value] = (int) ($counts[$stage->value] ?? 0);
        }

        return view('admin.jobs.show', ['job' => $jobPosting, 'stageCounts' => $stageCounts]);
    }

    public function edit(JobPosting $jobPosting)
    {
        return view('admin.jobs.form', [
            'job' => $jobPosting,
            'clients' => ClientCompany::orderBy('name')->get(['id', 'name']),
        ]);
    }

    public function update(JobPostingRequest $request, JobPosting $jobPosting): RedirectResponse
    {
        $jobPosting->update($request->jobData());

        return redirect()->route('admin.jobs.show', $jobPosting)->with('status', __('admin.jobs.saved'));
    }

    public function status(Request $request, JobPosting $jobPosting): RedirectResponse
    {
        $data = $request->validate(['status' => ['required', Rule::enum(JobStatus::class)]]);

        if ($data['status'] === JobStatus::Open->value
            && $jobPosting->closes_on !== null
            && $jobPosting->closes_on->toDateString() < now('Africa/Cairo')->toDateString()) {
            return back()->withErrors(['status' => __('admin.jobs.open_needs_future_date')]);
        }

        $jobPosting->update(['status' => $data['status']]);

        return back()->with('status', __('admin.jobs.status_updated'));
    }

    public function duplicate(Request $request, JobPosting $jobPosting): RedirectResponse
    {
        $copy = $jobPosting->replicate(['slug', 'status', 'closes_on', 'created_by']);
        $copy->slug = null;
        $copy->status = JobStatus::Draft;
        $copy->closes_on = null;
        $copy->created_by = $request->user()->id;
        $copy->save();

        return redirect()->route('admin.jobs.edit', $copy)->with('status', __('admin.jobs.duplicated'));
    }

    public function destroy(JobPosting $jobPosting): RedirectResponse
    {
        if ($jobPosting->applications()->exists()) {
            return back()->withErrors(['job' => __('admin.jobs.has_applications')]);
        }

        $jobPosting->delete();

        return redirect()->route('admin.jobs.index')->with('status', __('admin.jobs.deleted'));
    }
}
