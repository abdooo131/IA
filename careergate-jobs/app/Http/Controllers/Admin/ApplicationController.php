<?php

namespace App\Http\Controllers\Admin;

use App\Enums\Stage;
use App\Http\Controllers\Controller;
use App\Models\Application;
use App\Models\JobPosting;
use App\Support\LikePattern;
use App\Support\PhoneNumber;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

class ApplicationController extends Controller
{
    public function index(Request $request, JobPosting $jobPosting)
    {
        $request->validate([
            'from' => ['nullable', 'date_format:Y-m-d'],
            'to' => ['nullable', 'date_format:Y-m-d'],
        ]);

        $stage = Stage::tryFrom((string) $request->query('stage'));
        $city = trim((string) $request->query('city'));
        $area = trim((string) $request->query('area'));
        $q = trim((string) $request->query('q'));
        $from = $request->query('from');
        $to = $request->query('to');
        $sort = $request->query('sort') === 'asc' ? 'asc' : 'desc';
        $tz = 'Africa/Cairo';

        $query = Application::query()
            ->where('job_posting_id', $jobPosting->id)
            ->with('applicant')
            ->withCount('comments')
            ->when($stage, fn ($qb) => $qb->where('stage', $stage->value))
            ->when($from, fn ($qb) => $qb->where('created_at', '>=', Carbon::parse($from, $tz)->startOfDay()))
            ->when($to, fn ($qb) => $qb->where('created_at', '<=', Carbon::parse($to, $tz)->endOfDay()))
            ->when($city !== '' || $area !== '' || $q !== '', function ($qb) use ($city, $area, $q) {
                $qb->whereHas('applicant', function ($a) use ($city, $area, $q) {
                    if ($city !== '') {
                        $a->where('city', $city);
                    }
                    if ($area !== '') {
                        $a->whereRaw("LOWER(area) LIKE ? ESCAPE '!'", [LikePattern::contains($area)]);
                    }
                    if ($q !== '') {
                        if ($phone = PhoneNumber::normalize($q)) {
                            $a->where('phone', $phone);
                        } else {
                            $a->whereRaw("LOWER(full_name) LIKE ? ESCAPE '!'", [LikePattern::contains($q)]);
                        }
                    }
                });
            })
            ->orderBy('created_at', $sort)->orderBy('id', $sort);

        $counts = Application::where('job_posting_id', $jobPosting->id)
            ->selectRaw('stage, count(*) as total')->groupBy('stage')->pluck('total', 'stage');
        $tabs = [];
        foreach (Stage::cases() as $s) {
            $tabs[$s->value] = (int) ($counts[$s->value] ?? 0);
        }

        $cities = \App\Models\Applicant::whereIn('id', Application::where('job_posting_id', $jobPosting->id)->select('applicant_id'))
            ->whereNotNull('city')->distinct()->orderBy('city')->pluck('city');

        return view('admin.jobs.applications', [
            'job' => $jobPosting,
            'applications' => $query->paginate(50)->withQueryString(),
            'stage' => $stage,
            'tabs' => $tabs,
            'total' => array_sum($tabs),
            'cities' => $cities,
            'filters' => ['city' => $city, 'area' => $area, 'q' => $q, 'from' => $from, 'to' => $to, 'sort' => $sort],
        ]);
    }
}
