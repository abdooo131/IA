/*
 * Shiply Now storefront widget. The customer picks their area once; the bar then says
 * whether 60 minute delivery reaches it, and product and collection pages mark what the
 * area's dark store has in stock. Everything comes from the app proxy and is only a hint:
 * the checkout rate checks the real address, hours and stock again before payment.
 */
(function () {
  'use strict';

  var root = document.getElementById('shiplynow-widget');
  if (!root || root.getAttribute('data-ready')) return;
  root.setAttribute('data-ready', '1');

  var PROXY = root.getAttribute('data-proxy') || '/apps/shiplynow';
  var HIDE = root.getAttribute('data-hide-unavailable') === 'true';
  // After choosing an area, open the area's page with everything its dark store can deliver.
  var OPEN_PAGE = root.getAttribute('data-open-page') === 'true';
  var KEY = 'shiplynow_area';
  var MAX_PRODUCTS = 48;
  var locale =
    (root.getAttribute('data-locale') || document.documentElement.lang || 'en')
      .toLowerCase()
      .indexOf('ar') === 0
      ? 'ar'
      : 'en';

  var TEXT = {
    en: {
      pick: 'Delivery in 60 minutes. Check your area',
      check: 'Check',
      change: 'Change',
      open: '60 minute delivery to {area}',
      closed: '60 minute delivery to {area} starts again {when}',
      closedSoon: '60 minute delivery to {area} is closed now',
      busy: '{area}: we are busy right now. Try again in a little while',
      title: 'Where should we deliver?',
      search: 'Search your area',
      close: 'Close',
      none: 'No area matches. We deliver in 60 minutes only in these areas for now.',
      failed: 'Could not load the areas. Try again.',
      badge: '60 min',
      arrives: 'Arrives in {minutes} minutes to {area}',
      standard: 'Not in stock for 60 minutes in {area}; normal delivery only',
      standardShort: 'Normal delivery',
    },
    ar: {
      pick: 'توصيل خلال 60 دقيقة. اعرف منطقتك',
      check: 'اعرف',
      change: 'غيّر',
      open: 'توصيل خلال 60 دقيقة لـ {area}',
      closed: 'توصيل الـ 60 دقيقة لـ {area} يرجع {when}',
      closedSoon: 'توصيل الـ 60 دقيقة لـ {area} مقفول دلوقتي',
      busy: '{area}: عندنا ضغط دلوقتي. جرّب بعد شوية',
      title: 'نوصّل فين؟',
      search: 'دوّر على منطقتك',
      close: 'إغلاق',
      none: 'مفيش منطقة بالاسم ده. التوصيل خلال 60 دقيقة متاح في المناطق دي بس حاليًا.',
      failed: 'مقدرناش نحمّل المناطق. جرّب تاني.',
      badge: '60 دقيقة',
      arrives: 'يوصل خلال {minutes} دقيقة لـ {area}',
      standard: 'مش متاح خلال 60 دقيقة في {area}؛ توصيل عادي بس',
      standardShort: 'توصيل عادي',
    },
  };

  function t(key, vars) {
    var text = TEXT[locale][key] || TEXT.en[key];
    Object.keys(vars || {}).forEach(function (k) {
      text = text.split('{' + k + '}').join(vars[k]);
    });
    return text;
  }

  function nameOf(item) {
    return (locale === 'ar' ? item.nameAr : item.nameEn) || item.nameEn;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function read() {
    try {
      return JSON.parse(window.localStorage.getItem(KEY) || 'null');
    } catch {
      return null;
    }
  }

  function write(area) {
    try {
      if (area) window.localStorage.setItem(KEY, JSON.stringify(area));
      else window.localStorage.removeItem(KEY);
    } catch {
      // Private browsing: the choice lasts for this page only.
    }
  }

  function get(path, params) {
    var query = new URLSearchParams(params || {}).toString();
    return fetch(PROXY + path + (query ? '?' + query : ''), {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  function when(iso) {
    try {
      return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Africa/Cairo',
      }).format(new Date(iso));
    } catch {
      return '';
    }
  }

  // ─── state ─────────────────────────────────────────────────────────────────

  var area = read();
  var info = null; // the last availability answer for the chosen area
  var known = {}; // variant id -> in stock at the area's store
  var handles = {}; // product handle -> variant ids
  var scanTimer = null;

  // ─── the bar ───────────────────────────────────────────────────────────────

  root.hidden = false;
  root.className = 'snw snw--' + (root.getAttribute('data-position') || 'bottom');
  root.setAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
  root.setAttribute('lang', locale);
  var bar = el('div', 'snw-bar');
  var label = el('span', 'snw-label');
  var action = el('button', 'snw-button');
  action.type = 'button';
  action.addEventListener('click', openPicker);
  bar.appendChild(label);
  bar.appendChild(action);
  root.appendChild(bar);

  function renderBar() {
    root.removeAttribute('data-state');
    if (!area || !info || !info.zone) {
      label.textContent = t('pick');
      action.textContent = t('check');
      root.setAttribute('data-state', 'pick');
      return;
    }
    var name = nameOf(info.zone);
    action.textContent = t('change');
    root.setAttribute('data-state', info.status);
    if (info.status === 'open') label.textContent = t('open', { area: name });
    else if (info.status === 'at_capacity') label.textContent = t('busy', { area: name });
    else if (info.nextOpenAt)
      label.textContent = t('closed', { area: name, when: when(info.nextOpenAt) });
    else label.textContent = t('closedSoon', { area: name });
  }

  // ─── the area picker ───────────────────────────────────────────────────────

  var dialog = null;

  function closePicker() {
    if (!dialog) return;
    dialog.remove();
    dialog = null;
    document.removeEventListener('keydown', onKey);
    action.focus();
  }

  function onKey(event) {
    if (event.key === 'Escape') closePicker();
  }

  function openPicker() {
    if (dialog) return;
    dialog = el('div', 'snw-backdrop');
    dialog.setAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    var box = el('div', 'snw-dialog');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', t('title'));
    var head = el('div', 'snw-head');
    head.appendChild(el('h2', 'snw-title', t('title')));
    var close = el('button', 'snw-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', t('close'));
    close.addEventListener('click', closePicker);
    head.appendChild(close);
    var search = el('input', 'snw-search');
    search.type = 'search';
    search.placeholder = t('search');
    search.setAttribute('aria-label', t('search'));
    var list = el('ul', 'snw-list');
    var note = el('p', 'snw-note');
    box.appendChild(head);
    box.appendChild(search);
    box.appendChild(list);
    box.appendChild(note);
    dialog.appendChild(box);
    dialog.addEventListener('click', function (event) {
      if (event.target === dialog) closePicker();
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(dialog);
    search.focus();

    get('/areas')
      .then(function (areas) {
        function show() {
          var q = search.value.trim().toLowerCase();
          list.textContent = '';
          var shown = areas.filter(function (a) {
            return !q || a.nameEn.toLowerCase().indexOf(q) >= 0 || (a.nameAr || '').indexOf(q) >= 0;
          });
          shown.forEach(function (a) {
            var item = el('li');
            var choose = el('button', 'snw-area');
            choose.type = 'button';
            choose.appendChild(el('span', 'snw-area-name', nameOf(a)));
            choose.appendChild(el('span', 'snw-area-store', nameOf(a.store)));
            choose.addEventListener('click', function () {
              pick(a);
            });
            item.appendChild(choose);
            list.appendChild(item);
          });
          note.textContent = shown.length ? '' : t('none');
        }
        search.addEventListener('input', show);
        show();
      })
      .catch(function () {
        note.textContent = t('failed');
      });
  }

  function pick(chosen) {
    area = { zoneId: chosen.zoneId };
    write(area);
    known = {};
    clearMarks();
    closePicker();
    // Saved on the cart too, so checkout can lock the order to this area's store later.
    fetch('/cart/update.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ attributes: { _shiplynow_zone: chosen.zoneId } }),
    })
      .catch(function () {})
      .then(function () {
        if (OPEN_PAGE) window.location.href = storePage(chosen.zoneId);
      });
    refresh();
  }

  function storePage(zoneId) {
    return PROXY + '/store?' + new URLSearchParams({ zone: zoneId, lang: locale }).toString();
  }

  // The area page's "Change area" button opens the picker.
  document.addEventListener('click', function (event) {
    var target = event.target;
    if (target && target.closest && target.closest('[data-shiplynow-change-area]')) {
      event.preventDefault();
      openPicker();
    }
  });

  // ─── products ──────────────────────────────────────────────────────────────

  function productVariant() {
    var input = document.querySelector('form[action*="/cart/add"] [name="id"]');
    if (input && input.value) return String(input.value);
    var fromUrl = new URLSearchParams(window.location.search).get('variant');
    return fromUrl || root.getAttribute('data-product-variant');
  }

  function handleOf(anchor) {
    var match = /\/products\/([^/?#]+)/.exec(anchor.getAttribute('href') || '');
    return match ? decodeURIComponent(match[1]) : null;
  }

  function cardOf(anchor) {
    return (
      anchor.closest('li, article, .card-wrapper, .grid__item, .product-card, .product-item') ||
      anchor
    );
  }

  function cards() {
    var byHandle = {};
    var count = 0;
    var anchors = document.querySelectorAll('a[href*="/products/"]');
    for (var i = 0; i < anchors.length; i++) {
      var anchor = anchors[i];
      if (root.contains(anchor) || anchor.closest('form[action*="/cart/add"]')) continue;
      var handle = handleOf(anchor);
      if (!handle) continue;
      if (!byHandle[handle]) {
        if (count >= MAX_PRODUCTS) continue;
        byHandle[handle] = [];
        count++;
      }
      var card = cardOf(anchor);
      if (byHandle[handle].indexOf(card) < 0) byHandle[handle].push(card);
    }
    return byHandle;
  }

  function variantsOf(handle) {
    if (handles[handle]) return Promise.resolve(handles[handle]);
    var cacheKey = 'shiplynow_h_' + handle;
    try {
      var cached = window.sessionStorage.getItem(cacheKey);
      if (cached) return Promise.resolve((handles[handle] = JSON.parse(cached)));
    } catch {
      // No session storage: ask the store each time.
    }
    return fetch('/products/' + encodeURIComponent(handle) + '.js', {
      headers: { Accept: 'application/json' },
    })
      .then(function (res) {
        return res.ok ? res.json() : { variants: [] };
      })
      .then(function (product) {
        var ids = (product.variants || []).map(function (v) {
          return String(v.id);
        });
        handles[handle] = ids;
        try {
          window.sessionStorage.setItem(cacheKey, JSON.stringify(ids));
        } catch {
          // Ignore a full or blocked session storage.
        }
        return ids;
      })
      .catch(function () {
        return [];
      });
  }

  function clearMarks() {
    var marked = document.querySelectorAll('[data-shiplynow]');
    for (var i = 0; i < marked.length; i++) {
      var node = marked[i];
      node.classList.remove('snw-dim');
      if (node.getAttribute('data-shiplynow') === 'hidden') node.style.display = '';
      node.removeAttribute('data-shiplynow');
      var badges = node.querySelectorAll('.snw-badge, .snw-standard');
      for (var j = 0; j < badges.length; j++) badges[j].remove();
    }
    var product = document.querySelector('.snw-product');
    if (product) product.remove();
  }

  function markCard(card, inStock) {
    var state = inStock ? 'yes' : HIDE ? 'hidden' : 'no';
    if (card.getAttribute('data-shiplynow') === state) return;
    card.setAttribute('data-shiplynow', state);
    if (inStock) {
      card.appendChild(el('span', 'snw-badge', t('badge')));
    } else if (HIDE) {
      card.style.display = 'none';
    } else {
      card.classList.add('snw-dim');
      card.appendChild(el('span', 'snw-standard', t('standardShort')));
    }
  }

  function markProduct() {
    var variant = productVariant();
    var form = document.querySelector('form[action*="/cart/add"]');
    var old = document.querySelector('.snw-product');
    if (!variant || !form || !info || !info.zone || !(variant in known)) {
      if (old) old.remove();
      return;
    }
    var name = nameOf(info.zone);
    var text = known[variant]
      ? t('arrives', { minutes: info.promiseMinutes, area: name })
      : t('standard', { area: name });
    if (old && old.textContent === text) return;
    if (old) old.remove();
    var line = el('p', 'snw-product snw-product--' + (known[variant] ? 'yes' : 'no'), text);
    form.parentNode.insertBefore(line, form.nextSibling);
  }

  function ask(ids) {
    var missing = ids.filter(function (id) {
      return !(id in known);
    });
    if (!missing.length) return Promise.resolve();
    var batches = [];
    for (var i = 0; i < missing.length; i += 250) batches.push(missing.slice(i, i + 250));
    return Promise.all(
      batches.map(function (batch) {
        return get('/availability', { zone: area.zoneId, variants: batch.join(',') }).then(
          function (answer) {
            Object.keys(answer.variants || {}).forEach(function (id) {
              known[id] = answer.variants[id];
            });
          },
        );
      }),
    );
  }

  function scan() {
    if (!area || !info || !info.zone || info.offered === false) return;
    var byHandle = cards();
    var names = Object.keys(byHandle);
    var current = productVariant();
    Promise.all(names.map(variantsOf))
      .then(function (lists) {
        var ids = [];
        lists.forEach(function (list) {
          ids = ids.concat(list);
        });
        if (current) ids.push(String(current));
        return ask(ids).then(function () {
          names.forEach(function (handle, i) {
            var inStock = lists[i].some(function (id) {
              return known[id];
            });
            if (!lists[i].length) return;
            byHandle[handle].forEach(function (card) {
              markCard(card, inStock);
            });
          });
          markProduct();
        });
      })
      .catch(function () {});
  }

  function scanSoon() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 300);
  }

  // ─── start ─────────────────────────────────────────────────────────────────

  function refresh() {
    if (!area) {
      info = null;
      renderBar();
      return;
    }
    var current = productVariant();
    get('/availability', { zone: area.zoneId, variants: current || '' })
      .then(function (answer) {
        if (!answer.zone) {
          // The area is no longer served; ask again.
          area = null;
          write(null);
          info = null;
        } else {
          info = answer;
          Object.keys(answer.variants || {}).forEach(function (id) {
            known[id] = answer.variants[id];
          });
        }
        // The merchant does not offer 60 minutes right now: stay out of the way.
        root.hidden = !!(info && info.offered === false);
        renderBar();
        scan();
      })
      .catch(function () {
        renderBar();
      });
  }

  document.addEventListener('change', function (event) {
    if (event.target && event.target.name === 'id') scanSoon();
  });
  if (window.MutationObserver) {
    var ours = function (node) {
      return node.nodeType === 1 && /(^|\s)snw-/.test(node.className || '');
    };
    new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var r = records[i];
        if (root.contains(r.target) || (dialog && dialog.contains(r.target))) continue;
        var changed = Array.prototype.slice
          .call(r.addedNodes)
          .concat(Array.prototype.slice.call(r.removedNodes));
        // Our own badges and lines do not count as new products.
        if (changed.length && changed.every(ours)) continue;
        scanSoon();
        return;
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  renderBar();
  refresh();
})();
