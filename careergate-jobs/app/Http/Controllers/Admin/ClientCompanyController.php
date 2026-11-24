<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\ClientCompanyRequest;
use App\Models\ClientCompany;
use Illuminate\Http\RedirectResponse;

class ClientCompanyController extends Controller
{
    public function index()
    {
        return view('admin.clients.index', [
            'clients' => ClientCompany::withCount('jobPostings')->orderBy('name')->paginate(25),
        ]);
    }

    public function create()
    {
        return view('admin.clients.form', ['client' => new ClientCompany]);
    }

    public function store(ClientCompanyRequest $request): RedirectResponse
    {
        ClientCompany::create($request->validated());

        return redirect()->route('admin.clients.index')->with('status', __('admin.clients.saved'));
    }

    public function edit(ClientCompany $client)
    {
        return view('admin.clients.form', ['client' => $client]);
    }

    public function update(ClientCompanyRequest $request, ClientCompany $client): RedirectResponse
    {
        $client->update($request->validated());

        return redirect()->route('admin.clients.index')->with('status', __('admin.clients.saved'));
    }

    public function destroy(ClientCompany $client): RedirectResponse
    {
        if ($client->jobPostings()->exists()) {
            return back()->withErrors(['client' => __('admin.clients.has_jobs')]);
        }

        $client->delete();

        return redirect()->route('admin.clients.index')->with('status', __('admin.clients.deleted'));
    }
}
