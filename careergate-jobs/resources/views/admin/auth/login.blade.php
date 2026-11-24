@extends('layouts.admin')
@section('title', __('admin.auth.title'))
@section('content')
    <h1 class="text-xl font-bold">{{ __('admin.auth.title') }}</h1>
    <form method="POST" action="{{ route('admin.login.store') }}">
        @csrf
        <x-admin.auth._field name="email" type="email" :label="__('admin.common.email')" autocomplete="username" />
        <x-admin.auth._field name="password" type="password" :label="__('admin.common.password')" autocomplete="current-password" />
        <label class="mt-4 flex items-center gap-2 text-sm">
            <input type="checkbox" name="remember" value="1"> {{ __('admin.auth.remember') }}
        </label>
        <button class="mt-6 w-full rounded bg-cg-yellow px-4 py-2 font-semibold text-cg-navy hover:brightness-95">{{ __('admin.auth.submit') }}</button>
    </form>
    <p class="mt-4 text-center text-sm"><a class="underline" href="{{ route('password.request') }}">{{ __('admin.auth.forgot') }}</a></p>
@endsection
