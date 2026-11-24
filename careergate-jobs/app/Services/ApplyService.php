<?php

namespace App\Services;

use App\Enums\Stage;
use App\Exceptions\AlreadyAppliedException;
use App\Exceptions\JobClosedException;
use App\Models\Applicant;
use App\Models\Application;
use App\Models\JobPosting;
use App\Models\StageChange;
use App\Support\PhoneNumber;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Throwable;

class ApplyService
{
    public function __construct(private CvStorage $cvs) {}

    /**
     * @param  array<string, mixed>  $data  validated applicant fields (phone may be raw)
     * @param  array<int, UploadedFile>  $files
     *
     * @throws JobClosedException
     * @throws AlreadyAppliedException
     */
    public function apply(JobPosting $job, array $data, array $files): Application
    {
        if (! $job->isAcceptingApplications()) {
            throw new JobClosedException;
        }

        try {
            return $this->attempt($job, $data, $files);
        } catch (UniqueConstraintViolationException $e) {
            // A double submit raced on the applicants.phone unique index (MySQL). The failed
            // transaction is rolled back; retry once so the second request resolves to
            // "already applied" (or succeeds for a different job) instead of a 500.
            if (str_contains($e->getMessage(), 'applicants')) {
                return $this->attempt($job, $data, $files);
            }
            throw $e;
        }
    }

    /**
     * @param  array<string, mixed>  $data
     * @param  array<int, UploadedFile>  $files
     */
    private function attempt(JobPosting $job, array $data, array $files): Application
    {
        $phone = PhoneNumber::normalize((string) ($data['phone'] ?? ''))
            ?? throw new \InvalidArgumentException('Invalid phone number.');

        $storedPaths = [];

        try {
            return DB::transaction(function () use ($job, $data, $files, $phone, &$storedPaths) {
                $applicant = Applicant::firstOrCreate(['phone' => $phone], ['full_name' => $data['full_name']]);
                $applicant->fill(['full_name' => $data['full_name'], 'city' => $data['city'] ?? $applicant->city]);
                foreach (['email', 'area', 'date_of_birth'] as $optional) {
                    if (filled($data[$optional] ?? null)) {
                        $applicant->{$optional} = $data[$optional];
                    }
                }
                $applicant->consented_at = now();
                $applicant->save();

                if (Application::where('job_posting_id', $job->id)->where('applicant_id', $applicant->id)->exists()) {
                    throw new AlreadyAppliedException;
                }

                $application = Application::create([
                    'job_posting_id' => $job->id,
                    'applicant_id' => $applicant->id,
                    'stage' => Stage::New,
                    'answers' => $data['answers'] ?? [],
                    'source' => 'applied',
                ]);

                StageChange::create([
                    'application_id' => $application->id,
                    'from_stage' => null,
                    'to_stage' => Stage::New,
                    'user_id' => null,
                ]);

                // Files are written last, once every other write has succeeded.
                $stored = $this->cvs->store($application, $files);
                $storedPaths = $stored->pluck('path')->all();

                return $application;
            });
        } catch (UniqueConstraintViolationException $e) {
            $this->cvs->delete($storedPaths);
            // Only the applications (job, applicant) index means "already applied"; any other
            // unique violation (e.g. the applicants.phone race) must not be misreported.
            if (str_contains($e->getMessage(), 'applications')) {
                throw new AlreadyAppliedException;
            }
            throw $e;
        } catch (Throwable $e) {
            $this->cvs->delete($storedPaths);
            throw $e;
        }
    }
}
