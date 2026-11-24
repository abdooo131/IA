@extends('layouts.admin')
@section('title', $client->exists ? __('admin.clients.edit') : __('admin.clients.add'))
@section('content')
    <h1 class="text-2xl font-bold">{{ $client->exists ? __('admin.clients.edit') : __('admin.clients.add') }}</h1>
    <form method="POST" action="{{ $client->exists ? route('admin.clients.update', $client) : route('admin.clients.store') }}" class="mt-6 max-w-xl rounded-lg bg-white p-6 shadow">
        @csrf
        @if ($client->exists) @method('PUT') @endif
        @foreach ([['name', 'text', true], ['contact_person', 'text', false], ['phone', 'text', false], ['email', 'email', false]] as [$f, $type, $req])
            <div class="{{ $loop->first ? '' : 'mt-4' }}">
                <label for="{{ $f }}" class="block text-sm font-medium">{{ __('admin.clients.'.$f) }}</label>
                <input id="{{ $f }}" name="{{ $f }}" type="{{ $type }}" value="{{ old($f, $client->$f) }}" @required($req)
                       class="mt-1 block w-full rounded border border-gray-300 px-3 py-2 focus:border-cg-yellow focus:ring-2 focus:ring-cg-yellow focus:outline-none">
                @error($f)<p class="mt-1 text-sm text-red-700">{{ $message }}</p>@enderror
            </div>
        @endforeach
        <div class="mt-4">
            <label for="notes" class="block text-sm font-medium">{{ __('admin.clients.notes') }}</label>
            <textarea id="notes" name="notes" rows="4" class="mt-1 block w-full rounded border border-gray-300 px-3 py-2">{{ old('notes', $client->notes) }}</textarea>
            @error('notes')<p class="mt-1 text-sm text-red-700">{{ $message }}</p>@enderror
        </div>
        <div class="mt-6 flex items-center gap-4">
            <button class="rounded bg-cg-yellow px-4 py-2 font-semibold text-cg-navy hover:brightness-95">{{ __('admin.common.save') }}</button>
            <a href="{{ route('admin.clients.index') }}" class="underline">{{ __('admin.actions.cancel') }}</a>
        </div>
    </form>
@endsection
