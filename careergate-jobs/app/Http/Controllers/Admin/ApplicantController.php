<?php

namespace App\Http\Controllers\Admin;

use App\Enums\Stage;
use App\Http\Controllers\Controller;
use App\Models\Applicant;
use App\Models\Application;
use App\Models\JobPosting;
use App\Models\StageChange;
use App\Services\CvStorage;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Throwable;

class ApplicantController extends Controller
{
    /** Add a past applicant to another open job without them applying again. */
    public function addToJob(Request $request, Applicant $applicant, CvStorage $storage)
    {
        $data = $request->validate(['job_posting_id' => ['required', 'integer']]);
        $fail = fn (string $key) => back()->withErrors(['job_posting_id' => __('admin.talent.errors.'.$key)]);

        $job = JobPosting::find($data['job_posting_id']);
        if (! $job || ! $job->isAcceptingApplications()) {
            return $fail('job_closed');
        }
        if ($applicant->applications()->where('job_posting_id', $job->id)->exists()) {
            return $fail('already_applied');
        }

        // Most recent application that still has current CV files.
        $source = $applicant->applications()
            ->whereHas('cvFiles')
            ->orderByDesc('created_at')->orderByDesc('id')
            ->first();
        if (! $source) {
            return $fail('no_cv');
        }

        try {
            $application = DB::transaction(function () use ($applicant, $job, $source, $request, $storage) {
                $application = Application::create([
                    'job_posting_id' => $job->id,
                    'applicant_id' => $applicant->id,
                    'stage' => Stage::New,
                    'answers' => [],
                    'source' => 'talent_pool',
                    'added_by' => $request->user()->id,
                ]);

                StageChange::create([
                    'application_id' => $application->id,
                    'from_stage' => null,
                    'to_stage' => Stage::New,
                    'user_id' => $request->user()->id,
                ]);

                // Files are copied last; on failure the copier removes what it wrote and the rows roll back.
                $storage->copyCurrent($source, $application);

                return $application;
            });
        } catch (UniqueConstraintViolationException) {
            return $fail('already_applied');
        } catch (Throwable $e) {
            report($e);

            return $fail('copy_failed');
        }

        return redirect()->route('admin.applications.show', $application)
            ->with('status', __('admin.talent.added', ['job' => $job->localized('title')]));
    }
}
