import { garment } from './art.js';
import { initFx, confetti } from './fx.js';
import { openMapPicker } from './geo.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' сум';
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
const mobile = () => matchMedia('(max-width: 960px)').matches;

/* ---------- данные ---------- */
async function getJSON(urls) {
  for (const u of urls) {
    try { const r = await fetch(u, { cache: 'no-store' }); if (r.ok) return await r.json(); } catch {}
  }
  return null;
}
const catalog = (await getJSON(['api/catalog', 'data/products.json'])) || { categories: [], products: [] };
const settings = (await getJSON(['api/settings', 'data/settings.json'])) || {};
const cfg = (await getJSON(['api/config'])) || {};
const verifyRequired = !!cfg.verifyRequired;   // проверка номера через Telegram
const cats = catalog.categories || [];
const products = (catalog.products || []).filter((p) => p && p.id);
const byId = (id) => products.find((p) => p.id === id);
const catOf = (id) => cats.find((c) => c.id === id);
const media = (p, cls = '') => (p.images && p.images[0] ? `<img class="${cls}" src="${esc(p.images[0])}" alt="${esc(p.name)}" loading="lazy" draggable="false">` : garment(p.shape, p.color));

/* ---------- настройки и тексты ---------- */
function titleHTML(s) {
  const [first, ...rest] = String(s).split('\n');
  return esc(first) + (rest.length ? `<em>${esc(rest.join(' '))}</em>` : '');
}
$$('[data-s]').forEach((el) => {
  const v = settings[el.dataset.s];
  if (v) el.innerHTML = el.hasAttribute('data-title') ? titleHTML(v) : esc(v);
});
if (settings.bgImage) $('.bg').style.setProperty('--bg-img', `url("${String(settings.bgImage).replace(/["\\]/g, '')}")`);

if (/^#[0-9a-f]{6}$/i.test(settings.accent || '')) document.documentElement.style.setProperty('--sand', settings.accent);
if (settings.avatar && settings.avatarLogo === '1') $$('.logo-mark').forEach((m) => { m.classList.add('avatar'); m.style.backgroundImage = `url("${String(settings.avatar).replace(/["\\]/g, '')}")`; });
const paused = settings.ordersPaused === '1';

(function contacts() {
  const L = [];
  const digits = (settings.whatsapp || '').replace(/\D/g, '');
  if (settings.telegram) L.push([`https://t.me/${settings.telegram}`, 'Telegram']);
  if (digits) L.push([`https://wa.me/${digits}`, 'WhatsApp']);
  if (settings.instagram) L.push([`https://instagram.com/${settings.instagram}`, 'Instagram']);
  if (settings.phone) L.push([`tel:${settings.phone.replace(/[^\d+]/g, '')}`, settings.phone]);
  if (settings.email) L.push([`mailto:${settings.email}`, settings.email]);
  $('#contactLinks').innerHTML = L.length
    ? L.map(([h, t], i) => `<a class="btn ${i ? 'btn-ghost' : 'btn-primary'}" href="${esc(h)}" ${h.startsWith('http') ? 'target="_blank" rel="noopener"' : ''}>${esc(t)}</a>`).join('')
    : '<span class="muted">Контакты появятся здесь, когда вы добавите их в админ-панели.</span>';
})();

/* ---------- состояние ---------- */
const state = { cat: 'all', q: '', cart: [], size: '', qty: 1, current: null };
function loadCart() {
  try {
    const v = JSON.parse(localStorage.getItem('velmont-cart') || '[]');
    return (Array.isArray(v) ? v : []).filter((i) => i && byId(i.id) && Number(i.qty) > 0).map((i) => ({ id: i.id, size: String(i.size || ''), qty: Math.min(20, Math.round(i.qty)) }));
  } catch { return []; }
}
state.cart = loadCart();

/* ---------- меню ---------- */
const counts = (id) => products.filter((p) => p.cat === id).length;
$('#dropPanel').innerHTML = cats.map((c) => `<a href="#cat-${esc(c.id)}" data-go="${esc(c.id)}">${esc(c.name)}<span>${counts(c.id)}</span></a>`).join('');
$('#menuInner').innerHTML = [
  `<a href="#home" style="--i:0">Главная</a>`, `<a href="#catalog" style="--i:1">Каталог</a>`,
  ...cats.map((c, i) => `<a class="sub" href="#cat-${esc(c.id)}" data-go="${esc(c.id)}" style="--i:${i + 2}">${esc(c.name)}</a>`),
  `<a href="#about" style="--i:${cats.length + 2}">О бренде</a>`, `<a href="#contact" style="--i:${cats.length + 3}">Контакты</a>`,
].join('');
const menu = $('#menu'), burger = $('#burger');
function setMenu(open) {
  menu.classList.toggle('open', open); burger.setAttribute('aria-expanded', open); menu.setAttribute('aria-hidden', !open);
  document.body.classList.toggle('lock', open);
}
burger.onclick = () => setMenu(!menu.classList.contains('open'));
menu.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });

function goCat(id) {
  if (state.cat !== 'all' || state.q) { state.cat = 'all'; state.q = ''; $('#search').value = ''; renderCatalog(); }
  requestAnimationFrame(() => $('#cat-' + CSS.escape(id))?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }));
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-go]');
  if (a) { e.preventDefault(); goCat(a.dataset.go); }
});

/* ---------- каталог: ряды с горизонтальной прокруткой ---------- */
function cardHTML(p) {
  const color = /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#b7a48d';
  const tag = p.inStock === false ? '' : p.tag ? `<span class="tag">${esc(p.tag)}</span>` : '';
  return `<article class="card reveal" data-id="${esc(p.id)}" tabindex="0" role="button" aria-label="${esc(p.name)} — открыть">
    <div class="card-art">${tag}${p.inStock === false ? '<span class="tag sold">Нет в наличии</span>' : ''}${media(p)}</div>
    <div class="card-info">
      <span class="card-type">${esc(p.type || catOf(p.cat)?.name || '')}</span>
      <h4>${esc(p.name)}</h4>
      ${p.colorName ? `<div class="dot-line"><i class="dot" style="--c:${color}"></i>${esc(p.colorName)}</div>` : ''}
      <div class="card-foot"><span class="price">${p.oldPrice ? `<s>${money(p.oldPrice)}</s>` : ''}${money(p.price)}</span>
      ${p.inStock === false ? '' : `<button class="quick" data-quick="${esc(p.id)}" aria-label="Добавить ${esc(p.name)} в корзину">+</button>`}</div>
    </div></article>`;
}
function matches(p) {
  const q = state.q.trim().toLowerCase();
  return !q || [p.name, p.type, p.colorName, p.tag, catOf(p.cat)?.name].join(' ').toLowerCase().includes(q);
}
function renderChips() {
  $('#chips').innerHTML = [['all', 'Все']].concat(cats.map((c) => [c.id, c.name])).map(([id, n]) =>
    `<button class="chip ${state.cat === id ? 'on' : ''}" role="tab" aria-selected="${state.cat === id}" data-chip="${esc(id)}">${esc(n)}</button>`).join('');
}
function renderCatalog() {
  renderChips();
  let any = false;
  $('#rows').innerHTML = cats.filter((c) => state.cat === 'all' || c.id === state.cat).map((c) => {
    const list = products.filter((p) => p.cat === c.id && matches(p));
    if (!list.length) return '';
    any = true;
    return `<section class="row" id="cat-${esc(c.id)}"><div class="row-head"><h3>${esc(c.name)}<small>${list.length}</small></h3>
      <div class="row-ctrl"><button class="arrow" data-dir="-1" aria-label="Листать влево">←</button><button class="arrow" data-dir="1" aria-label="Листать вправо">→</button></div></div>
      <div class="rail" tabindex="-1">${list.map(cardHTML).join('')}</div><div class="rail-bar"><i></i></div></section>`;
  }).join('');
  $('#noResults').hidden = any;
  $$('.rail').forEach(initRail);
  observeReveal();
}
$('#chips').addEventListener('click', (e) => {
  const c = e.target.closest('[data-chip]'); if (!c) return;
  state.cat = c.dataset.chip; renderCatalog();
});
let st; $('#search').addEventListener('input', (e) => { clearTimeout(st); st = setTimeout(() => { state.q = e.target.value; renderCatalog(); }, 160); });

function initRail(rail) {
  const row = rail.closest('.row'), bar = $('.rail-bar i', row), [prev, next] = $$('.arrow', row);
  const upd = () => {
    const max = rail.scrollWidth - rail.clientWidth;
    const ratio = rail.clientWidth / rail.scrollWidth;
    bar.style.width = Math.max(12, ratio * 100) + '%';
    bar.style.marginLeft = max > 0 ? (rail.scrollLeft / max) * (100 - Math.max(12, ratio * 100)) + '%' : '0';
    prev.disabled = rail.scrollLeft < 4; next.disabled = rail.scrollLeft > max - 4;
    row.querySelector('.row-ctrl').style.visibility = max > 4 ? 'visible' : 'hidden';
  };
  rail.addEventListener('scroll', upd, { passive: true });
  addEventListener('resize', upd); requestAnimationFrame(upd);
  row.addEventListener('click', (e) => {
    const b = e.target.closest('.arrow'); if (!b) return;
    const step = Math.min(rail.clientWidth * .85, 640);
    rail.scrollBy({ left: Number(b.dataset.dir) * step, behavior: reduce ? 'auto' : 'smooth' });
  });
  // перетаскивание мышью
  let d = null;
  rail.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    d = { x: e.clientX, left: rail.scrollLeft, moved: false };
  });
  addEventListener('pointermove', (e) => {
    if (!d || !rail.isConnected) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) > 6) { d.moved = true; rail.classList.add('dragging'); }
    if (d.moved) rail.scrollLeft = d.left - dx;
  });
  const end = () => { if (!d) return; if (d.moved) { rail._drag = true; setTimeout(() => (rail._drag = false), 60); } rail.classList.remove('dragging'); d = null; };
  addEventListener('pointerup', end); addEventListener('pointercancel', end);
  rail.addEventListener('click', (e) => { if (rail._drag) { e.preventDefault(); e.stopPropagation(); } }, true);
}

/* появление карточек при прокрутке (и вертикальной, и горизонтальной) */
let io;
function observeReveal() {
  io?.disconnect();
  io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      const el = en.target; io.unobserve(el);
      const idx = $$('.reveal', el.parentElement).indexOf(el);
      el.style.setProperty('--d', Math.min(idx % 6, 5) * 70 + 'ms');
      el.classList.add('in');
      setTimeout(() => el.classList.add('done'), 1100);
    });
  }, { threshold: 0.12 });
  $$('.reveal').forEach((el) => (reduce ? el.classList.add('in', 'done') : io.observe(el)));
}

/* наклон карточек за мышью */
if (fine && !reduce) {
  document.addEventListener('pointermove', (e) => {
    const c = e.target.closest?.('.card'); if (!c || c.closest('.dragging')) return;
    const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    c.classList.add('hovering');
    c.style.setProperty('--ry', ((x - .5) * 12).toFixed(2) + 'deg'); c.style.setProperty('--rx', ((.5 - y) * 10).toFixed(2) + 'deg');
    c.style.setProperty('--gx', x * 100 + '%'); c.style.setProperty('--gy', y * 100 + '%');
  });
  document.addEventListener('pointerout', (e) => {
    const c = e.target.closest?.('.card'); if (!c || c.contains(e.relatedTarget)) return;
    c.classList.remove('hovering'); c.style.setProperty('--rx', '0deg'); c.style.setProperty('--ry', '0deg');
  });
}

/* ---------- карточка товара на весь экран ---------- */
const pm = $('#pm'), panel = $('#pmPanel');
let lastFocus = null;
function openProduct(id, { push = true } = {}) {
  const p = byId(id); if (!p) return;
  state.current = p; state.size = (p.sizes || []).length === 1 ? p.sizes[0] : ''; state.qty = 1;
  const color = /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#b7a48d';
  const imgs = p.images || [];
  panel.innerHTML = `
    <button class="pm-close" data-close aria-label="Закрыть">✕</button>
    <div class="pm-gallery">
      <div class="pm-stage" id="pmStage">${imgs[0] ? `<img class="main" src="${esc(imgs[0])}" alt="${esc(p.name)}">` : garment(p.shape, p.color)}</div>
      ${imgs.length > 1 ? `<div class="pm-thumbs">${imgs.map((s, i) => `<button class="${i ? '' : 'on'}" data-img="${i}" aria-label="Фото ${i + 1}"><img src="${esc(s)}" alt=""></button>`).join('')}</div>` : '<div></div>'}
    </div>
    <div class="pm-info">
      <div class="pm-meta"><span>${esc(catOf(p.cat)?.name || '')}</span>${p.tag ? `<span class="tag" style="position:static">${esc(p.tag)}</span>` : ''}</div>
      <h2 id="pmTitle">${esc(p.name)}</h2>
      <div class="pm-price">${p.oldPrice ? `<s>${money(p.oldPrice)}</s>` : ''}${money(p.price)}</div>
      ${p.colorName ? `<div class="pm-meta"><i class="dot" style="--c:${color}"></i>Цвет: ${esc(p.colorName)}</div>` : ''}
      ${p.desc ? `<p class="pm-desc">${esc(p.desc)}</p>` : ''}
      ${(p.sizes || []).length ? `<div><div class="pm-label"><span>Размер</span></div><div class="sizes" id="sizes" role="radiogroup" aria-label="Размер">${p.sizes.map((s) => `<button class="size ${state.size === s ? 'on' : ''}" role="radio" aria-checked="${state.size === s}" data-size="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>` : ''}
      ${p.inStock === false ? '<p class="stock-no">Сейчас нет в наличии</p>' : `<div class="pm-buy"><div class="qty" aria-label="Количество"><button data-q="-1" aria-label="Меньше">−</button><span id="pmQty">1</span><button data-q="1" aria-label="Больше">+</button></div><button class="btn btn-primary" id="pmAdd">В корзину</button></div>`}
    </div>`;
  lastFocus = document.activeElement;
  pm.classList.add('open'); pm.setAttribute('aria-hidden', 'false'); document.body.classList.add('lock');
  if (push) history.replaceState(null, '', '#p-' + p.id);
  setTimeout(() => $('.pm-close', panel)?.focus({ preventScroll: true }), 60);
}
function closeProduct() {
  if (!pm.classList.contains('open')) return;
  pm.classList.remove('open'); pm.setAttribute('aria-hidden', 'true');
  if (!$('#drawer').classList.contains('open')) document.body.classList.remove('lock');
  if (location.hash.startsWith('#p-')) history.replaceState(null, '', location.pathname + location.search + '#catalog');
  lastFocus?.focus?.({ preventScroll: true });
}
pm.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) return closeProduct();
  const t = e.target.closest('[data-img]');
  if (t) {
    $$('.pm-thumbs button', pm).forEach((b) => b.classList.toggle('on', b === t));
    const st = $('#pmStage'); st.innerHTML = `<img class="main" src="${esc(state.current.images[+t.dataset.img])}" alt="${esc(state.current.name)}">`;
  }
  const s = e.target.closest('[data-size]');
  if (s) { state.size = s.dataset.size; $$('.size', pm).forEach((b) => { const on = b === s; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); }); }
  const q = e.target.closest('[data-q]');
  if (q) { state.qty = Math.max(1, Math.min(20, state.qty + Number(q.dataset.q))); $('#pmQty').textContent = state.qty; }
  if (e.target.closest('#pmAdd')) {
    const p = state.current;
    if ((p.sizes || []).length && !state.size) { const z = $('#sizes'); z.classList.remove('shake'); void z.offsetWidth; z.classList.add('shake'); toast('Выберите размер'); return; }
    const src = $('.pm-stage img, .pm-stage svg', pm) || e.target;
    addToCart(p.id, state.size, state.qty, src);
    setTimeout(closeProduct, 120);
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if ($('#drawer').classList.contains('open')) closeCart(); else if (pm.classList.contains('open')) closeProduct(); else setMenu(false); }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.card')) { e.preventDefault(); openProduct(e.target.dataset.id); }
  if (e.key === 'Tab' && pm.classList.contains('open')) {   // фокус остаётся внутри окна
    const f = $$('button, [href], input', panel).filter((x) => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});
document.addEventListener('click', (e) => {
  const quick = e.target.closest('[data-quick]');
  if (quick) {
    e.stopPropagation();
    const p = byId(quick.dataset.quick);
    if ((p.sizes || []).length) return openProduct(p.id);   // сначала нужен размер
    return addToCart(p.id, '', 1, $('.card-art img, .card-art svg', quick.closest('.card')));
  }
  const card = e.target.closest('.card');
  if (card) openProduct(card.dataset.id);
});
function routeHash() { const m = location.hash.match(/^#p-(.+)$/); if (m) openProduct(decodeURIComponent(m[1]), { push: false }); }
addEventListener('hashchange', () => { if (location.hash.startsWith('#p-')) routeHash(); else if (pm.classList.contains('open')) closeProduct(); });

/* ---------- корзина ---------- */
const drawer = $('#drawer'), overlay = $('#overlay');
const cartCount = () => state.cart.reduce((s, i) => s + i.qty, 0);
const cartTotal = () => state.cart.reduce((s, i) => s + (byId(i.id)?.price || 0) * i.qty, 0);
const keyOf = (i) => i.id + '|' + i.size;
function saveCart() { try { localStorage.setItem('velmont-cart', JSON.stringify(state.cart)); } catch {} renderCart(); }
let shownTotal = 0;
function tween(el, from, to) {
  if (reduce || from === to) { el.textContent = money(to); return; }
  const t0 = performance.now();
  (function step(t) { const k = Math.min(1, (t - t0) / 500), e = 1 - Math.pow(1 - k, 3); el.textContent = money(from + (to - from) * e); if (k < 1) requestAnimationFrame(step); })(t0);
}
function renderCart(animateNew) {
  const n = cartCount();
  const b = $('#cartCount'); b.textContent = n; b.classList.toggle('has', n > 0);
  $('#cartN').textContent = n ? `(${n})` : '';
  $('#cartEmpty').style.display = n ? 'none' : 'grid'; $('#cartFoot').style.display = n ? 'grid' : 'none';
  $('#cartList').innerHTML = state.cart.map((i) => {
    const p = byId(i.id);
    return `<div class="cart-item" data-key="${esc(keyOf(i))}" ${animateNew && animateNew !== keyOf(i) ? 'style="animation:none"' : ''}>
      <div class="cart-thumb">${media(p)}</div>
      <div><h4>${esc(p.name)}</h4><p>${[i.size && 'Размер ' + esc(i.size), esc(p.colorName)].filter(Boolean).join(' · ')}</p>
        <div class="qty"><button data-cq="-1" aria-label="Меньше">−</button><span>${i.qty}</span><button data-cq="1" aria-label="Больше">+</button></div></div>
      <div class="sum"><span>${money(p.price * i.qty)}</span><button class="remove" data-rm>Удалить</button></div></div>`;
  }).join('');
  const total = cartTotal();
  tween($('#cartTotal'), shownTotal, total); shownTotal = total;
  $('#checkoutTotal').textContent = money(total);
}
function bumpCart() {
  const btn = $('#openCart'), badge = $('#cartCount');
  [[btn, 'bump'], [badge, 'pop']].forEach(([el, c]) => { el.classList.remove(c); void el.offsetWidth; el.classList.add(c); });
}
function fly(srcEl, p) {
  if (reduce || !srcEl) return bumpCart();
  const a = srcEl.getBoundingClientRect(), b = $('#openCart').getBoundingClientRect();
  if (!a.width) return bumpCart();
  const dot = document.createElement('div'); dot.className = 'fly';
  const img = p.images && p.images[0];
  dot.style.cssText = `left:${a.left + a.width / 2}px;top:${a.top + a.height / 2}px;margin:-38px 0 0 -38px;` + (img ? `background-image:url("${img.replace(/["\\]/g, '')}")` : `--c:${/^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#d8c3a0'}`);
  document.body.appendChild(dot);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
  dot.animate([
    { transform: 'translate(0,0) scale(.4)', opacity: 0 },
    { transform: 'translate(0,0) scale(1.1)', opacity: 1, offset: .15 },
    { transform: `translate(${dx * .45}px,${Math.min(dy, 0) - 110}px) scale(.8)`, opacity: 1, offset: .55 },
    { transform: `translate(${dx}px,${dy}px) scale(.2)`, opacity: .4 },
  ], { duration: 850, easing: 'cubic-bezier(.45,.05,.4,1)' }).onfinish = () => { dot.remove(); bumpCart(); };
}
function addToCart(id, size, qty, srcEl) {
  const p = byId(id); if (!p) return;
  const ex = state.cart.find((i) => i.id === id && i.size === size);
  if (ex) ex.qty = Math.min(20, ex.qty + qty); else state.cart.push({ id, size, qty });
  saveCart(); fly(srcEl, p);
  toast(`${p.name}${size ? ' · ' + size : ''} в корзине`);
}
function openCart() {
  setView('cart'); drawer.classList.add('open'); overlay.classList.add('open'); drawer.setAttribute('aria-hidden', 'false'); document.body.classList.add('lock');
  setTimeout(() => $('#closeCart').focus({ preventScroll: true }), 80);
}
function closeCart() {
  clearInterval(trackTimer);
  drawer.classList.remove('open'); overlay.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true');
  if (!pm.classList.contains('open') && !menu.classList.contains('open')) document.body.classList.remove('lock');
}
let trackTimer = null;
function setView(v) {
  $('#viewCart').hidden = v !== 'cart'; $('#viewCheckout').hidden = v !== 'checkout'; $('#viewDone').hidden = v !== 'done'; $('#viewTrack').hidden = v !== 'track';
  clearInterval(trackTimer); if (v === 'track') { loadTrack(); trackTimer = setInterval(loadTrack, 20000); }
}
$('#openCart').onclick = openCart; $('#closeCart').onclick = closeCart; overlay.onclick = closeCart;
$('#continueShopping').onclick = () => { closeCart(); $('#catalog').scrollIntoView({ behavior: 'smooth' }); };
$('#doneClose').onclick = () => { closeCart(); setView('cart'); };
if (paused) { const tb = $('#toCheckout'); tb.disabled = true; tb.querySelector('span').textContent = 'Приём заказов приостановлен'; }
$('#toCheckout').onclick = () => { resetOrderBtn(); $('#checkoutTotal').textContent = money(cartTotal()); $('#orderError').hidden = true; setView('checkout'); setTimeout(() => $('#viewCheckout [name=name]').focus(), 50); };
$('#backToCart').onclick = () => setView('cart');
$('#cartList').addEventListener('click', (e) => {
  const row = e.target.closest('.cart-item'); if (!row) return;
  const item = state.cart.find((i) => keyOf(i) === row.dataset.key); if (!item) return;
  const q = e.target.closest('[data-cq]');
  if (q) { item.qty += Number(q.dataset.cq); if (item.qty <= 0) return removeRow(row, item); item.qty = Math.min(item.qty, 20); saveCart(); }
  if (e.target.closest('[data-rm]')) removeRow(row, item);
});
function removeRow(row, item) {
  const done = () => { state.cart = state.cart.filter((i) => i !== item); saveCart(); };
  if (reduce) return done();
  row.classList.add('out'); setTimeout(done, 480);
}

/* оформление заказа -> сервер -> Telegram */
const form = $('#viewCheckout');
try { const s = JSON.parse(localStorage.getItem('velmont-contact') || '{}'); form.name.value = s.name || ''; if (!verifyRequired) form.phone.value = s.phone || ''; } catch {}

/* --- подтверждение номера через Telegram и адрес на карте --- */
const verif = { token: '', phone: '' }, geo = { lat: null, lon: null, address: '' };
const tgBtn = $('#tgVerify'), tgHint = $('#tgHint');
let tgTimer = null;
if (verifyRequired) {
  tgBtn.hidden = false; form.phone.readOnly = true; form.phone.placeholder = 'Нажмите «Подтвердить через Telegram»';
  tgBtn.onclick = async () => {
    clearInterval(tgTimer); tgBtn.disabled = true; tgHint.className = 'hint'; tgHint.textContent = 'Открываем Telegram…';
    let w = null; try { w = window.open('', '_blank'); } catch {}
    try {
      const r = await fetch('api/tg/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Не удалось запустить проверку');
      if (w) w.location = j.link;
      tgHint.innerHTML = `В Telegram нажмите <b>Start</b>, затем <b>«Поделиться номером»</b>. Ждём подтверждения… <a href="${esc(j.link)}" target="_blank" rel="noopener">Открыть Telegram</a>`;
      const t0 = Date.now();
      tgTimer = setInterval(async () => {
        if (Date.now() - t0 > 10 * 60e3) { clearInterval(tgTimer); tgBtn.disabled = false; tgHint.textContent = 'Время вышло. Нажмите кнопку ещё раз.'; return; }
        try {
          const s = await (await fetch('api/tg/status?sid=' + j.sid)).json();
          if (s.expired) { clearInterval(tgTimer); tgBtn.disabled = false; tgHint.textContent = 'Время вышло. Нажмите кнопку ещё раз.'; }
          if (s.verified) {
            clearInterval(tgTimer); verif.token = s.token; verif.phone = s.phone; form.phone.value = s.phone; form.phone.closest('.field').classList.remove('bad');
            tgBtn.hidden = true; tgHint.className = 'hint ok'; tgHint.textContent = '✓ Номер подтверждён через Telegram'; toast('Номер подтверждён');
          }
        } catch {}
      }, 2000);
    } catch (e) { if (w) w.close(); tgBtn.disabled = false; tgHint.className = 'hint bad'; tgHint.textContent = e.message; }
  };
}
$('#pickMap').onclick = () => openMapPicker({
  initial: geo.lat ? { lat: geo.lat, lon: geo.lon, address: geo.address } : null, toast,
  onPick: (p) => {
    Object.assign(geo, p);
    $('#pickMapText').textContent = p.address; $('#pickMap').classList.add('done'); $('#pickMap').closest('.field').classList.remove('bad');
    form.address2.hidden = false;
  },
});
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (form.website.value) return;
  const err = $('#orderError'); err.hidden = true;
  let bad = false;
  [['name', (v) => v.trim().length >= 2], ['phone', (v) => v.replace(/\D/g, '').length >= 7 && (!verifyRequired || !!verif.token)]].forEach(([n, ok]) => {
    const f = form[n].closest('.field'); const good = ok(form[n].value); f.classList.remove('bad'); void f.offsetWidth; f.classList.toggle('bad', !good); if (!good) bad = true;
  });
  const noMap = !geo.lat; $('#addrBox').classList.toggle('bad', noMap);
  if (bad || noMap) {
    err.textContent = form.name.value.trim().length < 2 ? 'Укажите имя.' : (verifyRequired && !verif.token) ? 'Подтвердите номер телефона через Telegram.' : !verifyRequired && form.phone.value.replace(/\D/g, '').length < 7 ? 'Укажите номер телефона.' : 'Выберите адрес доставки на карте.';
    err.hidden = false; return;
  }
  const data = { name: form.name.value, phone: form.phone.value, phoneToken: verif.token, location: { lat: geo.lat, lon: geo.lon }, address: [geo.address, form.address2.value.trim()].filter(Boolean).join(', '), comment: form.comment.value, items: state.cart.map(({ id, size, qty }) => ({ id, size, qty })) };
  try { localStorage.setItem('velmont-contact', JSON.stringify({ name: data.name, phone: verifyRequired ? '' : data.phone })); } catch {}
  const btn = $('#sendOrder');
  btn.style.setProperty('--bw', btn.offsetWidth + 'px');
  btn.classList.remove('sent'); btn.classList.add('sending'); btn.disabled = true;
  const sleep = (ms) => new Promise((r) => setTimeout(r, reduce ? 0 : ms));
  const minRide = sleep(1250);
  const text = orderText(data);
  let ok = false;
  try {
    let r;
    try { r = await fetch('api/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); }
    catch { r = null; }
    const noServer = !r || [404, 405, 501].includes(r.status);   // сайт открыт без сервера
    let j = {};
    if (!noServer) { j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Не удалось отправить заказ. Попробуйте ещё раз.'); }
    else if (!settings.telegram) throw new Error('Сервер заказов недоступен. Попробуйте позже.');
    await minRide;
    btn.classList.replace('sending', 'sent'); ok = true;
    await sleep(1000);
    if (!noServer && j.id && j.key) saveMyOrder(j.id, j.key);
    orderDone(noServer ? '' : j.id, !noServer && j.telegram, text);
  } catch (x) {
    await minRide;
    err.textContent = x.message; err.hidden = false;
  } finally {
    btn.disabled = false;
    if (!ok) resetOrderBtn();
  }
});
function resetOrderBtn() { const b = $('#sendOrder'); b.classList.remove('sending', 'sent'); }
function orderText(data) {
  const lines = ['Новый заказ VELMONT', '', data.name + ', ' + data.phone, data.address, data.location ? `Карта: https://www.google.com/maps?q=${data.location.lat},${data.location.lon}` : '', data.comment, ''];
  data.items.forEach((i, n) => { const p = byId(i.id); lines.push(`${n + 1}. ${p.name}${i.size ? ' · ' + i.size : ''} × ${i.qty} — ${money(p.price * i.qty)}`); });
  lines.push('', 'Итого: ' + money(cartTotal()));
  return lines.filter((x, i) => x || i === 1 || i >= 6).join('\n');
}
function orderDone(id, tgOk, text) {
  state.cart = []; saveCart();
  const handle = settings.telegram ? '@' + settings.telegram : '';
  const num = id ? `Номер заказа ${id}. ` : '';
  const tg = $('#doneTg');
  if (settings.telegram) {   // кнопка всегда: заказ уходит боту сам, а покупатель может отправить его ещё и на ваш аккаунт
    $('#doneText').textContent = tgOk
      ? `${num}Заказ уже у нас. Нажмите кнопку ниже, чтобы отправить его ещё и нам в Telegram ${handle}: так мы ответим быстрее.`
      : `${num}Осталось одно касание: нажмите кнопку ниже, и заказ уйдёт нам в Telegram ${handle}.`;
    tg.href = `https://t.me/${settings.telegram}?text=${encodeURIComponent((id ? `Заказ ${id}\n` : '') + text)}`;
    tg.textContent = `Отправить заказ в Telegram ${handle}`; tg.hidden = false;
  } else {
    $('#doneText').textContent = tgOk ? `${num}Ваш заказ отправлен. Скоро свяжемся с вами!` : `${num}Мы получили заказ и скоро свяжемся с вами.`; tg.hidden = true;
  }
  setView('done'); form.comment.value = ''; form.address2.value = ''; form.address2.hidden = true; Object.assign(geo, { lat: null, lon: null, address: '' }); $('#pickMapText').textContent = 'Выбрать адрес на карте'; $('#pickMap').classList.remove('done');
  requestAnimationFrame(() => confetti($('#confetti'), getComputedStyle(document.documentElement).getPropertyValue('--sand').trim() || '#d8c3a0'));
  bumpCart();
}


/* ---------- мои заказы и статус доставки ---------- */
const myOrders = () => { try { const v = JSON.parse(localStorage.getItem('velmont-orders') || '[]'); return Array.isArray(v) ? v.filter((o) => o && o.id && o.key) : []; } catch { return []; } };
function saveMyOrder(id, key) { try { localStorage.setItem('velmont-orders', JSON.stringify([{ id, key, date: Date.now() }, ...myOrders().filter((o) => o.id !== id)].slice(0, 10))); } catch {} syncTrackBtn(); }
function syncTrackBtn() { $('#openTrack').hidden = !myOrders().length; }
const STEPS = [['Заказано', 'Мы приняли ваш заказ'], ['Доставляется', 'Заказ передан в доставку'], ['Доставлено', 'Заказ у вас. Спасибо!']];
const lastStatus = {};
async function loadTrack() {
  const list = myOrders(), box = $('#trackList');
  if (!list.length) { box.innerHTML = '<p class="empty">Пока заказов нет.</p>'; return; }
  let data = [];
  try { const r = await fetch('api/track?o=' + list.map((o) => o.id + ':' + o.key).join(','), { cache: 'no-store' }); data = (await r.json()).orders || []; } catch { if (!box.children.length) box.innerHTML = '<p class="empty">Не удалось загрузить статус. Попробуем снова.</p>'; return; }
  if (!data.length) { box.innerHTML = '<p class="empty">Заказы не найдены.</p>'; return; }
  box.innerHTML = data.map((o) => {
    const idx = { new: 0, shipping: 1, done: 2 }[o.status] ?? 0, changed = lastStatus[o.id] !== undefined && lastStatus[o.id] !== o.status;
    lastStatus[o.id] = o.status;
    return `<div class="trk${changed ? ' flash' : ''}"><div class="trk-head"><b>${esc(o.id)}</b><span>${new Date(o.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} · ${money(o.total)}</span></div>
      <ol class="steps">${STEPS.map((s, i) => `<li class="${idx === 2 || i < idx ? 'ok' : i === idx ? 'cur' : ''}"><i></i><b>${s[0]}</b></li>`).join('')}</ol>
      <p class="trk-note">${esc(STEPS[idx][1])}</p>${o.trackNo ? `<p class="trk-no">Номер отправления BTS: <b>${esc(o.trackNo)}</b></p>` : ''}</div>`;
  }).join('');
}
$('#openTrack').onclick = () => { openCart(); setView('track'); };
$('#backFromTrack').onclick = () => setView('cart');
$('#doneTrack').onclick = () => setView('track');
syncTrackBtn();

/* ---------- уведомление ---------- */
let tt; function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 2400); }

/* ---------- главный экран: плавающие карточки ---------- */
(function hero() {
  const pick = products.filter((p) => p.inStock !== false).slice(0, 3);
  const feat = pick.length ? pick : [];
  $('#heroStack').innerHTML = feat.map((p) => `<div class="hero-card glass">${media(p)}<span>${esc(p.name)}</span></div>`).join('');
  if (!fine || reduce) return;
  const stack = $('#heroStack'), cards = $$('.hero-card', stack);
  $('#home').addEventListener('pointermove', (e) => {
    const x = e.clientX / innerWidth - .5, y = e.clientY / innerHeight - .5;
    cards.forEach((c, i) => { const k = (i + 1) * 14; c.style.transform = `translate(${x * k}px,${y * k}px) rotate(var(--r))`; });
  });
})();

/* ---------- шапка, прогресс, подсветка меню ---------- */
const header = $('#header'), prog = $('#progress');
function onScroll() {
  header.classList.toggle('scrolled', scrollY > 20);
  const h = document.documentElement; prog.style.transform = `scaleX(${scrollY / Math.max(1, h.scrollHeight - innerHeight)})`;
}
addEventListener('scroll', onScroll, { passive: true }); onScroll();
const spy = new IntersectionObserver((es) => es.forEach((en) => {
  if (en.isIntersecting) $$('[data-spy]').forEach((a) => a.classList.toggle('active', a.dataset.spy === en.target.id));
}), { rootMargin: '-45% 0px -50% 0px' });
['home', 'catalog', 'about', 'contact'].forEach((id) => spy.observe($('#' + id)));

/* ---------- эффекты мыши: свечение и всплески при клике ---------- */
if (fine && !reduce) {
  const glow = $('#glow'); let gx = innerWidth / 2, gy = innerHeight / 2, tx = gx, ty = gy;
  addEventListener('pointermove', (e) => { tx = e.clientX; ty = e.clientY; glow.classList.add('on'); }, { passive: true });
  document.documentElement.addEventListener('mouseleave', () => glow.classList.remove('on'));
  (function loop() { gx += (tx - gx) * .12; gy += (ty - gy) * .12; glow.style.transform = `translate(${gx}px,${gy}px)`; requestAnimationFrame(loop); })();
}
if (!reduce) {
  addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' && e.target.closest('.rail')) return;
    const x = e.clientX, y = e.clientY;
    const ring = document.createElement('div'); ring.className = 'ring'; ring.style.cssText = `left:${x}px;top:${y}px`; document.body.appendChild(ring);
    ring.animate([{ transform: 'scale(1)', opacity: .9 }, { transform: 'scale(4.5)', opacity: 0 }], { duration: 650, easing: 'cubic-bezier(.2,.7,.3,1)' }).onfinish = () => ring.remove();
    for (let i = 0; i < 7; i++) {
      const s = document.createElement('div'); s.className = 'spark'; s.style.cssText = `left:${x}px;top:${y}px`; document.body.appendChild(s);
      const a = (Math.PI * 2 * i) / 7 + Math.random() * .6, r = 26 + Math.random() * 30;
      s.animate([{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: `translate(${Math.cos(a) * r}px,${Math.sin(a) * r}px) scale(0)`, opacity: 0 }], { duration: 500 + Math.random() * 250, easing: 'cubic-bezier(.2,.7,.3,1)' }).onfinish = () => s.remove();
    }
  }, { passive: true });
}

/* ---------- видео на главном экране ---------- */
(function heroVideo() {
  const v = $('#heroVideo'); if (!v) return;
  if (settings.heroVideo) {
    v.innerHTML = `<source src="${esc(settings.heroVideo)}" type="${/\.webm$/i.test(settings.heroVideo) ? 'video/webm' : 'video/mp4'}">`; v.removeAttribute('poster'); v.load();
  }
  if (reduce) { v.removeAttribute('autoplay'); v.pause(); return; }
  const play = () => v.play().catch(() => {});
  play();
  new IntersectionObserver((es) => es.forEach((e) => (e.isIntersecting ? play() : v.pause())), { threshold: 0.05 }).observe($('#home'));
  document.addEventListener('visibilitychange', () => (document.hidden ? v.pause() : play()));
})();

/* ---------- старт ---------- */
renderCatalog();
renderCart();
routeHash();
initFx();
