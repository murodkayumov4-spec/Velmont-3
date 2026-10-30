import { garment } from './art.js';
import { initFx, confetti, resplit } from './fx.js';
import { openMapPicker } from './geo.js';
import { t, getLang, setLang, isUz, applyStatic, money } from './i18n.js';
import { initAnalytics, track, pageview } from './analytics.js';
import { letters, syncRoll, initNavPill, initMenuFx } from './menu.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
const payOpts = cfg.payments || {};
const lowAt = Number.isFinite(cfg.lowStock) ? cfg.lowStock : 3;
const reviews = ((await getJSON(['api/reviews'])) || {}).reviews || [];
initAnalytics(settings);
const cats = catalog.categories || [];
const products = (catalog.products || []).filter((p) => p && p.id);
const byId = (id) => products.find((p) => p.id === id);
const catOf = (id) => cats.find((c) => c.id === id);
const pName = (p) => (isUz() && p.nameUz) || p.name;
const pDesc = (p) => (isUz() && p.descUz) || p.desc || '';
const cName = (c) => (c ? (isUz() && c.nameUz) || c.name : '');
const maxQty = (p) => (p && p.stock != null ? Math.max(1, Math.min(20, p.stock)) : 20);
/** маленькая копия фото для карточек (создаётся при загрузке в админке); если её нет, подставится оригинал */
const thumbOf = (src) => (/^uploads\/[a-z0-9]+\.(webp|jpg|png)$/i.test(src || '') ? src.replace(/\.(webp|jpg|png)$/i, '-s.webp') : src);
const media = (p, cls = '', small = false) => {
  const img = p.images && p.images[0];
  if (!img) return garment(p.shape, p.color);
  const src = small ? thumbOf(img) : img;
  return `<img class="${cls}" src="${esc(src)}" ${src !== img ? `data-full="${esc(img)}"` : ''} alt="${esc(pName(p))}" loading="lazy" decoding="async" draggable="false">`;
};
document.addEventListener('error', (e) => { const im = e.target; if (im && im.tagName === 'IMG' && im.dataset.full && im.getAttribute('src') !== im.dataset.full) im.src = im.dataset.full; }, true);

/* ---------- настройки и тексты ---------- */
function titleHTML(s) {
  const [first, ...rest] = String(s).split('\n');
  return esc(first) + (rest.length ? `<em>${esc(rest.join(' '))}</em>` : '');
}
function applySettingsText() {
  $$('[data-s]').forEach((el) => {
    const k = el.dataset.s, v = (isUz() && settings[k + 'Uz']) || settings[k];
    if (v) el.innerHTML = el.hasAttribute('data-title') ? titleHTML(v) : esc(v);
    else if (el.dataset.i18n) el.textContent = t(el.dataset.i18n);
  });
}
if (settings.bgImage) $('.bg').style.setProperty('--bg-img', `url("${String(settings.bgImage).replace(/["\\]/g, '')}")`);

if (/^#[0-9a-f]{6}$/i.test(settings.accent || '')) document.documentElement.style.setProperty('--sand', settings.accent);
if (settings.avatar && settings.avatarLogo === '1') $$('.logo-mark').forEach((m) => { m.classList.add('avatar'); m.style.backgroundImage = `url("${String(settings.avatar).replace(/["\\]/g, '')}")`; });
const paused = settings.ordersPaused === '1';

function renderContacts() {
  const L = [];
  const digits = (settings.whatsapp || '').replace(/\D/g, '');
  if (settings.telegram) L.push([`https://t.me/${settings.telegram}`, 'Telegram']);
  if (digits) L.push([`https://wa.me/${digits}`, 'WhatsApp']);
  if (settings.instagram) L.push([`https://instagram.com/${settings.instagram}`, 'Instagram']);
  if (settings.phone) L.push([`tel:${settings.phone.replace(/[^\d+]/g, '')}`, settings.phone]);
  if (settings.email) L.push([`mailto:${settings.email}`, settings.email]);
  $('#contactLinks').innerHTML = L.length
    ? L.map(([h, l], i) => `<a class="btn ${i ? 'btn-ghost' : 'btn-primary'}" href="${esc(h)}" ${h.startsWith('http') ? 'target="_blank" rel="noopener"' : ''}>${esc(l)}</a>`).join('')
    : `<span class="muted">${esc(t('contact_empty'))}</span>`;
}

/* ---------- состояние ---------- */
const newF = () => ({ sizes: new Set(), min: '', max: '', sort: 'def', stock: false });
const state = { cat: 'all', q: '', cart: [], size: '', qty: 1, current: null, f: newF(), fav: false };
const favs = new Set((() => { try { return (JSON.parse(localStorage.getItem('velmont-fav') || '[]') || []).filter((id) => byId(id)); } catch { return []; } })());
const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2Z"/></svg>';
function syncFav() {
  $('#favCount').textContent = favs.size; $('#favCount').classList.toggle('has', favs.size > 0); $('#openFav').classList.toggle('has', favs.size > 0);
  $$('[data-fav]').forEach((b) => { const on = favs.has(b.dataset.fav); b.classList.toggle('on', on); b.setAttribute('aria-label', t(on ? 'fav_del' : 'fav_add')); });
  const fc = $('[data-favchip]'); if (fc) fc.querySelector('b').textContent = favs.size;
}
function toggleFav(id, btn) {
  const on = !favs.has(id); on ? favs.add(id) : favs.delete(id);
  try { localStorage.setItem('velmont-fav', JSON.stringify([...favs])); } catch {}
  syncFav(); if (btn && on) { btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop'); }
  toast(t(on ? 'fav_added' : 'fav_removed')); if (on) track('favorite', { item_id: id });
  if (state.fav && !on) renderCatalog();
}

function loadCart() {
  try {
    const v = JSON.parse(localStorage.getItem('velmont-cart') || '[]');
    return (Array.isArray(v) ? v : []).filter((i) => i && byId(i.id) && Number(i.qty) > 0).map((i) => ({ id: i.id, size: String(i.size || ''), qty: Math.min(20, Math.round(i.qty)) }));
  } catch { return []; }
}
state.cart = loadCart();

/* ---------- меню ---------- */
const counts = (id) => products.filter((p) => p.cat === id).length;
const ARROW = '<svg class="arr" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg>';
function renderMenu() {
  $('#dropPanel').innerHTML = cats.map((c, i) => `<a href="#cat-${esc(c.id)}" data-go="${esc(c.id)}" style="--i:${i}">${esc(cName(c))}<span>${counts(c.id)}</span></a>`).join('');
  let i = 0, n = 0;
  const main = (href, label) => `<a href="${href}" style="--i:${i++}"><em class="n">${String(++n).padStart(2, '0')}</em><span class="mask">${letters(label)}</span>${ARROW}</a>`;
  const sub = (c) => `<a class="sub" href="#cat-${esc(c.id)}" data-go="${esc(c.id)}" style="--i:${i++}"><span class="mask">${letters(cName(c))}</span></a>`;
  $('#menuInner').innerHTML = [main('#home', t('nav_home')), main('#catalog', t('nav_catalog')), ...cats.map(sub), main('#about', t('nav_about')), ...(reviews.length ? [main('#reviews', t('nav_reviews'))] : []), main('#contact', t('nav_contact'))].join('');
  const soc = [];
  if (settings.telegram) soc.push([`https://t.me/${settings.telegram}`, 'Telegram']);
  if (settings.instagram) soc.push([`https://instagram.com/${settings.instagram}`, 'Instagram']);
  if (settings.phone) soc.push([`tel:${settings.phone.replace(/[^\d+]/g, '')}`, settings.phone]);
  $('#menuFoot').innerHTML = `<small>${esc(t('menu_follow'))}</small><button type="button" class="chip lang" data-lang>${esc(t('lang_to'))}</button>` +
    soc.map(([h, l]) => `<a class="chip" href="${esc(h)}" ${h.startsWith('http') ? 'target="_blank" rel="noopener"' : ''}>${esc(l)}</a>`).join('');
  const nr = $('#navReviews'); if (nr) nr.hidden = !reviews.length;
}
const menu = $('#menu'), burger = $('#burger');
function setMenu(open) {
  menu.classList.toggle('open', open); burger.setAttribute('aria-expanded', open); menu.setAttribute('aria-hidden', !open);
  document.body.classList.toggle('lock', open); document.body.classList.toggle('menu-open', open);
  if (open) track('menu_open');
}
burger.onclick = () => setMenu(!menu.classList.contains('open'));
menu.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
initNavPill($('#nav')); initMenuFx(menu);
addEventListener('resize', () => { if (!mobile() && menu.classList.contains('open')) setMenu(false); });

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
  const name = pName(p), low = p.stock != null && p.stock > 0 && p.stock <= lowAt, on = favs.has(p.id);
  const tag = p.inStock === false ? '' : p.tag ? `<span class="tag">${esc(p.tag)}</span>` : '';
  const badge = p.inStock === false ? `<span class="tag sold">${esc(t('sold'))}</span>` : low ? `<span class="tag low">${esc(t('low_stock', { n: p.stock }))}</span>` : '';
  const fav = `<button type="button" class="fav-btn ${on ? 'on' : ''}" data-fav="${esc(p.id)}" aria-label="${esc(t(on ? 'fav_del' : 'fav_add'))}">${HEART}</button>`;
  return `<article class="card reveal" data-id="${esc(p.id)}" tabindex="0" role="button" aria-label="${esc(t('open_aria', { name }))}">
    <div class="card-art">${tag}${badge}${fav}${media(p, '', true)}</div>
    <div class="card-info">
      <span class="card-type">${esc(p.type || cName(catOf(p.cat)))}</span>
      <h4>${esc(name)}</h4>
      ${p.colorName ? `<div class="dot-line"><i class="dot" style="--c:${color}"></i>${esc(p.colorName)}</div>` : ''}
      <div class="card-foot"><span class="price">${p.oldPrice ? `<s>${money(p.oldPrice)}</s>` : ''}${money(p.price)}</span>
      ${p.inStock === false ? '' : `<button class="quick" data-quick="${esc(p.id)}" aria-label="${esc(t('add_aria', { name }))}">+</button>`}</div>
    </div></article>`;
}
function matches(p) {
  const q = state.q.trim().toLowerCase(), f = state.f;
  if (q && ![pName(p), p.name, p.type, p.colorName, p.tag, cName(catOf(p.cat))].join(' ').toLowerCase().includes(q)) return false;
  if (state.fav && !favs.has(p.id)) return false;
  if (f.sizes.size && !(p.sizes || []).some((s) => f.sizes.has(s))) return false;
  if (f.min !== '' && p.price < Number(f.min)) return false;
  if (f.max !== '' && p.price > Number(f.max)) return false;
  if (f.stock && p.inStock === false) return false;
  return true;
}
function renderChips() {
  $('#chips').innerHTML = [['all', t('all')]].concat(cats.map((c) => [c.id, cName(c)])).map(([id, n]) =>
    `<button class="chip ${state.cat === id && !state.fav ? 'on' : ''}" role="tab" aria-selected="${state.cat === id && !state.fav}" data-chip="${esc(id)}">${esc(n)}</button>`).join('') +
    `<button class="chip fav-chip ${state.fav ? 'on' : ''}" data-favchip type="button">${HEART}${esc(t('fav'))} <b>${favs.size}</b></button>`;
}
const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '3XL', '4XL'];
const sizeRank = (x) => { const i = SIZE_ORDER.indexOf(String(x).toUpperCase()); return i >= 0 ? i : 100 + (parseFloat(x) || 0); };
function renderFilters() {
  const sizes = [...new Set(products.flatMap((p) => p.sizes || []))].sort((a, b) => sizeRank(a) - sizeRank(b));
  const prices = products.map((p) => p.price).filter(Number.isFinite), nf = new Intl.NumberFormat('ru-RU');
  const lo = prices.length ? nf.format(Math.min(...prices)) : '0', hi = prices.length ? nf.format(Math.max(...prices)) : '';
  const f = state.f;
  $('#fPanelIn').innerHTML = `<div class="fgrid">
    ${sizes.length ? `<div class="fgrp"><span>${esc(t('f_size'))}</span><div class="fchips">${sizes.map((x) => `<button type="button" class="chip ${f.sizes.has(x) ? 'on' : ''}" data-fsize="${esc(x)}">${esc(x)}</button>`).join('')}</div></div>` : ''}
    <div class="fgrp"><span>${esc(t('f_price'))}</span><div class="frange"><input name="fmin" type="number" inputmode="numeric" min="0" step="1000" placeholder="${esc(t('f_from'))} ${lo}" value="${esc(f.min)}" aria-label="${esc(t('f_from'))}"><i>—</i><input name="fmax" type="number" inputmode="numeric" min="0" step="1000" placeholder="${esc(t('f_to'))} ${hi}" value="${esc(f.max)}" aria-label="${esc(t('f_to'))}"></div></div>
    <div class="fgrp"><span>${esc(t('f_sort'))}</span><select name="fsort">${[['def', 's_def'], ['asc', 's_asc'], ['desc', 's_desc']].map(([v, k]) => `<option value="${v}" ${f.sort === v ? 'selected' : ''}>${esc(t(k))}</option>`).join('')}</select></div>
    <div class="fgrp"><label class="fcheck"><input type="checkbox" name="fstock" ${f.stock ? 'checked' : ''}>${esc(t('f_stock'))}</label></div>
    <div class="fact"><button type="button" class="btn btn-ghost" data-freset>${esc(t('f_reset'))}</button></div></div>`;
}
const activeFilters = () => { const f = state.f; return f.sizes.size + (f.min !== '' || f.max !== '' ? 1 : 0) + (f.sort !== 'def' ? 1 : 0) + (f.stock ? 1 : 0); };
function renderCatalog() {
  renderChips();
  const nAct = activeFilters(), fc = $('#fCount'); fc.hidden = !nAct; fc.textContent = nAct;
  let any = false;
  $('#rows').innerHTML = cats.filter((c) => state.cat === 'all' || c.id === state.cat).map((c) => {
    let list = products.filter((p) => p.cat === c.id && matches(p));
    if (!list.length) return '';
    any = true;
    if (state.f.sort !== 'def') list = [...list].sort((a, b) => (state.f.sort === 'asc' ? a.price - b.price : b.price - a.price));
    return `<section class="row" id="cat-${esc(c.id)}"><div class="row-head"><h3>${esc(cName(c))}<small>${list.length}</small></h3>
      <div class="row-ctrl"><button class="arrow" data-dir="-1" aria-label="${esc(t('scroll_l'))}">←</button><button class="arrow" data-dir="1" aria-label="${esc(t('scroll_r'))}">→</button></div></div>
      <div class="rail" tabindex="-1">${list.map(cardHTML).join('')}</div><div class="rail-bar"><i></i></div></section>`;
  }).join('');
  const nr = $('#noResults'); nr.hidden = any; nr.textContent = t(state.fav && !favs.size ? 'fav_empty' : 'no_results');
  $$('.rail').forEach(initRail);
  observeReveal();
}
$('#chips').addEventListener('click', (e) => {
  if (e.target.closest('[data-favchip]')) { state.fav = !state.fav; if (state.fav) state.cat = 'all'; return renderCatalog(); }
  const c = e.target.closest('[data-chip]'); if (!c) return;
  state.cat = c.dataset.chip; state.fav = false; renderCatalog();
});
let st; $('#search').addEventListener('input', (e) => { clearTimeout(st); st = setTimeout(() => { state.q = e.target.value; renderCatalog(); }, 160); });
/* фильтры: размер, цена, сортировка */
const fPanel = $('#fPanel'), fpIn = $('#fPanelIn'); fPanel.inert = true;
$('#fToggle').onclick = () => { const o = fPanel.classList.toggle('open'); fPanel.inert = !o; $('#fToggle').setAttribute('aria-expanded', o); };
fpIn.addEventListener('click', (e) => {
  const z = e.target.closest('[data-fsize]');
  if (z) { const v = z.dataset.fsize; state.f.sizes.has(v) ? state.f.sizes.delete(v) : state.f.sizes.add(v); z.classList.toggle('on'); return renderCatalog(); }
  if (e.target.closest('[data-freset]')) { state.f = newF(); renderFilters(); renderCatalog(); }
});
let ft; fpIn.addEventListener('input', (e) => {
  if (!e.target.matches('[name=fmin],[name=fmax]')) return;
  clearTimeout(ft); ft = setTimeout(() => { state.f.min = fpIn.querySelector('[name=fmin]').value; state.f.max = fpIn.querySelector('[name=fmax]').value; renderCatalog(); }, 350);
});
fpIn.addEventListener('change', (e) => {
  if (e.target.matches('[name=fsort]')) { state.f.sort = e.target.value; renderCatalog(); }
  if (e.target.matches('[name=fstock]')) { state.f.stock = e.target.checked; renderCatalog(); }
});
$('#openFav').onclick = () => { state.fav = !state.fav; if (state.fav) state.cat = 'all'; renderCatalog(); if (state.fav) $('#catalog').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' }); };

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
/* таблица размеров: значения по умолчанию можно заменить в админке (Настройки → Таблица размеров) */
const SC = {
  tops: { key: 'sizeTops', cols: ['c_size', 'c_chest', 'c_waist', 'c_len'], rows: [['S', '88–94', '74–80', '68'], ['M', '94–100', '80–86', '70'], ['L', '100–106', '86–92', '72'], ['XL', '106–112', '92–98', '74'], ['XXL', '112–118', '98–104', '76']] },
  pants: { key: 'sizePants', cols: ['c_size', 'c_waist', 'c_hips', 'c_inseam'], rows: [['30', '76–79', '96–99', '81'], ['32', '80–83', '100–103', '82'], ['34', '84–87', '104–107', '82'], ['36', '88–91', '108–111', '83'], ['38', '92–95', '112–115', '83']] },
  shoes: { key: 'sizeShoes', cols: ['c_size', 'c_foot', 'c_us'], rows: [['40', '25.5', '7.5'], ['41', '26.5', '8.5'], ['42', '27.0', '9'], ['43', '27.5', '9.5'], ['44', '28.5', '10.5'], ['45', '29.0', '11']] },
};
const sizeGroup = (p) => ({ tee: 'tops', polo: 'tops', hoodie: 'tops', jacket: 'tops', coat: 'tops', pants: 'pants', shoe: 'shoes', sneaker: 'shoes' }[p.shape] || 'tops');
function showSizeChart(p) {
  const g = SC[sizeGroup(p)];
  const custom = String(settings[g.key] || '').split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((r) => r.length >= 2 && r[0]);
  const rows = custom.length ? custom : g.rows, note = (isUz() && settings.sizeNoteUz) || settings.sizeNote || '';
  const w = document.createElement('div'); w.className = 'sc-wrap';
  w.innerHTML = `<div class="sc-box" role="dialog" aria-modal="true"><button class="sc-x" data-sc-x aria-label="${esc(t('close'))}">✕</button><h3>${esc(t('size_chart'))}</h3><p>${esc(t('sc_tip'))}</p>
    <div class="sc-scroll"><table class="sc-table"><thead><tr>${g.cols.map((c) => `<th>${esc(t(c))}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr class="${r[0] === state.size ? 'me' : ''}">${g.cols.map((_, i) => `<td>${esc(r[i] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    ${note ? `<p class="sc-note">${esc(note)}</p>` : ''}</div>`;
  panel.appendChild(w); track('size_chart', { item_id: p.id });
}
function openProduct(id, { push = true, keep = false } = {}) {
  const p = byId(id); if (!p) return;
  state.current = p;
  if (!keep) { state.size = (p.sizes || []).length === 1 ? p.sizes[0] : ''; state.qty = 1; }
  const name = pName(p), desc = pDesc(p), color = /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#b7a48d';
  const imgs = p.images || [], low = p.stock != null && p.stock > 0 && p.stock <= lowAt, fav = favs.has(p.id);
  panel.innerHTML = `
    <button class="pm-close" data-close aria-label="${esc(t('close'))}">✕</button>
    <div class="pm-tools">
      <button type="button" data-fav="${esc(p.id)}" class="${fav ? 'on' : ''}" aria-label="${esc(t(fav ? 'fav_del' : 'fav_add'))}">${HEART}</button>
      <button type="button" data-share aria-label="${esc(t('share'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6"/></svg></button>
    </div>
    <div class="pm-gallery">
      <div class="pm-stage" id="pmStage">${imgs[0] ? `<img class="main" src="${esc(imgs[0])}" alt="${esc(name)}">` : garment(p.shape, p.color)}</div>
      ${imgs.length > 1 ? `<div class="pm-thumbs">${imgs.map((x, i) => `<button class="${i ? '' : 'on'}" data-img="${i}" aria-label="${esc(t('photo_n', { n: i + 1 }))}"><img src="${esc(thumbOf(x))}" ${thumbOf(x) !== x ? `data-full="${esc(x)}"` : ''} alt=""></button>`).join('')}</div>` : '<div></div>'}
    </div>
    <div class="pm-info">
      <div class="pm-meta"><span>${esc(cName(catOf(p.cat)))}</span>${p.tag ? `<span class="tag" style="position:static">${esc(p.tag)}</span>` : ''}</div>
      <h2 id="pmTitle">${esc(name)}</h2>
      <div class="pm-price">${p.oldPrice ? `<s>${money(p.oldPrice)}</s>` : ''}${money(p.price)}</div>
      ${p.colorName ? `<div class="pm-meta"><i class="dot" style="--c:${color}"></i>${esc(t('pm_color'))}: ${esc(p.colorName)}</div>` : ''}
      ${low && p.inStock !== false ? `<div class="pm-low">${esc(t('low_stock', { n: p.stock }))}</div>` : ''}
      ${desc ? `<p class="pm-desc">${esc(desc)}</p>` : ''}
      ${(p.sizes || []).length ? `<div><div class="pm-label"><span>${esc(t('size_word'))}</span><button type="button" class="link-btn" data-sc>${esc(t('size_chart'))}</button></div><div class="sizes" id="sizes" role="radiogroup" aria-label="${esc(t('size_word'))}">${p.sizes.map((x) => `<button class="size ${state.size === x ? 'on' : ''}" role="radio" aria-checked="${state.size === x}" data-size="${esc(x)}">${esc(x)}</button>`).join('')}</div></div>` : ''}
      ${p.inStock === false ? `<p class="stock-no">${esc(t('pm_nostock'))}</p>` : `<div class="pm-buy"><div class="qty" aria-label="${esc(t('qty'))}"><button data-q="-1" aria-label="${esc(t('less'))}">−</button><span id="pmQty">${state.qty}</span><button data-q="1" aria-label="${esc(t('more'))}">+</button></div><button class="btn btn-primary" id="pmAdd">${esc(t('add_cart'))}</button></div>`}
    </div>`;
  if (!keep) {
    lastFocus = document.activeElement;
    pm.classList.add('open'); pm.setAttribute('aria-hidden', 'false'); document.body.classList.add('lock');
    if (push) history.replaceState(null, '', '#p-' + p.id);
    setTimeout(() => $('.pm-close', panel)?.focus({ preventScroll: true }), 60);
    track('view_item', { item_id: p.id, item_name: p.name, price: p.price }); pageview('/p/' + encodeURIComponent(p.id), p.name);
  }
}
function closeProduct() {
  if (!pm.classList.contains('open')) return;
  pm.classList.remove('open'); pm.setAttribute('aria-hidden', 'true');
  if (!$('#drawer').classList.contains('open')) document.body.classList.remove('lock');
  if (location.hash.startsWith('#p-')) history.replaceState(null, '', location.pathname + location.search + '#catalog');
  lastFocus?.focus?.({ preventScroll: true });
}
pm.addEventListener('click', (e) => {
  if (e.target.closest('[data-sc-x]') || (e.target.classList && e.target.classList.contains('sc-wrap'))) return $('.sc-wrap', panel)?.remove();
  if (e.target.closest('[data-sc]')) return showSizeChart(state.current);
  if (e.target.closest('[data-close]')) return closeProduct();
  if (e.target.closest('[data-share]')) {
    const p = state.current, url = `${location.origin}/p/${encodeURIComponent(p.id)}`;
    track('share', { item_id: p.id });
    if (navigator.share) navigator.share({ title: pName(p), text: `${pName(p)} — ${money(p.price)}`, url }).catch(() => {});
    else (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast(t('link_copied')), () => prompt(t('share'), url));
    return;
  }
  const tb = e.target.closest('[data-img]');
  if (tb) {
    $$('.pm-thumbs button', pm).forEach((b) => b.classList.toggle('on', b === tb));
    const stg = $('#pmStage'); stg.innerHTML = `<img class="main" src="${esc(state.current.images[+tb.dataset.img])}" alt="${esc(pName(state.current))}">`;
  }
  const s = e.target.closest('[data-size]');
  if (s) { state.size = s.dataset.size; $$('.size', pm).forEach((b) => { const on = b === s; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); }); }
  const q = e.target.closest('[data-q]');
  if (q) { state.qty = Math.max(1, Math.min(maxQty(state.current), state.qty + Number(q.dataset.q))); $('#pmQty').textContent = state.qty; }
  if (e.target.closest('#pmAdd')) {
    const p = state.current;
    if ((p.sizes || []).length && !state.size) { const z = $('#sizes'); z.classList.remove('shake'); void z.offsetWidth; z.classList.add('shake'); toast(t('pick_size')); return; }
    const src = $('.pm-stage img, .pm-stage svg', pm) || e.target;
    addToCart(p.id, state.size, state.qty, src);
    setTimeout(closeProduct, 120);
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if ($('.lb')) return $('.lb').remove(); if ($('.sc-wrap')) return $('.sc-wrap').remove(); if ($('#drawer').classList.contains('open')) closeCart(); else if (pm.classList.contains('open')) closeProduct(); else setMenu(false); }
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
  const fb = e.target.closest('[data-fav]');
  if (fb) { e.stopPropagation(); return toggleFav(fb.dataset.fav, fb); }
  const lg = e.target.closest('[data-lang]');
  if (lg || e.target.closest('#langBtn')) { e.stopPropagation(); return switchLang(); }
  const lb = e.target.closest('[data-lb]');
  if (lb) { const o = document.createElement('div'); o.className = 'lb'; o.innerHTML = `<img src="${esc(lb.dataset.lb)}" alt="">`; o.onclick = () => o.remove(); document.body.appendChild(o); return; }
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
function routeHash() {
  const pp = location.pathname.match(/^\/p\/([^/]+)\/?$/);   // ссылка вида /p/ID из Telegram или Instagram
  if (pp) return openProduct(decodeURIComponent(pp[1]), { push: true });
  const m = location.hash.match(/^#p-(.+)$/); if (m) openProduct(decodeURIComponent(m[1]), { push: false });
}
addEventListener('hashchange', () => { if (location.hash.startsWith('#p-')) routeHash(); else if (pm.classList.contains('open')) closeProduct(); });

/* ---------- корзина ---------- */
const drawer = $('#drawer'), overlay = $('#overlay');
const cartCount = () => state.cart.reduce((s, i) => s + i.qty, 0);
const cartTotal = () => state.cart.reduce((s, i) => s + (byId(i.id)?.price || 0) * i.qty, 0);
const keyOf = (i) => i.id + '|' + i.size;
function saveCart() { try { localStorage.setItem('velmont-cart', JSON.stringify(state.cart)); } catch {} if (promo.code) clearPromo(); renderCart(); }
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
      <div class="cart-thumb">${media(p, '', true)}</div>
      <div><h4>${esc(pName(p))}</h4><p>${[i.size && esc(t('size_word')) + ' ' + esc(i.size), esc(p.colorName)].filter(Boolean).join(' · ')}</p>
        <div class="qty"><button data-cq="-1" aria-label="${esc(t('less'))}">−</button><span>${i.qty}</span><button data-cq="1" aria-label="${esc(t('more'))}">+</button></div></div>
      <div class="sum"><span>${money(p.price * i.qty)}</span><button class="remove" data-rm>${esc(t('remove'))}</button></div></div>`;
  }).join('');
  const total = cartTotal();
  tween($('#cartTotal'), shownTotal, total); shownTotal = total;
  updateCheckoutTotals();
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
  const cap = maxQty(p);
  if (ex) ex.qty = Math.min(cap, ex.qty + qty); else state.cart.push({ id, size, qty: Math.min(cap, qty) });
  saveCart(); fly(srcEl, p); track('add_to_cart', { item_id: id, item_name: p.name, price: p.price, quantity: qty });
  toast(t('in_cart', { name: pName(p) + (size ? ' · ' + size : '') }));
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
if (paused) { const tb = $('#toCheckout'); tb.disabled = true; tb.querySelector('span').textContent = t('paused'); }
$('#toCheckout').onclick = () => { resetOrderBtn(); updateCheckoutTotals(); $('#orderError').hidden = true; track('begin_checkout', { value: totals().total, currency: 'UZS' }); setView('checkout'); setTimeout(() => $('#viewCheckout [name=name]').focus(), 50); };
$('#backToCart').onclick = () => setView('cart');
$('#cartList').addEventListener('click', (e) => {
  const row = e.target.closest('.cart-item'); if (!row) return;
  const item = state.cart.find((i) => keyOf(i) === row.dataset.key); if (!item) return;
  const q = e.target.closest('[data-cq]');
  if (q) { item.qty += Number(q.dataset.cq); if (item.qty <= 0) return removeRow(row, item); item.qty = Math.min(item.qty, maxQty(byId(item.id))); saveCart(); }
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

/* --- промокод и способ оплаты --- */
const promo = { code: '', discount: 0 }, pay = { method: 'cod' };
const totals = () => { const sub = cartTotal(), disc = Math.min(promo.discount, sub); return { sub, disc, total: sub - disc }; };
function updateCheckoutTotals() {
  const { sub, disc, total } = totals();
  $('#ckSub').hidden = $('#ckDisc').hidden = !disc;
  $('#ckSubV').textContent = money(sub); $('#ckDiscV').textContent = '−' + money(disc); $('#checkoutTotal').textContent = money(total);
  $('#fineText').textContent = t(pay.method === 'cod' ? 'fine_cod' : 'fine_online');
}
const promoHint = (m, c = '') => { const h = $('#promoHint'); h.className = 'hint ' + c; h.textContent = m; };
function clearPromo() { promo.code = ''; promo.discount = 0; form.promo.value = ''; form.promo.readOnly = false; $('#promoBox').classList.remove('on'); $('#promoBtn').textContent = t('promo_apply'); promoHint(''); updateCheckoutTotals(); }
const promoErr = (j) => (({ notfound: () => t('promo_err_notfound'), min: () => t('promo_err_min', { n: money(j.min) }), phone: () => t('promo_err_phone'), first: () => t('promo_err_first') })[j.code]?.() || j.error || t('promo_err_notfound'));
form.promo.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#promoBtn').click(); } });
$('#promoBtn').onclick = async () => {
  if (promo.code) return clearPromo();
  const code = form.promo.value.trim().toUpperCase(); if (!code) return promoHint(t('promo_enter'), 'bad');
  const btn = $('#promoBtn'); btn.disabled = true;
  try {
    const r = await fetch('api/promo/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, items: state.cart.map(({ id, qty }) => ({ id, qty })), phoneToken: verif.token, phone: form.phone.value }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return promoHint(promoErr(j), 'bad');
    promo.code = j.code; promo.discount = j.discount; form.promo.value = j.code; form.promo.readOnly = true;
    $('#promoBox').classList.add('on'); btn.textContent = t('promo_remove'); promoHint(t('promo_ok', { n: money(j.discount) }), 'ok'); updateCheckoutTotals(); track('promo_applied', { coupon: j.code });
  } catch { promoHint(t('err_noserver'), 'bad'); } finally { btn.disabled = false; }
};
function renderPay() {
  const list = [['cod', t('pay_cod')], ...(payOpts.payme ? [['payme', 'Payme']] : []), ...(payOpts.click ? [['click', 'Click']] : [])];
  $('#payBox').hidden = list.length < 2; if (list.length < 2) pay.method = 'cod';
  $('#payOpts').innerHTML = list.map(([id, n]) => `<button type="button" class="pay-opt ${pay.method === id ? 'on' : ''}" role="radio" aria-checked="${pay.method === id}" data-pay="${id}">${esc(n)}</button>`).join('');
}
$('#payOpts').addEventListener('click', (e) => { const b = e.target.closest('[data-pay]'); if (!b) return; pay.method = b.dataset.pay; renderPay(); updateCheckoutTotals(); });

/* --- подтверждение номера через Telegram и адрес на карте --- */
const verif = { token: '', phone: '' }, geo = { lat: null, lon: null, address: '' };
const tgBtn = $('#tgVerify'), tgHint = $('#tgHint');
let tgTimer = null;
if (verifyRequired) {
  tgBtn.hidden = false; form.phone.readOnly = true; form.phone.placeholder = t('tg_ph');
  tgBtn.onclick = async () => {
    clearInterval(tgTimer); tgBtn.disabled = true; tgHint.className = 'hint'; tgHint.textContent = t('tg_opening');
    let w = null; try { w = window.open('', '_blank'); } catch {}
    try {
      const r = await fetch('api/tg/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang: getLang() }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || t('tg_fail'));
      if (w) w.location = j.link;
      tgHint.innerHTML = t('tg_steps', { link: esc(j.link) });
      const t0 = Date.now();
      tgTimer = setInterval(async () => {
        if (Date.now() - t0 > 10 * 60e3) { clearInterval(tgTimer); tgBtn.disabled = false; tgHint.textContent = t('tg_timeout'); return; }
        try {
          const s = await (await fetch('api/tg/status?sid=' + j.sid)).json();
          if (s.expired) { clearInterval(tgTimer); tgBtn.disabled = false; tgHint.textContent = t('tg_timeout'); }
          if (s.verified) {
            clearInterval(tgTimer); verif.token = s.token; verif.phone = s.phone; form.phone.value = s.phone; form.phone.closest('.field').classList.remove('bad');
            tgBtn.hidden = true; tgHint.className = 'hint ok'; tgHint.textContent = t('tg_verified'); toast(t('tg_verified_toast')); track('phone_verified');
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
    err.textContent = form.name.value.trim().length < 2 ? t('err_name') : (verifyRequired && !verif.token) ? t('err_phone_tg') : !verifyRequired && form.phone.value.replace(/\D/g, '').length < 7 ? t('err_phone') : t('err_addr');
    err.hidden = false; return;
  }
  const data = { name: form.name.value, phone: form.phone.value, phoneToken: verif.token, location: { lat: geo.lat, lon: geo.lon }, address: [geo.address, form.address2.value.trim()].filter(Boolean).join(', '), comment: form.comment.value, items: state.cart.map(({ id, size, qty }) => ({ id, size, qty })), promo: promo.code, lang: getLang(), payment: pay.method };
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
    if (!noServer) { j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.code ? promoErr(j) : (j.error || t('err_send'))); }
    else if (!settings.telegram) throw new Error(t('err_noserver'));
    await minRide;
    btn.classList.replace('sending', 'sent'); ok = true;
    await sleep(1000);
    if (!noServer && j.id && j.key) saveMyOrder(j.id, j.key);
    orderDone(noServer ? '' : j.id, !noServer && j.telegram, text, noServer ? {} : j);
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
  const tt = totals(); if (tt.disc) lines.push('', `Промокод ${promo.code}: −${money(tt.disc)}`);
  lines.push('', 'Итого: ' + money(tt.total));
  return lines.filter((x, i) => x || i === 1 || i >= 6).join('\n');
}
function orderDone(id, tgOk, text, j = {}) {
  const total = j.total ?? totals().total, payName = pay.method === 'click' ? 'Click' : 'Payme';
  if (id) track('purchase', { transaction_id: id, value: total, currency: 'UZS' });
  state.cart = []; saveCart(); clearPromo(); pay.method = 'cod'; renderPay(); updateCheckoutTotals();
  const handle = settings.telegram ? '@' + settings.telegram : '';
  const num = id ? t('order_num', { id }) : '';
  const tg = $('#doneTg'), payBtn = $('#donePay');
  if (settings.telegram) {   // кнопка всегда: заказ уходит боту сам, а покупатель может отправить его ещё и на ваш аккаунт
    $('#doneText').textContent = num + (tgOk ? t('done_tg_ok', { h: handle }) : t('done_tg_no', { h: handle }));
    tg.href = `https://t.me/${settings.telegram}?text=${encodeURIComponent((id ? `Заказ ${id}\n` : '') + text)}`;
    tg.textContent = t('done_tg_btn', { h: handle }); tg.hidden = false;
  } else {
    $('#doneText').textContent = num + (tgOk ? t('done_sent') : t('done_got')); tg.hidden = true;
  }
  if (j.payUrl) { payBtn.href = j.payUrl; payBtn.textContent = t('pay_with', { n: payName }); payBtn.hidden = false; $('#doneText').textContent = num + t('done_pay'); }
  else { payBtn.hidden = true; if (verifyRequired && id) $('#doneText').textContent += ' ' + t('done_bot'); }
  setView('done'); form.comment.value = ''; form.address2.value = ''; form.address2.hidden = true; Object.assign(geo, { lat: null, lon: null, address: '' }); $('#pickMapText').textContent = t('pick_map'); $('#pickMap').classList.remove('done');
  requestAnimationFrame(() => confetti($('#confetti'), getComputedStyle(document.documentElement).getPropertyValue('--sand').trim() || '#d8c3a0'));
  bumpCart();
}

/* ---------- мои заказы и статус доставки ---------- */
const myOrders = () => { try { const v = JSON.parse(localStorage.getItem('velmont-orders') || '[]'); return Array.isArray(v) ? v.filter((o) => o && o.id && o.key) : []; } catch { return []; } };
function saveMyOrder(id, key) { try { localStorage.setItem('velmont-orders', JSON.stringify([{ id, key, date: Date.now() }, ...myOrders().filter((o) => o.id !== id)].slice(0, 10))); } catch {} syncTrackBtn(); }
function syncTrackBtn() { $('#openTrack').hidden = !(myOrders().length || verifyRequired); }
const steps = () => [[t('st_new'), t('st_new_n')], [t('st_ship'), t('st_ship_n')], [t('st_done'), t('st_done_n')]];
const lastStatus = {};
async function loadTrack() {
  const list = myOrders(), box = $('#trackList');
  if (!list.length) { box.innerHTML = `<p class="empty">${esc(t('no_orders'))}</p>`; return; }
  let data = [];
  try { const r = await fetch('api/track?o=' + list.map((o) => o.id + ':' + o.key).join(','), { cache: 'no-store' }); data = (await r.json()).orders || []; } catch { if (!box.children.length) box.innerHTML = `<p class="empty">${esc(t('trk_fail'))}</p>`; return; }
  if (!data.length) { box.innerHTML = `<p class="empty">${esc(t('trk_none'))}</p>`; return; }
  const ST = steps();
  box.innerHTML = data.map((o) => {
    const idx = { new: 0, shipping: 1, done: 2 }[o.status] ?? 0, changed = lastStatus[o.id] !== undefined && lastStatus[o.id] !== o.status;
    lastStatus[o.id] = o.status;
    const payRow = o.pay === 'pending' && o.payUrl ? `<div class="trk-pay"><span class="pill">${esc(t('pay_pending'))}</span><a class="btn btn-primary small" href="${esc(o.payUrl)}">${esc(t('pay_now'))}</a></div>` : o.pay === 'paid' ? `<div class="trk-pay"><span class="pill paid">${esc(t('pay_paid'))}</span></div>` : '';
    return `<div class="trk${changed ? ' flash' : ''}"><div class="trk-head"><b>${esc(o.id)}</b><span>${new Date(o.date).toLocaleDateString(isUz() ? 'uz-UZ' : 'ru-RU', { day: 'numeric', month: 'long' })} · ${money(o.total)}</span></div>
      <ol class="steps">${ST.map((x, i) => `<li class="${idx === 2 || i < idx ? 'ok' : i === idx ? 'cur' : ''}"><i></i><b>${esc(x[0])}</b></li>`).join('')}</ol>
      <p class="trk-note">${esc(ST[idx][1])}</p>${o.trackNo ? `<p class="trk-no">${esc(t('bts_no'))}: <b>${esc(o.trackNo)}</b></p>` : ''}${payRow}</div>`;
  }).join('');
}
/* найти заказы по номеру, подтверждённому через Telegram (если очистили браузер или зашли с другого устройства) */
(function findOrders() {
  if (!verifyRequired) return;
  $('#findOrders').hidden = false;
  const btn = $('#findByPhone'), hint = $('#findHint'); let timer = null;
  btn.onclick = async () => {
    clearInterval(timer); btn.disabled = true; hint.className = 'hint'; hint.textContent = t('tg_opening');
    let w = null; try { w = window.open('', '_blank'); } catch {}
    const fail = (m) => { clearInterval(timer); btn.disabled = false; hint.className = 'hint bad'; hint.textContent = m; };
    try {
      const r = await fetch('api/tg/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang: getLang() }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || t('tg_fail'));
      if (w) w.location = j.link;
      hint.innerHTML = t('tg_steps', { link: esc(j.link) });
      const t0 = Date.now();
      timer = setInterval(async () => {
        if (Date.now() - t0 > 10 * 60e3) return fail(t('tg_timeout'));
        try {
          const s = await (await fetch('api/tg/status?sid=' + j.sid)).json();
          if (s.expired) return fail(t('tg_timeout'));
          if (!s.verified) return;
          clearInterval(timer);
          const f = await fetch('api/track/phone?token=' + encodeURIComponent(s.token), { cache: 'no-store' });
          const fj = await f.json(); if (!f.ok) throw new Error(fj.error || t('orders_fail'));
          const found = fj.orders || [];
          try { const have = myOrders(); const merged = [...found.map((o) => ({ id: o.id, key: o.key, date: Date.parse(o.date) || Date.now() })), ...have.filter((o) => !found.some((x) => x.id === o.id))]; localStorage.setItem('velmont-orders', JSON.stringify(merged.slice(0, 10))); } catch {}
          btn.disabled = false; syncTrackBtn(); loadTrack();
          hint.className = found.length ? 'hint ok' : 'hint bad';
          hint.textContent = found.length ? t('orders_found') : t('orders_none');
        } catch (e) { fail(e.message || t('orders_fail')); }
      }, 2000);
    } catch (e) { if (w) w.close(); fail(e.message); }
  };
})();
$('#openTrack').onclick = () => { openCart(); setView('track'); };
$('#backFromTrack').onclick = () => setView('cart');
$('#doneTrack').onclick = () => setView('track');
syncTrackBtn();

/* ---------- уведомление ---------- */
let tt; function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 2400); }

/* ---------- главный экран: плавающие карточки ---------- */
function renderHeroCards() {
  const feat = products.filter((p) => p.inStock !== false).slice(0, 3);
  $('#heroStack').innerHTML = feat.map((p) => `<div class="hero-card glass">${media(p, '', true)}<span>${esc(pName(p))}</span></div>`).join('');
}
(function hero() {
  renderHeroCards();
  if (!fine || reduce) return;
  const stack = $('#heroStack');
  $('#home').addEventListener('pointermove', (e) => {
    const x = e.clientX / innerWidth - .5, y = e.clientY / innerHeight - .5;
    $$('.hero-card', stack).forEach((c, i) => { const k = (i + 1) * 14; c.style.transform = `translate(${x * k}px,${y * k}px) rotate(var(--r))`; });
  });
})();

/* ---------- отзывы ---------- */
function renderReviews() {
  $('#reviews').hidden = !reviews.length;
  $('#revRail').innerHTML = reviews.map((r) => {
    const th = thumbOf(r.photo || '');
    return `<article class="rev">${r.photo ? `<div class="rev-photo" data-lb="${esc(r.photo)}"><img src="${esc(th)}" ${th !== r.photo ? `data-full="${esc(r.photo)}"` : ''} alt="${esc(r.name)}" loading="lazy" decoding="async"></div>` : ''}
      <div class="rev-body"><div class="stars" role="img" aria-label="${r.rating}/5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= r.rating ? 'on' : ''}">★</i>`).join('')}</div>
      <p class="rev-text">${esc(r.text)}</p><p class="rev-who"><b>${esc(r.name)}</b>${r.city ? ' · ' + esc(r.city) : ''}</p></div></article>`;
  }).join('');
}

/* ---------- язык: русский / узбекский ---------- */
function applyLang() {
  applyStatic(); applySettingsText();
  $('#langLabel').textContent = t('lang_to');
  if (geo.lat) $('#pickMapText').textContent = geo.address;
  if (paused) $('#toCheckout span').textContent = t('paused');
  if (verifyRequired && !verif.token) form.phone.placeholder = t('tg_ph');
  if (promo.code) $('#promoBtn').textContent = t('promo_remove');
  renderContacts(); renderMenu(); renderFilters(); renderCatalog(); renderCart(); renderReviews(); renderPay(); renderHeroCards(); syncFav(); syncRoll(); resplit();
  if (pm.classList.contains('open') && state.current) openProduct(state.current.id, { keep: true });
  if (!$('#viewTrack').hidden) loadTrack();
  document.title = t('title');
}
function switchLang() {
  setLang(isUz() ? 'ru' : 'uz');
  const b = $('#langBtn'); b.classList.remove('swap'); void b.offsetWidth; b.classList.add('swap');
  applyLang(); track('lang_switch', { lang: getLang() });
}

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
['home', 'catalog', 'about', 'reviews', 'contact'].forEach((id) => spy.observe($('#' + id)));

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
applyLang();
routeHash();
initFx();
