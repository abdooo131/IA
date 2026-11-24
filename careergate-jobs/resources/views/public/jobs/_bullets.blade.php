@php
    $items = collect(preg_split('/\R/u', (string) $text))->map(fn ($l) => trim($l))->filter()->values();
@endphp
@if ($items->isNotEmpty())
    <ul class="mt-2 list-disc space-y-1 ps-6">
        @foreach ($items as $item)
            <li>{{ $item }}</li>
        @endforeach
    </ul>
@endif
