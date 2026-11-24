<?php

namespace App\Http\Controllers\Admin;

use App\Enums\Stage;
use App\Http\Controllers\Controller;
use App\Models\Application;
use App\Models\JobPosting;
use App\Services\StageService;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class ApplicationStageController extends Controller
{
    public function update(Request $request, Application $application, StageService $stages): RedirectResponse
    {
        $data = $request->validate(['stage' => ['required', Rule::enum(Stage::class)]]);
        $stages->move($application, Stage::from($data['stage']), $request->user());

        return back()->with('status', __('admin.applications.stage_updated'));
    }

    public function bulk(Request $request, JobPosting $jobPosting, StageService $stages): RedirectResponse
    {
        $data = $request->validate([
            'ids' => ['required', 'array', 'min:1'],
            'ids.*' => ['integer'],
            'stage' => ['required', Rule::enum(Stage::class)],
        ]);

        $ids = array_values(array_unique(array_map('intval', $data['ids'])));
        $applications = Application::where('job_posting_id', $jobPosting->id)->whereIn('id', $ids)->get();
        if ($applications->count() !== count($ids)) {
            throw ValidationException::withMessages(['ids' => __('admin.applications.bulk_invalid_ids')]);
        }

        $to = Stage::from($data['stage']);
        $changed = 0;
        foreach ($applications as $application) {
            if ($stages->move($application, $to, $request->user())) {
                $changed++;
            }
        }

        return back()->with('status', __('admin.applications.bulk_done', ['count' => $changed, 'stage' => $to->label()]));
    }
}
