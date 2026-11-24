@props(['name', 'label', 'type' => 'text', 'value' => null, 'autocomplete' => null])
<div class="mt-4">
    <label for="{{ $name }}" class="block text-sm font-medium">{{ $label }}</label>
    <input id="{{ $name }}" name="{{ $name }}" type="{{ $type }}" value="{{ $type === 'password' ? '' : old($name, $value) }}"
           @if($autocomplete) autocomplete="{{ $autocomplete }}" @endif required
           class="mt-1 block w-full rounded border border-gray-300 px-3 py-2 focus:border-cg-yellow focus:ring-2 focus:ring-cg-yellow focus:outline-none">
    @error($name)<p class="mt-1 text-sm text-red-700">{{ $message }}</p>@enderror
</div>
