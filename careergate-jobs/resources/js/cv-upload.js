// Progressive enhancement for the apply form CV field.
// Without this script the plain <input type="file" name="cv[]" multiple> still works;
// the server rules remain the source of truth.
//
// heic2any and browser-image-compression are imported on demand so the pages that
// do not need them (job list, about) never download them.

const MAX_DIMENSION = 2000;
const MAX_IMAGE_MB = 1.5;

function isHeic(file) {
    return /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

function isPdf(file) {
    return file.type === 'application/pdf' || (!file.type && /\.pdf$/i.test(file.name));
}

function isImage(file) {
    return /^image\/(jpeg|png)$/i.test(file.type) || (!file.type && /\.(jpe?g|png)$/i.test(file.name));
}

async function toJpeg(file) {
    const { default: heic2any } = await import('heic2any');
    const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.85 });
    const blob = Array.isArray(out) ? out[0] : out;
    return new File([blob], file.name.replace(/\.hei[cf]$/i, '') + '.jpg', { type: 'image/jpeg' });
}

async function shrink(file) {
    const { default: imageCompression } = await import('browser-image-compression');
    const out = await imageCompression(file, {
        maxSizeMB: MAX_IMAGE_MB,
        maxWidthOrHeight: MAX_DIMENSION,
        useWebWorker: true,
        fileType: file.type === 'image/png' ? 'image/png' : 'image/jpeg',
    });
    // Keep the original name; the library may return a Blob-like File with another name.
    return new File([out], file.name, { type: out.type || file.type });
}

function init(form) {
    const fieldset = form.querySelector('[data-cv]');
    const input = form.querySelector('[data-cv-input]');
    const cameraInput = form.querySelector('[data-cv-camera-input]');
    const buttons = form.querySelector('[data-cv-buttons]');
    const list = form.querySelector('[data-cv-list]');
    const errorBox = form.querySelector('[data-cv-error]');
    const submit = form.querySelector('[data-apply-submit]');
    if (!fieldset || !input || !cameraInput || !buttons || !list || !submit) return;

    const d = form.dataset;
    const maxBytes = Number(d.maxKb || 10240) * 1024;
    const maxImages = Number(d.maxImages || 4);
    const submitLabel = submit.textContent.trim();

    /** @type {File[]} */
    let files = [];
    let busy = 0;
    let submitted = false;

    // Hide the plain input (it stays in the DOM and is filled via DataTransfer).
    input.className = 'sr-only';
    input.removeAttribute('required');
    buttons.classList.remove('hidden');
    buttons.classList.add('flex');

    const showError = (msg) => {
        errorBox.textContent = msg || '';
        errorBox.classList.toggle('hidden', !msg);
    };

    const sync = () => {
        const dt = new DataTransfer();
        files.forEach((f) => dt.items.add(f));
        input.files = dt.files;
    };

    const render = () => {
        list.replaceChildren();
        files.forEach((file, index) => {
            const li = document.createElement('li');
            li.className = 'flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-sm';
            const name = document.createElement('span');
            name.className = 'min-w-0 flex-1 truncate';
            name.dir = 'auto';
            const kb = file.size / 1024;
            name.textContent = `${file.name} (${kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(kb)) + ' KB'})`;
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'min-h-11 shrink-0 rounded-lg px-3 font-semibold text-red-700';
            remove.textContent = d.msgRemove || 'Remove';
            remove.addEventListener('click', () => {
                files.splice(index, 1);
                showError('');
                sync();
                render();
            });
            li.append(name, remove);
            list.append(li);
        });
        if (busy > 0) {
            const li = document.createElement('li');
            li.className = 'text-sm text-cg-navy-light';
            li.textContent = d.msgProcessing || 'Preparing...';
            list.append(li);
        }
        submit.disabled = busy > 0 || submitted;
    };

    async function addFiles(picked) {
        showError('');
        for (const original of picked) {
            let file = original;
            try {
                busy++;
                render();

                if (isHeic(file)) file = await toJpeg(file);

                if (!isPdf(file) && !isImage(file)) {
                    showError(d.msgType);
                    continue;
                }
                if (isPdf(file)) {
                    if (files.length > 0) {
                        showError(files.some(isPdf) ? d.msgOnePdf : d.msgMixed);
                        continue;
                    }
                } else {
                    if (files.some(isPdf)) {
                        showError(d.msgMixed);
                        continue;
                    }
                    if (files.length >= maxImages) {
                        showError(d.msgTooMany);
                        continue;
                    }
                    file = await shrink(file);
                }
                if (file.size > maxBytes) {
                    showError(d.msgTooLarge);
                    continue;
                }
                files.push(file);
            } catch (e) {
                showError(d.msgFailed);
            } finally {
                busy--;
            }
        }
        sync();
        render();
    }

    form.querySelector('[data-cv-camera]').addEventListener('click', () => cameraInput.click());
    form.querySelector('[data-cv-choose]').addEventListener('click', () => input.click());

    // A native pick REPLACES input.files with just the new selection; add those to our
    // list and sync() writes the combined list back into the input.
    input.addEventListener('change', () => {
        const picked = Array.from(input.files || []);
        if (picked.length === 0) return;
        addFiles(picked);
    });
    cameraInput.addEventListener('change', () => {
        const picked = Array.from(cameraInput.files || []);
        cameraInput.value = '';
        addFiles(picked);
    });

    form.addEventListener('submit', (event) => {
        if (busy > 0) {
            event.preventDefault();
            return;
        }
        if (files.length === 0) {
            // Let the user see why: nothing is attached.
            event.preventDefault();
            showError(d.msgRequired || '');
            buttons.scrollIntoView({ block: 'center' });
            return;
        }
        if (submitted) {
            event.preventDefault();
            return;
        }
        submitted = true;
        submit.disabled = true;
        submit.textContent = d.msgUploading || 'Uploading...';
    });

    // Page restored from the back/forward cache after a submit: allow another try.
    window.addEventListener('pageshow', (e) => {
        if (e.persisted) {
            submitted = false;
            submit.textContent = submitLabel;
            render();
        }
    });
}

document.querySelectorAll('[data-apply-form]').forEach(init);
