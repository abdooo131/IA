@extends('layouts.admin')
@section('title', __('admin.passwords.forgot_title'))
@section('content')
    <h1 class="text-xl font-bold">{{ __('admin.passwords.forgot_title') }}</h1>
    <p class="mt-2 text-sm text-cg-navy-light">{{ __('admin.passwords.forgot_intro') }}</p>
    <form method="POST" action="{{ route('password.email') }}">
        @csrf
        <x-admin.auth._field name="email" type="email" :label="__('admin.common.email')" autocomplete="username" />
        <button class="mt-6 w-full rounded bg-cg-yellow px-4 py-2 font-semibold text-cg-navy hover:brightness-95">{{ __('admin.passwords.send') }}</button>
    </form>
    <p class="mt-4 text-center text-sm"><a class="underline" href="{{ route('admin.login') }}">{{ __('admin.passwords.back') }}</a></p>
@endsection
