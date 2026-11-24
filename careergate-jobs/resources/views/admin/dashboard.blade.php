@extends('layouts.admin')
@section('title', __('admin.dashboard.title'))
@section('content')
    <h1 class="text-2xl font-bold">{{ __('admin.dashboard.title') }}</h1>
    <p class="mt-2 text-cg-navy-light">{{ __('admin.dashboard.welcome', ['name' => auth()->user()->name]) }}</p>
@endsection
