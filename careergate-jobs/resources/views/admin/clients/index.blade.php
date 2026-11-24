@extends('layouts.admin')
@section('title', __('admin.clients.title'))
@section('content')
    <div class="flex items-center justify-between gap-4">
        <h1 class="text-2xl font-bold">{{ __('admin.clients.title') }}</h1>
        <a href="{{ route('admin.clients.create') }}" class="rounded bg-cg-yellow px-4 py-2 font-semibold text-cg-navy hover:brightness-95">{{ __('admin.clients.add') }}</a>
    </div>

    <div class="mt-6 overflow-x-auto rounded-lg bg-white shadow">
        <table class="min-w-full text-sm">
            <thead class="bg-cg-yellow-light">
                <tr>
                    <th class="px-4 py-3 text-start">{{ __('admin.clients.name') }}</th>
                    <th class="px-4 py-3 text-start">{{ __('admin.clients.contact_person') }}</th>
                    <th class="px-4 py-3 text-start">{{ __('admin.clients.phone') }}</th>
                    <th class="px-4 py-3 text-start">{{ __('admin.clients.email') }}</th>
                    <th class="px-4 py-3 text-start">{{ __('admin.clients.jobs') }}</th>
                    <th class="px-4 py-3"></th>
                </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
            @forelse ($clients as $client)
                <tr>
                    <td class="px-4 py-3 font-medium">{{ $client->name }}</td>
                    <td class="px-4 py-3">{{ $client->contact_person }}</td>
                    <td class="px-4 py-3" dir="ltr">{{ $client->phone }}</td>
                    <td class="px-4 py-3">{{ $client->email }}</td>
                    <td class="px-4 py-3">{{ $client->job_postings_count }}</td>
                    <td class="px-4 py-3 text-end whitespace-nowrap">
                        <a href="{{ route('admin.clients.edit', $client) }}" class="underline">{{ __('admin.actions.edit') }}</a>
                        @if (auth()->user()->isAdmin())
                            <form method="POST" action="{{ route('admin.clients.destroy', $client) }}" class="ms-3 inline" onsubmit="return confirm(@js(__('admin.actions.confirm_delete')))">
                                @csrf @method('DELETE')
                                <button class="text-red-700 underline">{{ __('admin.actions.delete') }}</button>
                            </form>
                        @endif
                    </td>
                </tr>
            @empty
                <tr><td colspan="6" class="px-4 py-6 text-center text-cg-navy-light">{{ __('admin.clients.empty') }}</td></tr>
            @endforelse
            </tbody>
        </table>
    </div>
    <div class="mt-4">{{ $clients->links() }}</div>
@endsection
