import Alpine from 'alpinejs';

let counter = 0;

Alpine.data('jobForm', (initial) => ({
    tab: initial.tab || 'en',
    questions: (initial.questions || []).map((q) => ({ ...q, key: ++counter })),
    lines(text) {
        return (text || '').split('\n').map((l) => l.trim()).filter(Boolean);
    },
    add() {
        this.questions.push({ key: ++counter, id: '', type: 'text', label_en: '', label_ar: '', options_en: '', options_ar: '', required: false });
    },
    move(i, delta) {
        const j = i + delta;
        if (j < 0 || j >= this.questions.length) return;
        const [item] = this.questions.splice(i, 1);
        this.questions.splice(j, 0, item);
    },
}));

window.Alpine = Alpine;
Alpine.start();
