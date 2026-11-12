/*
 * Shiply Now storefront widget. The customer finds their neighbourhood (or uses their
 * location) once; the bar then says whether 60 minute delivery reaches it, and product and
 * collection pages mark what that place's dark store has in stock. Everything comes from the
 * app proxy and is only a hint: the checkout rate checks the real address, hours and stock
 * again before payment.
 */
(function () {
  'use strict';

  // ─── pure helpers (also loaded by the tests) ─────────────────────────────────

  /** The proxy parameters for a saved choice: a pin, a picked area or an old zone. */
  function placeParams(choice) {
    if (!choice) return null;
    if (choice.pin) return { lat: String(choice.pin.lat), lng: String(choice.pin.lng) };
    if (choice.areaId) return { area: choice.areaId };
    if (choice.zoneId) return { zone: choice.zoneId };
    return null;
  }

  /**
   * The cart attributes for a choice, so checkout and the fulfillment request use the same
   * place: _shiplynow_area (area id) or _shiplynow_pin ("lat,lng"), the other one cleared,
   * and _shiplynow_zone kept for older readers.
   */
  function cartAttributes(choice, zoneId) {
    return {
      _shiplynow_area: (choice && !choice.pin && choice.areaId) || '',
      _shiplynow_pin: choice && choice.pin ? choice.pin.lat + ',' + choice.pin.lng : '',
      _shiplynow_zone: zoneId || (choice && choice.zoneId) || '',
    };
  }

  /** A position rounded to about a metre, the way the cart keeps it. */
  function roundPin(lat, lng) {
    return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
  }

  /** Calls `run` once typing has paused for `wait` milliseconds. */
  function debounce(run, wait) {
    var timer = null;
    return function () {
      var args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () {
        run.apply(null, args);
      }, wait);
    };
  }

  var helpers = {
    placeParams: placeParams,
    cartAttributes: cartAttributes,
    roundPin: roundPin,
    debounce: debounce,
  };
  if (typeof module === 'object' && module.exports) module.exports = helpers;
  if (typeof document === 'undefined') return;

  var root = document.getElementById('shiplynow-widget');
  if (!root || root.getAttribute('data-ready')) return;
  root.setAttribute('data-ready', '1');

  var PROXY = root.getAttribute('data-proxy') || '/apps/shiplynow';
  var HIDE = root.getAttribute('data-hide-unavailable') === 'true';
  // After choosing a place, open its page with everything its dark store can deliver.
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
      outside: '60 minute delivery does not reach {area} yet',
      outsideHere: '60 minute delivery does not reach your location yet',
      unsure: 'Pick your neighbourhood so we can check 60 minute delivery',
      here: 'your location',
      title: 'Where should we deliver?',
      search: 'Search your neighbourhood or compound',
      searchHint: 'Type at least 2 letters, in Arabic or English.',
      locate: 'Use my location',
      locating: 'Finding your location…',
      locateFailed: 'Could not get your location. Search your neighbourhood instead.',
      close: 'Close',
      none: 'No neighbourhood with that name gets 60 minute delivery. Try another spelling or use your location.',
      results: '{count} places found',
      failed: 'Could not search right now. Try again.',
      unsureNote:
        'We could not tell exactly where you are. Please pick your neighbourhood from the list so we send your order from the right store.',
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
      outside: 'توصيل الـ 60 دقيقة لسه مش واصل {area}',
      outsideHere: 'توصيل الـ 60 دقيقة لسه مش واصل مكانك',
      unsure: 'اختار الحي بتاعك عشان نعرف إذا كان التوصيل خلال 60 دقيقة متاح',
      here: 'مكانك',
      title: 'نوصّل فين؟',
      search: 'دوّر على الحي أو الكمبوند',
      searchHint: 'اكتب حرفين على الأقل، بالعربي أو الإنجليزي.',
      locate: 'استخدم موقعي',
      locating: 'بنحدد مكانك…',
      locateFailed: 'مقدرناش نعرف مكانك. دوّر على الحي بتاعك بدل كده.',
      close: 'إغلاق',
      none: 'مفيش حي بالاسم ده عليه توصيل خلال 60 دقيقة. جرّب كتابة تانية أو استخدم موقعك.',
      results: 'لقينا {count} مكان',
      failed: 'مقدرناش ندوّر دلوقتي. جرّب تاني.',
      unsureNote:
        'مقدرناش نحدد مكانك بالظبط. من فضلك اختار الحي بتاعك من القايمة عشان نبعت طلبك من المخزن الصح.',
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
    if (!item) return '';
    return (locale === 'ar' ? item.nameAr : item.nameEn) || item.nameEn || item.nameAr || '';
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

  function write(value) {
    try {
      if (value) window.localStorage.setItem(KEY, JSON.stringify(value));
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

  function saveCart(zoneId) {
    return fetch('/cart/update.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ attributes: cartAttributes(choice, zoneId) }),
    }).catch(function () {});
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

  // { areaId, nameEn, nameAr, zoneId } | { pin: { lat, lng }, zoneId } | { zoneId } (old)
  var choice = read();
  var info = null; // the last availability answer for the choice
  var known = {}; // variant id -> in stock at the place's store
  var handles = {}; // product handle -> variant ids
  var scanTimer = null;

  /** The place's name: the area the decision found, the one picked, else the zone. */
  function placeName() {
    if (info && info.area) return nameOf(info.area);
    if (choice && choice.nameEn) return nameOf(choice);
    if (info && info.zone) return nameOf(info.zone);
    return t('here');
  }

  // ─── the bar ───────────────────────────────────────────────────────────────

  root.hidden = false;
  root.className = 'snw snw--' + (root.getAttribute('data-position') || 'bottom');
  root.setAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
  root.setAttribute('lang', locale);
  var bar = el('div', 'snw-bar');
  var label = el('span', 'snw-label');
  label.setAttribute('aria-live', 'polite');
  var action = el('button', 'snw-button');
  action.type = 'button';
  action.addEventListener('click', openPicker);
  bar.appendChild(label);
  bar.appendChild(action);
  root.appendChild(bar);

  function renderBar() {
    root.removeAttribute('data-state');
    if (!choice || !info) {
      label.textContent = t('pick');
      action.textContent = t('check');
      root.setAttribute('data-state', 'pick');
      return;
    }
    action.textContent = t('change');
    if (!info.zone) {
      var unsure = info.decision && info.decision.status === 'unsure';
      root.setAttribute('data-state', unsure ? 'unsure' : 'outside');
      if (unsure) label.textContent = t('unsure');
      else if (choice.pin && !info.area) label.textContent = t('outsideHere');
      else label.textContent = t('outside', { area: placeName() });
      return;
    }
    var name = placeName();
    root.setAttribute('data-state', info.status);
    if (info.status === 'open') label.textContent = t('open', { area: name });
    else if (info.status === 'at_capacity') label.textContent = t('busy', { area: name });
    else if (info.nextOpenAt)
      label.textContent = t('closed', { area: name, when: when(info.nextOpenAt) });
    else label.textContent = t('closedSoon', { area: name });
  }

  // ─── the place picker ──────────────────────────────────────────────────────

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

  function openPicker(note) {
    if (dialog) return;
    dialog = el('div', 'snw-backdrop');
    dialog.setAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    var box = el('div', 'snw-dialog');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'snw-title');
    var head = el('div', 'snw-head');
    var title = el('h2', 'snw-title', t('title'));
    title.id = 'snw-title';
    head.appendChild(title);
    var close = el('button', 'snw-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', t('close'));
    close.addEventListener('click', closePicker);
    head.appendChild(close);
    box.appendChild(head);

    if (typeof note === 'string' && note) box.appendChild(el('p', 'snw-explain', note));

    var search = el('input', 'snw-search');
    search.type = 'search';
    search.placeholder = t('search');
    search.setAttribute('aria-label', t('search'));
    search.setAttribute('aria-describedby', 'snw-status');
    search.setAttribute('autocomplete', 'off');
    var locate = el('button', 'snw-locate', t('locate'));
    locate.type = 'button';
    var list = el('ul', 'snw-list');
    var status = el('p', 'snw-note', t('searchHint'));
    status.id = 'snw-status';
    status.setAttribute('role', 'status');
    box.appendChild(search);
    if (navigator.geolocation) box.appendChild(locate);
    box.appendChild(status);
    box.appendChild(list);
    dialog.appendChild(box);
    dialog.addEventListener('click', function (event) {
      if (event.target === dialog) closePicker();
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(dialog);
    search.focus();

    var asked = 0;
    var find = debounce(function (q) {
      var turn = ++asked;
      get('/search', { q: q })
        .then(function (areas) {
          if (turn !== asked || !dialog) return;
          list.textContent = '';
          areas.forEach(function (a) {
            var item = el('li');
            var choose = el('button', 'snw-area');
            choose.type = 'button';
            var names = el('span', 'snw-area-names');
            names.appendChild(el('span', 'snw-area-name', nameOf(a)));
            if (a.parent) names.appendChild(el('span', 'snw-area-parent', nameOf(a.parent)));
            choose.appendChild(names);
            choose.appendChild(el('span', 'snw-area-store', nameOf(a.store)));
            choose.addEventListener('click', function () {
              pick({ areaId: a.areaId, nameEn: a.nameEn, nameAr: a.nameAr, zoneId: a.zoneId });
            });
            item.appendChild(choose);
            list.appendChild(item);
          });
          status.textContent = areas.length ? t('results', { count: areas.length }) : t('none');
        })
        .catch(function () {
          if (turn === asked && dialog) status.textContent = t('failed');
        });
    }, 300);

    search.addEventListener('input', function () {
      var q = search.value.trim().replace(/\s+/g, ' ');
      if (q.length < 2) {
        asked++;
        list.textContent = '';
        status.textContent = t('searchHint');
        return;
      }
      find(q.slice(0, 80));
    });

    locate.addEventListener('click', function () {
      status.textContent = t('locating');
      locate.disabled = true;
      navigator.geolocation.getCurrentPosition(
        function (position) {
          var p = roundPin(position.coords.latitude, position.coords.longitude);
          pick({ pin: p });
        },
        function () {
          if (!dialog) return;
          locate.disabled = false;
          status.textContent = t('locateFailed');
          search.focus();
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
      );
    });
  }

  function pick(chosen) {
    choice = chosen;
    write(choice);
    info = null;
    known = {};
    clearMarks();
    closePicker();
    // Saved on the cart too, so checkout and the order use the same place.
    var saved = saveCart(choice.zoneId);
    refresh(function (answer) {
      // A pin only learns its zone from the answer; keep the cart in step.
      if (choice && choice.pin && answer && answer.zone) {
        choice.zoneId = answer.zone.id;
        write(choice);
        saved = saved.then(function () {
          return saveCart(answer.zone.id);
        });
      }
      if (answer && !answer.zone && answer.decision && answer.decision.status === 'unsure') {
        // Not sure where the pin is: ask for the neighbourhood, kindly.
        openPicker(t('unsureNote'));
        return;
      }
      if (OPEN_PAGE && answer && answer.zone)
        saved.then(function () {
          window.location.href = storePage();
        });
    });
  }

  function storePage() {
    var params = placeParams(choice) || {};
    params.lang = locale;
    return PROXY + '/store?' + new URLSearchParams(params).toString();
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
    var name = placeName();
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
    var params = placeParams(choice);
    if (!missing.length || !params) return Promise.resolve();
    var batches = [];
    for (var i = 0; i < missing.length; i += 250) batches.push(missing.slice(i, i + 250));
    return Promise.all(
      batches.map(function (batch) {
        var query = Object.assign({}, params, { variants: batch.join(',') });
        return get('/availability', query).then(function (answer) {
          Object.keys(answer.variants || {}).forEach(function (id) {
            known[id] = answer.variants[id];
          });
        });
      }),
    );
  }

  function scan() {
    if (!choice || !info || !info.zone || info.offered === false) return;
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

  function refresh(then) {
    var params = placeParams(choice);
    if (!params) {
      choice = null;
      info = null;
      renderBar();
      if (then) then(null);
      return;
    }
    var current = productVariant();
    get('/availability', Object.assign({}, params, { variants: current || '' }))
      .then(function (answer) {
        info = answer;
        Object.keys(answer.variants || {}).forEach(function (id) {
          known[id] = answer.variants[id];
        });
        // The merchant does not offer 60 minutes right now: stay out of the way.
        root.hidden = answer.offered === false;
        renderBar();
        scan();
        if (then) then(answer);
      })
      .catch(function () {
        renderBar();
        if (then) then(null);
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
