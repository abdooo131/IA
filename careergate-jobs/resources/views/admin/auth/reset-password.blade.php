@extends('layouts.admin')
@section('title', __('admin.passwords.reset_title'))
@section('content')
    <h1 class="text-xl font-bold">{{ __('admin.passwords.reset_title') }}</h1>
    <form method="POST" action="{{ route('password.update') }}">
        @csrf
        <input type="hidden" name="token" value="{{ $token }}">
        <x-admin.auth._field name="email" type="email" :label="__('admin.common.email')" :value="$email" autocomplete="username" />
        <x-admin.auth._field name="password" type="password" :label="__('admin.passwords.new_password')" autocomplete="new-password" />
        <x-admin.auth._field name="password_confirmation" type="password" :label="__('admin.passwords.confirm')" autocomplete="new-password" />
        <button class="mt-6 w-full rounded bg-cg-yellow px-4 py-2 font-semibold text-cg-navy hover:brightness-95">{{ __('admin.common.save') }}</button>
    </form>
@endsection
