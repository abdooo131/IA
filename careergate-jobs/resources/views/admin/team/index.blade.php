@extends('layouts.admin')
@section('title', __('admin.team.title'))
@section('content')
    <h1 class="text-2xl font-bold">{{ __('admin.team.title') }}</h1>

    <div class="mt-6 overflow-x-auto rounded-lg bg-white shadow">
        <table class="min-w-full text-sm">
            <thead class="bg-cg-yellow-light text-start">
                <tr>
                    <th class="px-4 py-3 text-start">{{ __('admin.common.name') }}</th>
                    <th class="px-4 py-3 text-start">{{ __('admin.common.email') }}</th>
                    <th class="px-4 py-3 text-start">{{ __('admin.common.role') }}</th>
                    <th class="px-4 py-3 text-start">{{ __('admin.common.status') }}</th>
                    <th class="px-4 py-3"></th>
                </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
            @foreach ($members as $m)
                @php $self = $m->is(auth()->user()); @endphp
                <tr>
                    <td class="px-4 py-3">
                        <input form="member-{{ $m->id }}" name="name" value="{{ $m->name }}" class="w-full rounded border border-gray-300 px-2 py-1">
                        @if ($self)<span class="text-xs text-cg-navy-light">({{ __('admin.team.you') }})</span>@endif
                    </td>
                    <td class="px-4 py-3">{{ $m->email }}</td>
                    <td class="px-4 py-3">
                        <select form="member-{{ $m->id }}" name="role" class="rounded border border-gray-300 px-2 py-1" @disabled($self)>
                            @foreach (\App\Enums\Role::cases() as $r)
                                <option value="{{ $r->value }}" @selected($m->role === $r)>{{ __('admin.roles.'.$r->value) }}</option>
                            @endforeach
                        </select>
                    </td>
                    <td class="px-4 py-3">
                        <input form="member-{{ $m->id }}" type="hidden" name="is_active" value="{{ $self ? 1 : 0 }}" @disabled($self)>
                        <label class="flex items-center gap-2">
                            <input form="member-{{ $m->id }}" type="checkbox" name="is_active" value="1" @checked($m->is_active) @disabled($self)>
                            {{ $m->is_active ? __('admin.common.active') : __('admin.common.inactive') }}
                        </label>
                    </td>
                    <td class="px-4 py-3 text-end">
                        <button form="member-{{ $m->id }}" class="rounded bg-cg-navy px-3 py-1 text-white hover:bg-cg-navy-light">{{ __('admin.common.save') }}</button>
                    </td>
                </tr>
            @endforeach
            </tbody>
        </table>
    </div>
    @foreach ($members as $m)
        <form method="POST" action="{{ route('admin.team.update', $m) }}" id="member-{{ $m->id }}" class="hidden">@csrf @method('PATCH')</form>
    @endforeach
    @error('is_active')<p class="mt-3 text-sm text-red-700">{{ $message }}</p>@enderror
    @error('role')<p class="mt-3 text-sm text-red-700">{{ $message }}</p>@enderror

    <h2 class="mt-10 text-lg font-bold">{{ __('admin.team.add') }}</h2>
    <p class="mt-1 text-sm text-cg-navy-light">{{ __('admin.team.add_hint') }}</p>
    <form method="POST" action="{{ route('admin.team.store') }}" class="mt-4 max-w-md rounded-lg bg-white p-6 shadow">
        @csrf
        <x-admin.auth._field name="name" :label="__('admin.common.name')" />
        <x-admin.auth._field name="email" type="email" :label="__('admin.common.email')" />
        <div class="mt-4">
            <label for="role" class="block text-sm font-medium">{{ __('admin.common.role') }}</label>
            <select id="role" name="role" class="mt-1 block w-full rounded border border-gray-300 px-3 py-2">
                @foreach (\App\Enums\Role::cases() as $r)
                    <option value="{{ $r->value }}" @selected(old('role', 'recruiter') === $r->value)>{{ __('admin.roles.'.$r->value) }}</option>
                @endforeach
            </select>
            @error('role')<p class="mt-1 text-sm text-red-700">{{ $message }}</p>@enderror
        </div>
        <button class="mt-6 rounded bg-cg-yellow px-4 py-2 font-semibold text-cg-navy hover:brightness-95">{{ __('admin.team.create') }}</button>
    </form>
@endsection
