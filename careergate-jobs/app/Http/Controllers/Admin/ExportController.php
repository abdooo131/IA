<?php

namespace App\Http\Controllers\Admin;

use App\Enums\Stage;
use App\Http\Controllers\Controller;
use App\Jobs\BuildShortlistExport;
use App\Models\Export;
use App\Models\JobPosting;
use App\Services\ShortlistExporter;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;

class ExportController extends Controller
{
    public function store(Request $request, JobPosting $jobPosting): RedirectResponse
    {
        $data = $request->validate([
            'stages' => ['sometimes', 'array', 'min:1'],
            'stages.*' => ['string', Rule::in(array_map(fn (Stage $s) => $s->value, Stage::cases()))],
        ]);

        $export = Export::create([
            'user_id' => $request->user()->id,
            'job_posting_id' => $jobPosting->id,
            'stages' => array_values(array_unique($data['stages'] ?? [Stage::Shortlisted->value])),
            'status' => 'pending',
        ]);
        BuildShortlistExport::dispatch($export);

        return redirect()->route('admin.jobs.show', $jobPosting)->with('status', __('admin.exports.started'));
    }

    public function download(Export $export, string $type): StreamedResponse
    {
        abort_unless(in_array($type, ['xlsx', 'zip'], true) && $export->status === 'ready', 404);
        $path = $type === 'xlsx' ? $export->xlsx_path : $export->zip_path;
        $disk = Storage::disk(ShortlistExporter::DISK);
        abort_if(! $path || ! $disk->exists($path), 404);

        return $disk->download($path, basename($path), [
            'Content-Type' => $type === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/zip',
            'X-Content-Type-Options' => 'nosniff',
            'Cache-Control' => 'private, no-store',
        ]);
    }
}
