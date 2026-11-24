//
// The CV upload helpers (HEIC conversion, image compression) are only needed on the
// job page, so they are loaded on demand and never reach the jobs list.
if (document.querySelector('[data-apply-form]')) {
    import('./cv-upload.js');
}

// Alpine powers the admin job form (language tabs and question builder); load it only there.
if (document.querySelector('[x-data]')) {
    import('./admin-job-form.js');
}

// Copy buttons: <button data-copy-target="input-id" data-copied="Copied">
document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-copy-target]');
    if (!button) return;
    const input = document.getElementById(button.dataset.copyTarget);
    if (!input) return;
    const done = () => {
        const original = button.textContent;
        button.textContent = button.dataset.copied || 'Copied';
        setTimeout(() => { button.textContent = original; }, 1500);
    };
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(input.value).then(done, () => { input.select(); document.execCommand('copy'); done(); });
    } else {
        input.select();
        document.execCommand('copy');
        done();
    }
});
