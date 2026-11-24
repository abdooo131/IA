<?php

namespace App\Http\Controllers\Public;

use App\Enums\JobStatus;
use App\Exceptions\AlreadyAppliedException;
use App\Exceptions\JobClosedException;
use App\Http\Controllers\Controller;
use App\Http\Requests\ApplyRequest;
use App\Models\JobPosting;
use App\Services\ApplyService;
use App\Support\LocalizedRoute;
use App\Support\PhoneNumber;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\View\View;

class ApplyController extends Controller
{
    private const PHONE_MAX_PER_HOUR = 3;

    public function store(ApplyRequest $request, JobPosting $jobPosting, ApplyService $service): RedirectResponse
    {
        $data = $request->validated();
        $phone = PhoneNumber::normalize($data['phone']);
        $limitKey = 'apply-phone:'.$phone;

        if (RateLimiter::tooManyAttempts($limitKey, self::PHONE_MAX_PER_HOUR)) {
            return back()->withInput($request->except('cv'))
                ->withErrors(['phone' => __('public.apply.too_many_applications')]);
        }

        try {
            $service->apply($jobPosting, $data, array_values((array) $request->file('cv', [])));
        } catch (JobClosedException) {
            return redirect(LocalizedRoute::url('jobs.show', [$jobPosting]))
                ->with('job_closed', true);
        } catch (AlreadyAppliedException) {
            return redirect(LocalizedRoute::url('jobs.thanks', [$jobPosting]))
                ->with('already_applied', true);
        }

        RateLimiter::hit($limitKey, 3600);

        return redirect(LocalizedRoute::url('jobs.thanks', [$jobPosting]))->with('applied', true);
    }

    public function thanks(JobPosting $jobPosting): View|RedirectResponse
    {
        abort_if($jobPosting->status === JobStatus::Draft, 404);

        $applied = session('applied') === true;
        $already = session('already_applied') === true;

        if (! $applied && ! $already) {
            return redirect(LocalizedRoute::url('jobs.show', [$jobPosting]));
        }

        return view('public.jobs.thanks', ['job' => $jobPosting, 'already' => $already && ! $applied]);
    }
}
