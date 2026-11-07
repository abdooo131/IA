import { analyse, DEFAULT_SETTINGS } from './engine.js';
import { sampleData } from './sample.js';
import { money, times, esc, initTheme, store } from './ui.js';

const AR = {
  theme: 'المظهر',
  open: 'افتح ربح',
  eyebrow: 'للمتاجر الإلكترونية التي تشحن بالدفع عند الاستلام',
  h1: 'بعت <span class="num" data-k="booked"></span>.<br>واللي فضلك <em class="num" data-k="net"></em>.',
  lead: 'الشحنات المرفوضة، ورحلات المرتجع، ورسوم شركة الشحن، والإعلانات اللي شكلها مربح وهي مش كده، كلها بتاكل الفرق. ربح بيتابع كل أوردر من لحظة الشراء لحد ما الفلوس توصلك، ويوريك الرقم الوحيد المهم: اللي فضلك فعلاً.',
  ctaDemo: 'جرّبه على متجر تجريبي',
  ctaOwn: 'استخدم ملفاتي',
  fine: 'مجاني. من غير تسجيل. ملفاتك بتفضل على جهازك.',
  walkTitle: 'متجر تجريبي، آخر ٣٠ يوم',
  gapTitle: 'أربع أدوات، أربع أرقام مختلفة.',
  gapSub: 'كل واحدة صح في حاجة. ولا واحدة فيهم هي ربحك.',
  s1who: 'منصة الإعلانات بتقول', s1why: 'عائد على الإعلان، محسوب وقت الشراء',
  s2who: 'المتجر بيقول', s2why: 'مبيعات، فيها شحنات عمرها ما هتوصل',
  s3who: 'شركة الشحن بتقول', s3why: 'اتسلّم واتحصّل، قبل رسومها',
  s4who: 'الشيت بتاعك بيقول', s4why: 'اللي كان صح آخر مرة حد حدّثه',
  verdict: 'ربح بيحطهم جنب بعض، أوردر أوردر: <span class="num" data-k="net"></span> صافي ربح، وعائد حقيقي <span class="num" data-k="trueRoas"></span> على الإعلانات، وحملة خسرانة منصة الإعلانات شايفاها ناجحة.',
  leaksTitle: 'بيلاقي الفلوس بتضيع فين.',
  leaksSub: 'فحوصات واضحة، وكل واحدة معاها الأرقام اللي وراها.',
  c1t: 'الربح بيتحسب على الباب', c1p: 'البيعة بتتحسب لما الشحنة تتسلم وتتدفع، مش لما حد يدوس شراء. والمرتجع بيكلّفك الرحلتين والتغليف.',
  c2t: 'عائد الإعلان بعد التسليم', c2p: 'عائد كل حملة محسوب على الأوردرات اللي اتسلمت، جنب نقطة التعادل حسب هامشك الحقيقي.',
  c3t: 'منتجات بترجع', c3p: 'نسبة المرتجع والهامش الحقيقي لكل منتج، عشان تعرف مين محتاج صور أحسن أو مقاسات أوضح أو سعر جديد.',
  c4t: 'مناطق بترفض الشحنات', c4p: 'نسبة المرتجع وتكلفة الشحن لكل مدينة أو محافظة، عشان تقرر فين تطلب عربون أو تأكيد بالتليفون.',
  c5t: 'كل رسم في مكانه', c5p: 'الشحن، ورحلات المرتجع، ورسوم الدفع عند الاستلام والكارت، والتغليف، والمصاريف الثابتة، كلها على الأوردر أو اليوم بتاعها.',
  c6t: 'الربح يوم بيوم', c6p: 'شوف أي أيام كسبت وأي أيام خسرت، والشهر لسه فيه وقت تغيّر حاجة.',
  howTitle: 'تلات ملفات، دقيقتين.',
  howSub: 'من غير ربط حسابات ومن غير مبرمج.',
  h1t: 'نزّل الأوردرات', h1p: 'نزّل ملف الأوردرات CSV من لوحة تحكم متجرك. ربح بيقرا ملفات المتاجر المشهورة زي ما هي.',
  h2t: 'ضيف الشحن والإعلانات', h2p: 'حط كشف شركة الشحن عشان حالة التسليم والرسوم، وتقرير الإعلانات عشان المصروف لكل حملة.',
  h3t: 'اقرا ربحك الحقيقي', h3p: 'حدد تكلفة منتجاتك والرسوم مرة واحدة، وربح هيفتكرها على الجهاز ده المرة الجاية.',
  privT: 'أرقامك عمرها ما بتخرج من جهازك.',
  privP: 'ربح شغال بالكامل جوه المتصفح. الملفات بتتقري على جهازك ومفيش حاجة بتترفع على أي سيرفر. اقفل الصفحة أو امسح البيانات من الإعدادات، وتختفي.',
  finalT: 'بطّل تخمّن اللي فاضلك.',
  foot: 'ربح مجاني ومفتوح المصدر.',
  foot2: 'الأرقام في الصفحة دي من متجر تجريبي مش حقيقي.',
};
const EN = {};

const d = sampleData();
const r = analyse(d.orders, d.ads, { ...DEFAULT_SETTINGS, productCosts: d.productCosts });
const s = r.summary;
const values = {
  booked: money(s.bookedSales, s.currency, { compact: true }),
  net: money(s.netProfit, s.currency, { compact: true }),
  revenue: money(s.revenue, s.currency, { compact: true }),
  reportedRoas: times(s.reportedRoas),
  trueRoas: times(s.trueRoas),
};

function fillValues() {
  document.querySelectorAll('[data-k]').forEach((el) => { el.textContent = values[el.dataset.k] ?? ''; });
}

function renderWalk(lang) {
  const labels = lang === 'ar'
    ? { booked: 'مبيعات مسجّلة', returned: 'مرتجع أو مرفوض', pending: 'لسه في الطريق', cogs: 'تكلفة المنتج', shipping: 'شحن ورحلات مرتجع', fees: 'رسوم الدفع', packaging: 'تغليف', ads: 'إعلانات', fixed: 'مصاريف ثابتة', net: 'صافي الربح' }
    : null;
  document.getElementById('walk').innerHTML = r.waterfall.map((w) => {
    const cls = w.key === 'net' ? 'walk-row net' : w.total ? 'walk-row total' : 'walk-row';
    return `<div class="${cls}"><span>${esc(labels ? labels[w.key] : w.label)}</span><span class="v">${money(w.value, s.currency)}</span></div>`;
  }).join('');
}

function setLang(lang) {
  const html = document.documentElement;
  html.lang = lang;
  html.dir = lang === 'ar' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const k = el.dataset.i18n;
    if (!(k in EN)) EN[k] = el.textContent;
    el.textContent = lang === 'ar' ? AR[k] ?? EN[k] : EN[k];
  });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => {
    const k = el.dataset.i18nHtml;
    if (!(k in EN)) EN[k] = el.innerHTML;
    el.innerHTML = lang === 'ar' ? AR[k] ?? EN[k] : EN[k];
  });
  fillValues();
  renderWalk(lang);
  document.getElementById('lang').textContent = lang === 'ar' ? 'English' : 'عربي';
  store.set('lang', lang);
}

initTheme(document.getElementById('theme'));
document.getElementById('lang').addEventListener('click', () => setLang(document.documentElement.lang === 'ar' ? 'en' : 'ar'));
setLang(store.get('lang', 'en'));
