//
// The CV upload helpers (HEIC conversion, image compression) are only needed on the
// job page, so they are loaded on demand and never reach the jobs list.
if (document.querySelector('[data-apply-form]')) {
    import('./cv-upload.js');
}
