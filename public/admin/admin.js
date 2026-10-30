import { garment, SHAPE_OPTIONS } from '../js/art.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' сум';
const app = $('#app');
const S = { tab: 'dashboard', ofilter: 'all', oq: '', tgTarget: '', catalog: { categories: [], products: [] }, settings: {}, orders: [], tg: false, q: '', fcat: 'all', promos: [], reviews: [], status: {}, period: '7', known: new Set(), sound: localStorage.getItem('velmont-sound') !== '0' };

let tt;
function toast(msg, err) { const t = $('#toast'); t.textContent = msg; t.classList.toggle('err', !!err); t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 2600); }

async function api(url, method = 'GET', body) {
  const r = await fetch(url, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && url !== '/api/login') { renderLogin(); throw new Error('Нужен вход'); }
  if (!r.ok) throw new Error(j.error || 'Ошибка ' + r.status);
  return j;
}

/* ---------- вход ---------- */
function renderLogin(msg) {
  clearInterval(pollT);
  app.innerHTML = `<div class="login"><form class="login-box" id="lf">
    <h1>VELMONT</h1><p class="muted">Вход в управление магазином</p>
    <label class="field"><span>Логин</span><input type="text" name="username" autocomplete="username" autocapitalize="off" autofocus required></label>
    <label class="field"><span>Пароль</span><input type="password" name="password" autocomplete="current-password" required></label>
    <p class="bad" id="lerr" role="alert" style="margin-bottom:12px">${esc(msg || '')}</p>
    <button class="btn primary" style="width:100%">Войти</button></form></div>`;
  $('#lf').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/api/login', 'POST', { username: e.target.username.value, password: e.target.password.value }); await boot(); }
    catch (x) { $('#lerr').textContent = x.message; e.target.password.select(); }
  };
}

/* ---------- старт ---------- */
async function boot() {
  let me;
  try { me = await api('/api/me'); } catch { return renderLogin('Сервер недоступен. Запустите его командой: npm start'); }
  if (!me.admin) return renderLogin(me.configured ? '' : 'Пароль не задан. Впишите ADMIN_PASSWORD в файл .env и перезапустите сервер.');
  const [c, s, o, st, pr, rv] = await Promise.all([api('/api/catalog'), api('/api/settings'), api('/api/admin/orders'), api('/api/admin/status'), api('/api/admin/promos'), api('/api/admin/reviews')]);
  S.catalog = c; S.settings = s; S.orders = o.orders; S.tg = st.telegram; S.tgTarget = st.target || ''; S.status = st; S.promos = pr.promos; S.reviews = rv.reviews;
  S.known = new Set(o.orders.map((x) => x.id));
  renderShell(); startPolling();
}
function renderShell() {
  const newOrders = S.orders.filter((o) => o.status === 'new').length;
  const av = S.settings.avatar ? `<img src="/${esc(S.settings.avatar)}" alt="">` : `<span>${esc((S.settings.adminName || 'V').trim().charAt(0).toUpperCase())}</span>`;
  app.innerHTML = `
    <header class="top"><div class="brand">VELMONT<small>управление</small></div>
      <div class="top-actions"><button class="me" id="meBtn" aria-label="Профиль и настройки"><i class="ava">${av}</i><b>${esc(S.settings.adminName || 'Админ')}</b></button><button class="btn small" id="soundBtn" title="Звук при новом заказе" aria-label="Звук при новом заказе">${S.sound ? '🔔' : '🔕'}</button><a class="btn small" href="/" target="_blank" rel="noopener">Открыть сайт</a><button class="btn small" id="logout">Выйти</button></div></header>
    <nav class="tabs" role="tablist">
      ${[['dashboard', 'Обзор'], ['products', 'Товары'], ['categories', 'Каталоги'], ['orders', 'Заказы'], ['promos', 'Промокоды'], ['reviews', 'Отзывы'], ['settings', 'Настройки']].map(([id, n]) => `<button class="tab ${S.tab === id ? 'on' : ''}" role="tab" data-tab="${id}">${n}${id === 'orders' && newOrders ? `<span class="n">${newOrders}</span>` : ''}</button>`).join('')}
    </nav><main id="view"></main>`;
  $('#meBtn').onclick = () => { S.tab = 'settings'; renderShell(); setTimeout(() => $('#profile')?.scrollIntoView({ behavior: 'smooth' }), 60); };
  $('#soundBtn').onclick = (e) => { S.sound = !S.sound; localStorage.setItem('velmont-sound', S.sound ? '1' : '0'); e.currentTarget.textContent = S.sound ? '🔔' : '🔕'; unlockAudio(); if (S.sound) beep(); toast(S.sound ? 'Звук включён: вы услышите новый заказ' : 'Звук выключен'); };
  $('#logout').onclick = async () => { await api('/api/logout', 'POST', {}); renderLogin(); };
  $$('[data-tab]').forEach((b) => (b.onclick = () => { S.tab = b.dataset.tab; renderShell(); }));
  ({ dashboard: viewDashboard, products: viewProducts, categories: viewCategories, orders: viewOrders, promos: viewPromos, reviews: viewReviews, settings: viewSettings })[S.tab]();
}

/* ---------- звук и опрос новых заказов ---------- */
let pollT, audio, titleT;
function unlockAudio() { try { audio ||= new (window.AudioContext || window.webkitAudioContext)(); audio.resume && audio.resume(); } catch {} }
addEventListener('pointerdown', unlockAudio, { once: true });
function beep() {
  if (!S.sound) return; unlockAudio(); if (!audio) return;
  const t = audio.currentTime;
  [[880, 0], [1175, .17], [1568, .34]].forEach(([f, d]) => {
    const o = audio.createOscillator(), g = audio.createGain(); o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0, t + d); g.gain.linearRampToValueAtTime(.28, t + d + .02); g.gain.exponentialRampToValueAtTime(.001, t + d + .32);
    o.connect(g).connect(audio.destination); o.start(t + d); o.stop(t + d + .34);
  });
}
function updateBadge() {
  const n = S.orders.filter((o) => o.status === 'new').length, b = $('[data-tab="orders"]'); if (!b) return;
  let sp = $('.n', b); if (n) { if (!sp) { sp = document.createElement('span'); sp.className = 'n'; b.appendChild(sp); } sp.textContent = n; } else if (sp) sp.remove();
}
function flashTitle(n) {
  const base = 'VELMONT — управление магазином'; clearInterval(titleT); let on = false;
  titleT = setInterval(() => { document.title = (on = !on) ? `🔔 Новых заказов: ${n}` : base; }, 1000);
  const stop = () => { clearInterval(titleT); document.title = base; removeEventListener('focus', stop); };
  addEventListener('focus', stop); if (document.hasFocus()) setTimeout(stop, 4000);
}
function startPolling() {
  clearInterval(pollT);
  pollT = setInterval(async () => {
    try {
      const o = await api('/api/admin/orders');
      const fresh = o.orders.filter((x) => !S.known.has(x.id)); S.orders = o.orders;
      if (!fresh.length) return;
      fresh.forEach((x) => S.known.add(x.id)); beep(); flashTitle(fresh.length);
      toast(`🛍 Новый заказ ${fresh[0].id} · ${fresh[0].name} · ${money(fresh[0].total)}`);
      const typing = document.activeElement && document.activeElement.closest && document.activeElement.closest('#view') && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
      if (['dashboard', 'orders'].includes(S.tab) && !typing && !$('.sheet')) renderShell(); else updateBadge();
    } catch {}
  }, 25000);
}

/* ---------- обзор ---------- */
const markBackup = () => localStorage.setItem('velmont-backup', String(Date.now()));
async function sendBackupTg(btn) {
  btn.disabled = true;
  try { await api('/api/admin/backup-telegram', 'POST', {}); S.status.lastBackup = Date.now(); toast('Копия отправлена в Telegram'); if (S.tab === 'dashboard') viewDashboard(); }
  catch (x) { toast(x.message, 1); } finally { btn.disabled = false; }
}
function banners() {
  const out = [];
  if (S.status.weakPassword) out.push(`<div class="hint warn">⚠ <b>Пароль админки слабый.</b> Смените ADMIN_PASSWORD на длинный (12+ символов, буквы разного регистра и цифры). Команда <code>npm run genpass</code> создаст надёжный. <button class="btn small" data-goset="1">Подробнее</button></div>`);
  const last = Math.max(S.status.lastBackup || 0, Number(localStorage.getItem('velmont-backup') || 0)), days = last ? Math.floor((Date.now() - last) / 864e5) : null;
  if (days === null || days >= 7) out.push(`<div class="hint">💾 <b>${days === null ? 'Резервной копии ещё не было.' : `Последняя копия была ${days} дн. назад.`}</b> Раз в неделю сохраняйте копию базы. <button class="btn small" id="backup">Скачать копию</button>${S.status.backupChat ? ' <button class="btn small" id="bkTg">Отправить в Telegram</button>' : ''}</div>`);
  return out.join('');
}
function statsCard() {
  const days = S.period === 'all' ? 'all' : Number(S.period), from = days === 'all' ? 0 : dayStart() - (days - 1) * 864e5;
  const L = S.orders.filter((o) => new Date(o.date).getTime() >= from);
  const sum = L.reduce((a, o) => a + (o.total || 0), 0), disc = L.reduce((a, o) => a + (o.discount || 0), 0);
  const online = L.filter((o) => o.payment && o.payment.status === 'paid').length, m = new Map();
  for (const o of L) for (const i of o.items) { const r = m.get(i.name) || { name: i.name, qty: 0, sum: 0 }; r.qty += i.qty; r.sum += i.price * i.qty; m.set(i.name, r); }
  const top = [...m.values()].sort((a, b) => b.qty - a.qty).slice(0, 5), mx = Math.max(1, ...top.map((x) => x.qty));
  return `<div class="card"><div class="switch-row"><h3>Статистика заказов</h3><div class="seg" style="margin:0">${[['7', '7 дней'], ['30', '30 дней'], ['all', 'Всё время']].map(([id, n]) => `<button class="chipbtn ${S.period === id ? 'on' : ''}" data-per="${id}">${n}</button>`).join('')}</div></div>
    <div class="stats" style="margin:14px 0">
      <div class="stat"><span>Заказов</span><b>${L.length}</b></div>
      <div class="stat"><span>На сумму</span><b>${money(sum)}</b></div>
      <div class="stat"><span>Средний чек</span><b>${L.length ? money(sum / L.length) : '—'}</b></div>
      <div class="stat"><span>Скидки по промокодам</span><b>${money(disc)}</b>${online ? `<small>${online} оплачено онлайн</small>` : ''}</div></div>
    <h3 style="font-size:15px;margin-bottom:6px">Популярные товары</h3>
    ${top.length ? top.map((x) => `<div class="toprow"><span>${esc(x.name)}</span><i style="--w:${Math.round((x.qty / mx) * 100)}%"></i><b>${x.qty} шт.</b><span class="muted">${money(x.sum)}</span></div>`).join('') : '<p class="muted">За этот период заказов пока нет.</p>'}</div>`;
}
const dayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
function saveSettingsNow(patch) { S.settings = { ...S.settings, ...patch }; return api('/api/admin/settings', 'PUT', S.settings).then((r) => (S.settings = r.settings)); }
function viewDashboard() {
  const v = $('#view'), O = S.orders, P = S.catalog.products;
  const today = O.filter((o) => new Date(o.date).getTime() >= dayStart());
  const sum = (l) => l.reduce((a, o) => a + (o.total || 0), 0);
  const newO = O.filter((o) => o.status === 'new');
  const out = P.filter((p) => p.inStock === false).length;
  const paused = S.settings.ordersPaused === '1';
  const hour = new Date().getHours(), hi = hour < 5 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';
  const av = S.settings.avatar ? `<img src="/${esc(S.settings.avatar)}" alt="">` : `<span>${esc((S.settings.adminName || 'V').trim().charAt(0).toUpperCase())}</span>`;
  const days = [...Array(7)].map((_, i) => { const t = dayStart() - (6 - i) * 864e5; const l = O.filter((o) => { const x = new Date(o.date).getTime(); return x >= t && x < t + 864e5; }); return { t, n: l.length, sum: sum(l) }; });
  const max = Math.max(1, ...days.map((d) => d.n));
  v.innerHTML = `${banners()}
    <div class="hello card"><i class="ava big">${av}</i><div><h2>${hi}, ${esc(S.settings.adminName || 'админ')}!</h2><p class="muted">${newO.length ? `У вас ${newO.length} ${newO.length === 1 ? 'новый заказ' : 'новых заказа(ов)'}, ждут ответа.` : 'Новых заказов нет. Спокойный день.'}</p></div></div>
    <div class="stats">
      <div class="stat"><span>Новые заказы</span><b data-n="${newO.length}">0</b></div>
      <div class="stat"><span>Заказов сегодня</span><b data-n="${today.length}">0</b></div>
      <div class="stat"><span>Выручка (выполненные)</span><b data-n="${sum(O.filter((o) => o.status === 'done'))}" data-m="1">0</b></div>
      <div class="stat"><span>Товаров на сайте</span><b data-n="${P.length}">0</b><small>${out ? out + ' нет в наличии' : 'всё в наличии'}</small></div>
    </div>
    <div class="card"><h3>Заказы за 7 дней</h3><div class="chart">${days.map((d) => `<div class="col" title="${money(d.sum)}"><i style="--h:${Math.round((d.n / max) * 100)}%"></i><b>${d.n}</b><span>${new Date(d.t).toLocaleDateString('ru-RU', { weekday: 'short' })}</span></div>`).join('')}</div></div>
    ${statsCard()}
    <div class="card"><div class="switch-row"><div><h3>Приём заказов</h3><p class="muted">${paused ? 'Сейчас приостановлен: покупатели видят сообщение и не могут оформить заказ.' : 'Открыт: покупатели могут оформлять заказы.'}</p></div>
      <label class="switch tog"><input type="checkbox" id="pauseTog" ${paused ? '' : 'checked'}><i></i></label></div></div>
    <div class="card"><h3>Быстрые действия</h3><div class="bar"><button class="btn" data-go="products">+ Новый товар</button><button class="btn" data-go="orders">Все заказы</button><button class="btn" id="copyLink">Скопировать ссылку на сайт</button><button class="btn" id="backup">Скачать резервную копию</button></div></div>
    ${O.length ? `<div class="card"><h3>Последние заказы</h3>${O.slice(0, 4).map((o) => `<div class="mini"><span><b>${esc(o.id)}</b> · ${esc(o.name)}</span><span>${money(o.total)} <i class="pill ${o.status === 'done' ? 'done' : o.status === 'shipping' ? 'ship' : 'new'}">${ST[o.status] || 'Новый'}</i></span></div>`).join('')}</div>` : ''}`;
  $$('[data-n]', v).forEach((el) => { const to = +el.dataset.n, m = el.dataset.m, t0 = performance.now(); (function f(t) { const k = Math.min(1, (t - t0) / 800), e = 1 - Math.pow(1 - k, 3); el.textContent = m ? money(to * e) : Math.round(to * e); if (k < 1) requestAnimationFrame(f); })(t0); });
  v.onclick = (e) => {
    const g = e.target.closest('[data-go]'); if (g) { S.tab = g.dataset.go; renderShell(); if (g.dataset.go === 'products') setTimeout(() => $('#add')?.click(), 50); }
    if (e.target.closest('#copyLink')) navigator.clipboard?.writeText(location.origin + '/').then(() => toast('Ссылка скопирована'), () => toast(location.origin + '/'));
    if (e.target.closest('#backup')) { markBackup(); location.href = '/api/admin/backup'; }
    if (e.target.closest('#bkTg')) sendBackupTg(e.target.closest('#bkTg'));
    const per = e.target.closest('[data-per]'); if (per) { S.period = per.dataset.per; viewDashboard(); }
    if (e.target.closest('[data-goset]')) { S.tab = 'settings'; renderShell(); }
  };
  $('#pauseTog').onchange = async (e) => {
    try { await saveSettingsNow({ ordersPaused: e.target.checked ? '' : '1' }); toast(e.target.checked ? 'Приём заказов открыт' : 'Приём заказов приостановлен'); viewDashboard(); }
    catch (x) { toast(x.message, 1); e.target.checked = !e.target.checked; }
  };
}

/* ---------- товары ---------- */
const catName = (id) => S.catalog.categories.find((c) => c.id === id)?.name || '—';
function viewProducts() {
  const v = $('#view');
  const list = () => S.catalog.products.filter((p) => (S.fcat === 'all' || p.cat === S.fcat) && (!S.q || (p.name + ' ' + p.type).toLowerCase().includes(S.q.toLowerCase())));
  v.innerHTML = `
    <div class="bar"><input type="search" id="q" placeholder="Поиск товара" value="${esc(S.q)}" aria-label="Поиск">
      <select id="fc" aria-label="Каталог"><option value="all">Все каталоги</option>${S.catalog.categories.map((c) => `<option value="${esc(c.id)}" ${S.fcat === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
    <div class="plist" id="plist"></div>
    <button class="btn primary fab" id="add">+ Добавить товар</button>`;
  const draw = () => {
    const l = list();
    $('#plist').innerHTML = l.length ? l.map((p) => `
      <div class="prow"><div class="thumb">${p.images?.[0] ? `<img src="/${esc(p.images[0])}" alt="">` : garment(p.shape, p.color)}</div>
        <div><h3>${esc(p.name)}</h3><p><span class="pill">${esc(catName(p.cat))}</span>${money(p.price)}${p.inStock === false ? ' <span class="pill off">нет в наличии</span>' : p.stock != null ? ` <span class="pill ${p.stock <= (Number(S.settings.lowStock) || 3) ? 'low' : ''}">ост. ${p.stock} шт.</span>` : ''}</p></div>
        <div class="acts"><button class="btn small" data-stock="${esc(p.id)}" title="Наличие">${p.inStock === false ? 'Вернуть в наличие' : 'Нет в наличии'}</button><button class="btn small" data-dup="${esc(p.id)}">Копия</button><button class="btn small" data-edit="${esc(p.id)}">Изменить</button><button class="btn small danger" data-del="${esc(p.id)}">Удалить</button></div></div>`).join('')
      : `<p class="empty">Товаров пока нет. Нажмите «Добавить товар».</p>`;
  };
  draw();
  $('#q').oninput = (e) => { S.q = e.target.value; draw(); };
  $('#fc').onchange = (e) => { S.fcat = e.target.value; draw(); };
  $('#add').onclick = () => editProduct();
  v.onclick = async (e) => {
    const ed = e.target.closest('[data-edit]'), dl = e.target.closest('[data-del]'), sk = e.target.closest('[data-stock]'), dp = e.target.closest('[data-dup]');
    if (sk || dp) {
      const p = S.catalog.products.find((x) => x.id === (sk || dp).dataset[sk ? 'stock' : 'dup']);
      try {
        if (sk) { const r = await api('/api/admin/products', 'POST', { ...p, inStock: p.inStock === false, stock: p.inStock === false && p.stock === 0 ? null : p.stock }); Object.assign(p, r.product); toast(p.inStock === false ? 'Отмечен: нет в наличии' : 'Снова в наличии'); }
        else { const { id, ...rest } = p; const r = await api('/api/admin/products', 'POST', { ...rest, name: p.name + ' (копия)' }); S.catalog.products.push(r.product); toast('Копия создана. Нажмите «Изменить», чтобы поправить'); }
        draw();
      } catch (x) { toast(x.message, 1); }
      return;
    }
    if (ed) editProduct(S.catalog.products.find((p) => p.id === ed.dataset.edit));
    if (dl) {
      const p = S.catalog.products.find((x) => x.id === dl.dataset.del);
      if (!confirm(`Удалить «${p.name}»? Это нельзя отменить.`)) return;
      try { await api('/api/admin/products/' + encodeURIComponent(p.id), 'DELETE'); S.catalog.products = S.catalog.products.filter((x) => x.id !== p.id); draw(); toast('Товар удалён'); } catch (x) { toast(x.message, 1); }
    }
  };
}

/** Фото с телефона сжимается прямо в браузере: до 1600 px в WebP + маленькая копия 640 px для карточек каталога */
async function toBitmap(file) { try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { return createImageBitmap(file); } }
function render(bmp, max, q) {
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, c.width, c.height);
  let d = c.toDataURL('image/webp', q);
  if (!d.startsWith('data:image/webp')) { g.globalCompositeOperation = 'destination-over'; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); d = c.toDataURL('image/jpeg', q + .04); }
  return d;
}
async function fileToData(file) { const bmp = await toBitmap(file); return { data: render(bmp, 1600, .82), thumb: render(bmp, 640, .78) }; }
async function avatarToData(file) {
  const bmp = await createImageBitmap(file), side = Math.min(bmp.width, bmp.height), size = 480;
  const c = document.createElement('canvas'); c.width = c.height = size;
  c.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  return c.toDataURL('image/webp', .9);
}
const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' МБ' : Math.round(n / 1024) + ' КБ');
async function upload(file) {
  const { data, thumb } = await fileToData(file);
  const r = await api('/api/admin/upload', 'POST', { data, thumb: thumb.startsWith('data:image/webp') ? thumb : undefined });
  if (file.size > r.bytes * 1.3) toast(`Фото сжато: ${kb(file.size)} → ${kb(r.bytes)}`);
  return r.path;
}

function editProduct(p) {
  const isNew = !p;
  const cur = p ? JSON.parse(JSON.stringify(p)) : { name: '', cat: S.catalog.categories[0]?.id || '', price: '', type: '', color: '#b7a48d', colorName: '', shape: 'tee', tag: '', desc: '', sizes: [], images: [], inStock: true, stock: null, nameUz: '', descUz: '' };
  if (!S.catalog.categories.length) return toast('Сначала создайте каталог на вкладке «Каталоги»', 1);
  const wrap = document.createElement('div'); wrap.className = 'sheet';
  wrap.innerHTML = `<form class="sheet-box" novalidate><div class="sheet-head"><h2>${isNew ? 'Новый товар' : 'Изменить товар'}</h2><button type="button" class="x" data-x aria-label="Закрыть">✕</button></div>
    <div class="sheet-body">
      <label class="field"><span>Название *</span><input type="text" name="name" maxlength="120" value="${esc(cur.name)}" placeholder="Например: Пальто Heritage"></label>
      <div class="grid2">
        <label class="field"><span>В каком каталоге *</span><select name="cat">${S.catalog.categories.map((c) => `<option value="${esc(c.id)}" ${cur.cat === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Цена, сум *</span><input type="number" name="price" min="0" step="1000" inputmode="numeric" value="${esc(cur.price)}" placeholder="450000"></label>
      </div>
      <div class="grid2">
        <label class="field"><span>Старая цена (для скидки)</span><input type="number" name="oldPrice" min="0" step="1000" inputmode="numeric" value="${cur.oldPrice || ''}" placeholder="необязательно"></label>
        <label class="field"><span>Метка на карточке</span><input type="text" name="tag" maxlength="24" value="${esc(cur.tag)}" placeholder="Новинка, Хит, -20%"></label>
      </div>
      <label class="field"><span>Остаток на складе, шт.</span><input type="number" name="stock" min="0" step="1" inputmode="numeric" value="${cur.stock ?? ''}" placeholder="пусто = не считать"><small>Когда остаток маленький, на сайте появится метка «Осталось N шт.». При 0 товар сам станет «нет в наличии».</small></label>
      <div class="field"><span>Фотографии (первая будет главной)</span><div class="photos" id="photos"></div><small>Лучше вертикальные фото. Они автоматически сжимаются в WebP, поэтому сайт открывается быстро.</small></div>
      <label class="field"><span>Описание</span><textarea name="desc" maxlength="2000" placeholder="Ткань, посадка, уход">${esc(cur.desc)}</textarea></label>
      <label class="field"><span>Размеры (через запятую)</span><input type="text" name="sizes" value="${esc((cur.sizes || []).join(', '))}" placeholder="S, M, L, XL">
        <div class="sizes-quick">${[['XS–XL', 'XS,S,M,L,XL'], ['S–XXL', 'S,M,L,XL,XXL'], ['Обувь 39–45', '39,40,41,42,43,44,45'], ['Без размеров', '']].map(([n, v]) => `<button type="button" class="chipbtn" data-sz="${v}">${n}</button>`).join('')}</div></label>
      <div class="grid2">
        <div class="field"><span>Цвет</span><div class="colorrow"><input type="color" name="color" value="${esc(cur.color)}"><input type="text" name="colorName" maxlength="40" value="${esc(cur.colorName)}" placeholder="Название цвета"></div></div>
        <label class="field"><span>Тип вещи</span><input type="text" name="type" maxlength="40" value="${esc(cur.type)}" placeholder="Пальто, Футболка, Лоферы"></label>
      </div>
      <label class="field"><span>Силуэт, если нет фото</span><select name="shape">${SHAPE_OPTIONS.map(([v, n]) => `<option value="${v}" ${cur.shape === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <details class="uzbox"><summary>🇺🇿 Название и описание на узбекском (необязательно)</summary><label class="field"><span>Название (UZ)</span><input type="text" name="nameUz" maxlength="120" value="${esc(cur.nameUz)}"></label><label class="field"><span>Описание (UZ)</span><textarea name="descUz" maxlength="2000">${esc(cur.descUz)}</textarea></label></details>
      <label class="switch"><input type="checkbox" name="inStock" ${cur.inStock !== false ? 'checked' : ''}> В наличии</label>
      <p class="bad" id="perr" role="alert"></p>
    </div>
    <div class="sheet-foot"><button type="button" class="btn" data-x>Отмена</button><button class="btn primary" id="save">Сохранить</button></div></form>`;
  document.body.appendChild(wrap);
  const f = $('form', wrap);
  const close = () => wrap.remove();
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-x]')) close(); });
  f.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  const drawPhotos = () => {
    $('#photos', wrap).innerHTML = cur.images.map((s, i) => `<div class="photo"><img src="/${esc(s)}" alt="">${i ? `<button type="button" class="mv" data-mv="${i}" title="Сделать главным" aria-label="Сделать главным">★</button>` : '<span class="first">Главное</span>'}<button type="button" class="rm" data-rm="${i}" aria-label="Убрать фото">✕</button></div>`).join('') +
      `<label class="add-photo" id="addph"><span><b>+</b>Добавить фото</span><input type="file" accept="image/*" multiple hidden></label>`;
    $('#addph input', wrap).onchange = async (e) => {
      const lab = $('#addph', wrap); lab.classList.add('busy');
      for (const file of [...e.target.files]) {
        if (cur.images.length >= 10) break;
        try { cur.images.push(await upload(file)); } catch (x) { toast(x.message, 1); }
      }
      drawPhotos();
    };
  };
  drawPhotos();
  $('#photos', wrap).onclick = (e) => {
    const rm = e.target.closest('[data-rm]'), mv = e.target.closest('[data-mv]');
    if (rm) { cur.images.splice(+rm.dataset.rm, 1); drawPhotos(); }
    if (mv) { const [x] = cur.images.splice(+mv.dataset.mv, 1); cur.images.unshift(x); drawPhotos(); }
  };
  $$('[data-sz]', wrap).forEach((b) => (b.onclick = () => { f.sizes.value = b.dataset.sz.split(',').filter(Boolean).join(', '); }));
  setTimeout(() => f.name.focus(), 50);

  f.onsubmit = async (e) => {
    e.preventDefault();
    const err = $('#perr', wrap); err.textContent = '';
    const body = {
      id: cur.id, name: f.name.value.trim(), cat: f.cat.value, price: Number(f.price.value), oldPrice: Number(f.oldPrice.value) || 0, tag: f.tag.value, desc: f.desc.value,
      sizes: f.sizes.value.split(',').map((s) => s.trim()).filter(Boolean), color: f.color.value, colorName: f.colorName.value, type: f.type.value, shape: f.shape.value,
      images: cur.images, inStock: f.inStock.checked, stock: f.stock.value === '' ? null : Number(f.stock.value), nameUz: f.nameUz.value, descUz: f.descUz.value,
    };
    if (!body.name) { err.textContent = 'Укажите название товара'; return f.name.focus(); }
    if (f.price.value === '' || !(body.price >= 0)) { err.textContent = 'Укажите цену числом'; return f.price.focus(); }
    const btn = $('#save', wrap); btn.disabled = true;
    try {
      const r = await api('/api/admin/products', 'POST', body);
      const i = S.catalog.products.findIndex((x) => x.id === r.product.id);
      if (i >= 0) S.catalog.products[i] = r.product; else S.catalog.products.push(r.product);
      close(); viewProducts(); toast(isNew ? 'Товар добавлен на сайт' : 'Изменения сохранены');
    } catch (x) { err.textContent = x.message; btn.disabled = false; }
  };
}

/* ---------- каталоги ---------- */
function viewCategories() {
  const v = $('#view');
  const cats = S.catalog.categories.map((c) => ({ ...c }));
  const draw = () => {
    v.innerHTML = `<div class="card"><h3>Каталоги</h3><p class="muted">Это разделы сайта: «Верхняя одежда», «Обувь» и так далее. Порядок здесь совпадает с порядком на сайте.</p>
      <div id="clist">${cats.map((c, i) => `<div class="crow"><input type="text" data-n="${i}" value="${esc(c.name)}" maxlength="60" aria-label="Название каталога"><input type="text" data-u="${i}" value="${esc(c.nameUz || '')}" maxlength="60" placeholder="UZ: Ustki kiyim" aria-label="Название по-узбекски"><div class="acts">
        <button class="btn small" data-up="${i}" aria-label="Выше" ${i ? '' : 'disabled'}>↑</button><button class="btn small" data-down="${i}" aria-label="Ниже" ${i < cats.length - 1 ? '' : 'disabled'}>↓</button><button class="btn small danger" data-rm="${i}">Удалить</button></div></div>`).join('')}</div>
      <div class="bar" style="margin-top:14px"><button class="btn" id="addc">+ Новый каталог</button><button class="btn primary" id="savec">Сохранить</button></div></div>`;
  };
  draw();
  v.oninput = (e) => { const n = e.target.dataset?.n, u = e.target.dataset?.u; if (n !== undefined) cats[+n].name = e.target.value; if (u !== undefined) cats[+u].nameUz = e.target.value; };
  v.onclick = async (e) => {
    const g = (a) => e.target.closest(`[data-${a}]`);
    if (g('up')) { const i = +g('up').dataset.up; [cats[i - 1], cats[i]] = [cats[i], cats[i - 1]]; draw(); }
    if (g('down')) { const i = +g('down').dataset.down; [cats[i + 1], cats[i]] = [cats[i], cats[i + 1]]; draw(); }
    if (g('rm')) { const i = +g('rm').dataset.rm; if (cats[i].id && S.catalog.products.some((p) => p.cat === cats[i].id)) return toast('В этом каталоге есть товары. Сначала перенесите или удалите их.', 1); cats.splice(i, 1); draw(); }
    if (e.target.closest('#addc')) { cats.push({ name: '' }); draw(); $$('[data-n]', v).at(-1).focus(); }
    if (e.target.closest('#savec')) {
      if (cats.some((c) => !c.name.trim())) return toast('У каждого каталога должно быть название', 1);
      try { const r = await api('/api/admin/categories', 'PUT', { categories: cats }); S.catalog.categories = r.categories; viewCategories(); toast('Каталоги сохранены'); } catch (x) { toast(x.message, 1); }
    }
  };
}

/* ---------- заказы ---------- */
const ST = { new: 'Новый', shipping: 'Доставляется', done: 'Доставлен' };
function ordersCSV(list) {
  const q = (x) => '"' + String(x ?? '').replace(/"/g, '""') + '"';
  const rows = [['Номер', 'Дата', 'Статус', 'Имя', 'Телефон', 'Адрес', 'Комментарий', 'Состав', 'Сумма']].concat(list.map((o) => [o.id, new Date(o.date).toLocaleString('ru-RU'), ST[o.status] || 'Новый', o.name, o.phone, o.address + (o.location ? ' | https://www.google.com/maps?q=' + o.location.lat + ',' + o.location.lon : ''), o.comment, o.items.map((i) => `${i.name}${i.size ? ' ' + i.size : ''} x${i.qty}`).join('; '), o.total]));
  return '\ufeff' + rows.map((r) => r.map(q).join(';')).join('\r\n');
}
function viewOrders() {
  const v = $('#view');
  const fmt = (d) => new Date(d).toLocaleString('ru-RU', { day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' });
  const list = () => S.orders.filter((o) => (S.ofilter === 'all' || o.status === S.ofilter) && (!S.oq || [o.id, o.name, o.phone, o.address].join(' ').toLowerCase().includes(S.oq.toLowerCase())));
  const cnt = (f) => S.orders.filter((o) => f === 'all' || o.status === f).length;
  v.innerHTML = `${S.tg ? '' : `<div class="hint">Telegram пока не подключён: заказы сохраняются здесь, но вам в Telegram не приходят. Инструкция в файле README, раздел «Telegram».</div>`}
    <div class="bar"><input type="search" id="oq" placeholder="Поиск: имя, телефон, номер" value="${esc(S.oq)}" aria-label="Поиск заказа"><button class="btn" id="csv">Скачать Excel (.xlsx)</button></div>
    <div class="seg">${[['all', 'Все'], ['new', 'Новые'], ['shipping', 'Доставляются'], ['done', 'Доставленные']].map(([id, n]) => `<button class="chipbtn ${S.ofilter === id ? 'on' : ''}" data-f="${id}">${n} <b>${cnt(id)}</b></button>`).join('')}</div>
    <div id="olist"></div>`;
  const draw = () => {
    const l = list();
    $('#olist').innerHTML = l.length ? l.map((o) => `<div class="order"><div class="order-head"><strong>${esc(o.id)} · ${esc(o.name)}</strong><span class="muted">${fmt(o.date)}</span></div>
      <div class="status-line"><a href="tel:${esc(o.phone.replace(/[^\d+]/g, ''))}">${esc(o.phone)}</a><span class="pill ${o.status === 'done' ? 'done' : o.status === 'shipping' ? 'ship' : 'new'}">${ST[o.status] || 'Новый'}</span>${o.phoneVerified ? '<span class="ok">✓ номер подтверждён</span>' : ''}${o.tgUser ? `<a href="https://t.me/${esc(o.tgUser)}" target="_blank" rel="noopener">@${esc(o.tgUser)}</a>` : ''}${o.telegram ? '<span class="ok">✓ отправлен в Telegram</span>' : '<span class="bad">не отправлен в Telegram</span>'}${o.payment && o.payment.method !== 'cod' ? `<span class="pill ${o.payment.status === 'paid' ? 'done' : 'new'}">💳 ${o.payment.method === 'click' ? 'Click' : 'Payme'}: ${({ paid: 'оплачен', pending: 'ждём оплату', cancelled: 'отменена' })[o.payment.status] || o.payment.status}</span>` : ''}${o.lang === 'uz' ? '<span class="pill">🇺🇿 UZ</span>' : ''}${o.tgChat ? '<span class="ok" title="Бот сам напишет покупателю при смене статуса">🔔 уведомления</span>' : ''}</div>
      ${o.address ? `<p class="muted">📍 ${esc(o.address)}${o.location ? ` · <a href="https://www.google.com/maps?q=${o.location.lat},${o.location.lon}" target="_blank" rel="noopener">Открыть на карте</a>` : ''}</p>` : ''}${o.comment ? `<p class="muted">💬 ${esc(o.comment)}</p>` : ''}
      <ul>${o.items.map((i) => `<li>${esc(i.name)}${i.size ? ' · ' + esc(i.size) : ''} × ${i.qty} — ${money(i.price * i.qty)}</li>`).join('')}</ul>
      ${o.discount ? `<p class="muted">Промокод ${esc(o.promo)}: −${money(o.discount)}</p>` : ''}<strong>Итого: ${money(o.total)}</strong>
      <label class="trackno"><span>№ отправления BTS (увидит покупатель)</span><input data-trk="${esc(o.id)}" value="${esc(o.trackNo || '')}" maxlength="40" placeholder="Например: 123456789"></label>
      <div class="acts"><a class="btn small" href="https://wa.me/${esc(o.phone.replace(/\D/g, ''))}" target="_blank" rel="noopener">WhatsApp</a><button class="btn small" data-cp="${esc(o.id)}">Копировать</button>${o.status !== 'shipping' && o.status !== 'done' ? `<button class="btn small" data-st="${esc(o.id)}" data-to="shipping">Передан в доставку</button>` : ''}${o.status !== 'done' ? `<button class="btn small" data-st="${esc(o.id)}" data-to="done">Доставлен</button>` : `<button class="btn small" data-st="${esc(o.id)}" data-to="new">Вернуть в новые</button>`}<button class="btn small danger" data-od="${esc(o.id)}">Удалить</button></div></div>`).join('') : '<p class="empty">Здесь пока пусто.</p>';
  };
  draw();
  $('#oq').oninput = (e) => { S.oq = e.target.value; draw(); };
  $('#csv').onclick = () => { location.href = '/api/admin/orders.xlsx'; };
  v.onchange = async (e) => {
    const t = e.target.closest('[data-trk]'); if (!t) return;
    try { const r = await api('/api/admin/orders/' + encodeURIComponent(t.dataset.trk), 'PATCH', { trackNo: t.value }); S.orders.find((x) => x.id === t.dataset.trk).trackNo = t.value; toast('Номер сохранён' + (r.notified ? ' · покупатель получил его в Telegram' : '')); } catch (x) { toast(x.message, 1); }
  };
  v.onclick = async (e) => {
    const f = e.target.closest('[data-f]'), st = e.target.closest('[data-st]'), od = e.target.closest('[data-od]'), cp = e.target.closest('[data-cp]');
    if (f) { S.ofilter = f.dataset.f; return viewOrders(); }
    if (cp) {
      const o = S.orders.find((x) => x.id === cp.dataset.cp);
      const t = [`Заказ ${o.id}`, `${o.name}, ${o.phone}`, o.address, o.comment, ...o.items.map((i, n) => `${n + 1}. ${i.name}${i.size ? ' · ' + i.size : ''} × ${i.qty} — ${money(i.price * i.qty)}`), `Итого: ${money(o.total)}`].filter(Boolean).join('\n');
      return navigator.clipboard?.writeText(t).then(() => toast('Заказ скопирован'), () => toast('Не удалось скопировать', 1));
    }
    try {
      if (st) { const o = S.orders.find((x) => x.id === st.dataset.st); o.status = st.dataset.to; const r = await api('/api/admin/orders/' + encodeURIComponent(o.id), 'PATCH', { status: o.status }); toast('Статус: ' + ST[o.status] + (r.notified ? ' · покупателю ушло уведомление в Telegram' : '')); renderShell(); }
      if (od && confirm('Удалить заказ?')) { await api('/api/admin/orders/' + encodeURIComponent(od.dataset.od), 'DELETE'); S.orders = S.orders.filter((x) => x.id !== od.dataset.od); renderShell(); }
    } catch (x) { toast(x.message, 1); }
  };
}

/* ---------- настройки ---------- */
function viewSettings() {
  const v = $('#view'), s = { ...S.settings };
  const F = (k, label, ph = '', area) => `<label class="field"><span>${label}</span>${area ? `<textarea name="${k}" placeholder="${esc(ph)}">${esc(s[k] || '')}</textarea>` : `<input type="text" name="${k}" value="${esc(s[k] || '')}" placeholder="${esc(ph)}">`}</label>`;
  v.innerHTML = `<form id="sf">
    <div class="card" id="profile"><h3>Профиль администратора</h3><p class="muted">Аватарка и имя показываются в шапке админ-панели. По желанию аватарка станет логотипом на сайте.</p>
      <div class="prof"><i class="ava huge" id="avprev">${s.avatar ? `<img src="/${esc(s.avatar)}" alt="">` : `<span>${esc((s.adminName || 'V').trim().charAt(0).toUpperCase())}</span>`}</i>
        <div class="prof-side"><div class="bar"><label class="btn" id="avadd">Загрузить аватарку<input type="file" accept="image/*" hidden></label>${s.avatar ? '<button type="button" class="btn danger" id="avrm">Убрать</button>' : ''}</div>
        ${F('adminName', 'Ваше имя', 'Например: Азиз')}</div></div>
      <label class="switch"><input type="checkbox" name="avatarLogo" ${s.avatarLogo === '1' ? 'checked' : ''}> Показывать аватарку вместо значка логотипа на сайте</label></div>
    <div class="card"><h3>Оформление сайта</h3><p class="muted">Главный цвет кнопок, меток и акцентов. Сохраните настройки, и сайт перекрасится сразу.</p>
      <div class="swatches" id="sw">${['#d8c3a0', '#9db5a8', '#e0a98f', '#c9b6e4', '#8fb8de', '#e6c35c'].map((c) => `<button type="button" class="sw ${(s.accent || '#d8c3a0').toLowerCase() === c ? 'on' : ''}" data-c="${c}" style="--c:${c}" aria-label="Цвет ${c}"></button>`).join('')}<label class="sw custom" title="Свой цвет"><input type="color" id="accent" value="${esc(s.accent || '#d8c3a0')}"></label></div></div>
    <div class="card"><h3>Приём заказов</h3><p class="muted">Если вы в отпуске или нет товара, приостановите заказы. Покупатели увидят ваше сообщение.</p>
      <label class="switch"><input type="checkbox" name="ordersPaused" ${s.ordersPaused === '1' ? 'checked' : ''}> Приостановить приём заказов</label>${F('pausedText', 'Сообщение покупателям', 'Мы в отпуске, заказы откроются в понедельник')}</div>
    <div class="card"><h3>Фон сайта</h3><p class="muted">Картинка за всеми карточками. Подойдёт фото одежды или бренда, лучше горизонтальное и тёмное.</p>
      <div class="photos" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))"><div class="photo" style="aspect-ratio:16/10">${s.bgImage ? `<img src="/${esc(s.bgImage)}" alt="">` : '<img src="/img/bg.svg" alt="">'}${s.bgImage ? '<button type="button" class="rm" id="bgrm" aria-label="Вернуть стандартный фон">✕</button>' : ''}</div>
      <label class="add-photo" id="bgadd" style="aspect-ratio:16/10"><span><b>+</b>Загрузить фон</span><input type="file" accept="image/*" hidden></label></div></div>
    <div class="card"><h3>Видео на главном экране</h3><p class="muted">Сейчас играет встроенное видео с шёлковыми волнами. Можно загрузить своё (MP4 или WebM, до 60 МБ, лучше 10–20 секунд без звука).</p>
      <video id="vprev" muted loop playsinline autoplay style="width:100%;max-height:200px;border-radius:12px;object-fit:cover;margin-bottom:12px" src="/${esc(s.heroVideo || 'img/hero.mp4')}"></video>
      <div class="bar"><label class="btn" id="vadd">Загрузить своё видео<input type="file" accept="video/mp4,video/webm" hidden></label>${s.heroVideo ? '<button type="button" class="btn danger" id="vrm">Вернуть стандартное</button>' : ''}</div></div>
    <div class="card"><h3>Тексты на главной</h3>${F('announcement', 'Строка над меню', 'Бесплатная доставка от 1 000 000 сум')}${F('heroEyebrow', 'Подпись над заголовком')}${F('heroTitle', 'Заголовок (вторая строка станет курсивом)', '', 1)}${F('heroText', 'Текст под заголовком', '', 1)}${F('heroButton', 'Текст кнопки')}${F('aboutTitle', 'Заголовок «О бренде»', '', 1)}${F('aboutText', 'Текст «О бренде»', '', 1)}${F('footerText', 'Подпись в подвале')}</div>
    <div class="card"><h3>🇺🇿 Тексты на узбекском</h3><p class="muted">Показываются, когда покупатель переключает сайт на O‘zbekcha. Если поле пустое, останется русский текст. Названия каталогов переводятся на вкладке «Каталоги», товаров — в карточке товара.</p>${F('announcementUz', 'Строка над меню (UZ)')}${F('heroEyebrowUz', 'Подпись над заголовком (UZ)')}${F('heroTitleUz', 'Заголовок (UZ)', '', 1)}${F('heroTextUz', 'Текст под заголовком (UZ)', '', 1)}${F('heroButtonUz', 'Текст кнопки (UZ)')}${F('aboutTitleUz', 'Заголовок «О бренде» (UZ)', '', 1)}${F('aboutTextUz', 'Текст «О бренде» (UZ)', '', 1)}${F('contactTextUz', 'Текст над контактами (UZ)', '', 1)}${F('footerTextUz', 'Подпись в подвале (UZ)')}</div>
    <div class="card"><h3>Аналитика</h3><p class="muted">Вставьте номер счётчика, и сайт сам подключит его. В Метрике создайте цели типа «JavaScript-событие» с названиями: <code>add_to_cart</code>, <code>begin_checkout</code>, <code>phone_verified</code>, <code>purchase</code>. По ним видно, на каком шаге бросают корзину.</p><div class="grid2">${F('yandexMetrika', 'Яндекс Метрика: номер счётчика', '12345678')}${F('googleAnalytics', 'Google Analytics 4: ID', 'G-XXXXXXXXXX')}</div></div>
    <div class="card"><h3>Остатки и таблица размеров</h3>${F('lowStock', 'Метка «Осталось N шт.», когда остаток не больше', '3')}<p class="muted" style="margin-bottom:10px">Таблицу размеров покупатель открывает на странице товара. Если оставить поля пустыми, покажется стандартная таблица. Свою задайте строками через «|»: у верхней одежды <code>размер|грудь|талия|длина</code>, у брюк <code>размер|талия|бёдра|шаговый шов</code>, у обуви <code>размер|длина стопы|US</code>.</p>${F('sizeTops', 'Футболки, поло, куртки, пальто', 'S|88–94|74–80|68\nM|94–100|80–86|70', 1)}${F('sizePants', 'Брюки', '32|80–83|100–103|82', 1)}${F('sizeShoes', 'Обувь', '42|27.0|9', 1)}${F('sizeNote', 'Подсказка под таблицей', 'Если между размерами, берите больше')}${F('sizeNoteUz', 'Подсказка под таблицей (UZ)')}</div>
    <div class="card"><h3>Оплата и безопасность</h3><p class="muted">Онлайн-оплата: Payme ${S.status.payments?.payme ? '<b class="ok">✓ подключён</b>' : '<b>не подключён</b>'} · Click ${S.status.payments?.click ? '<b class="ok">✓ подключён</b>' : '<b>не подключён</b>'}. Ключи вписываются в файл .env или в Render → Environment (инструкция в README).</p><p class="muted">Пароль админки: ${S.status.weakPassword ? '<b class="bad">⚠ слабый</b>, смените на длинный (команда <code>npm run genpass</code>)' : '<b class="ok">✓ надёжный</b>'}.</p><p class="muted">Уведомления покупателю в Telegram: ${S.status.verify ? '<b class="ok">✓ работают</b> (бот пишет «принят», «в доставке» с номером BTS, «доставлен»)' : '<b>выключены</b>: включите подтверждение номера через Telegram-бота'}.</p></div>
    <div class="card"><h3>Контакты</h3><p class="muted">Показываются внизу сайта. Telegram-имя также нужно для запасного способа заказа.</p>${F('contactText', 'Текст над контактами', '', 1)}<div class="grid2">${F('telegram', 'Telegram (без @)', 'velmont_shop')}${F('whatsapp', 'WhatsApp (номер)', '998901234567')}${F('instagram', 'Instagram', 'velmont')}${F('phone', 'Телефон', '+998 90 123 45 67')}</div>${F('email', 'Email')}</div>
    <div class="card"><h3>Telegram для заказов</h3><p class="muted">${S.tg ? 'Бот подключён.' : 'Бот ещё не подключён. Токен и chat id вписываются в файл .env на сервере (инструкция в README).'}</p>${S.tgTarget ? `<p class="muted">Заказы уходят: <b>${esc(S.tgTarget)}</b></p>` : ''}<button type="button" class="btn" id="tgtest">Отправить тестовое сообщение</button></div>
    <div class="card"><h3>Резервная копия</h3><p class="muted">Один файл с товарами, настройками, заказами, промокодами и отзывами. Скачивайте раз в неделю${S.status.backupChat ? ', а сервер ещё и сам присылает копию в ваш личный Telegram-чат' : '. Чтобы копия приходила сама, задайте BACKUP_CHAT_ID (личный чат, не канал) в .env'}.</p><div class="bar"><a class="btn" id="bkDl" href="/api/admin/backup">Скачать копию</a>${S.status.backupChat ? '<button type="button" class="btn" id="bkTg">Отправить в Telegram сейчас</button>' : ''}</div></div>
    <button class="btn primary" style="width:100%">Сохранить настройки</button></form>`;
  const bind = () => { $('#bgadd input', v).onchange = async (e) => { try { s.bgImage = await upload(e.target.files[0]); $('#sf img', v).src = '/' + s.bgImage; toast('Фон загружен. Нажмите «Сохранить настройки»'); } catch (x) { toast(x.message, 1); } }; const r = $('#bgrm', v); if (r) r.onclick = () => { s.bgImage = ''; $('#sf img', v).src = '/img/bg.svg'; r.remove(); }; };
  bind();
  const sw = $('#sw', v);
  const setAcc = (c) => { s.accent = c; $$('.sw', sw).forEach((b) => b.classList.toggle('on', b.dataset.c === c)); sw.style.setProperty('--cur', c); };
  sw.onclick = (e) => { const b = e.target.closest('[data-c]'); if (b) setAcc(b.dataset.c); };
  $('#accent', v).oninput = (e) => setAcc(e.target.value);
  $('#avadd input', v).onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const lab = $('#avadd', v); lab.classList.add('busy');
    try {
      const d = await avatarToData(f);
      const r = await api('/api/admin/upload', 'POST', { data: d });
      await saveSettingsNow({ avatar: r.path }); toast('Аватарка обновлена'); renderShell();
    } catch (x) { toast(x.message, 1); lab.classList.remove('busy'); }
  };
  const avr = $('#avrm', v); if (avr) avr.onclick = async () => { try { await saveSettingsNow({ avatar: '' }); toast('Аватарка убрана'); renderShell(); } catch (x) { toast(x.message, 1); } };
  $('#vadd input', v).onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const lab = $('#vadd', v); lab.classList.add('busy'); lab.firstChild.textContent = 'Загружаю…';
    try {
      const r = await fetch('/api/admin/upload-video', { method: 'POST', credentials: 'same-origin', body: f });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Ошибка загрузки');
      s.heroVideo = j.path; $('#vprev', v).src = '/' + j.path; toast('Видео загружено. Нажмите «Сохранить настройки»');
    } catch (x) { toast(x.message, 1); }
    lab.firstChild.textContent = 'Загрузить своё видео'; lab.classList.remove('busy');
  };
  const vr = $('#vrm', v); if (vr) vr.onclick = () => { s.heroVideo = ''; $('#vprev', v).src = '/img/hero.mp4'; vr.remove(); toast('Вернётся стандартное видео после сохранения'); };
  const bd = $('#bkDl', v); if (bd) bd.onclick = markBackup;
  const bt = $('#bkTg', v); if (bt) bt.onclick = () => sendBackupTg(bt);
  $('#tgtest', v).onclick = async () => { try { await api('/api/admin/test-telegram', 'POST', {}); toast('Сообщение отправлено, проверьте Telegram'); } catch (x) { toast(x.message, 1); } };
  $('#sf', v).onsubmit = async (e) => {
    e.preventDefault();
    for (const el of e.target.elements) if (el.name && el.type !== 'file' && el.type !== 'checkbox') s[el.name] = el.value;
    s.avatarLogo = e.target.avatarLogo.checked ? '1' : ''; s.ordersPaused = e.target.ordersPaused.checked ? '1' : '';
    s.avatar = S.settings.avatar || s.avatar || '';
    try { const r = await api('/api/admin/settings', 'PUT', s); S.settings = r.settings; toast('Настройки сохранены'); renderShell(); } catch (x) { toast(x.message, 1); }
  };
}

/* ---------- промокоды ---------- */
function viewPromos() {
  const v = $('#view'), list = S.promos.map((x) => ({ ...x }));
  const draw = () => {
    v.innerHTML = `<div class="card"><h3>Промокоды и скидки</h3><p class="muted">Покупатель вводит код при оформлении заказа. Скидка считается на сервере, подделать её нельзя. «Только на первый заказ» проверяется по подтверждённому номеру телефона.</p>
      <div class="bar"><button class="btn" id="addp">+ Новый промокод</button><button class="btn" id="addf">Скидка 10% на первый заказ</button></div>
      ${list.length ? list.map((p, i) => `<div class="promo-row"><div class="promo-top"><input type="text" data-k="code" data-i="${i}" value="${esc(p.code)}" maxlength="24" placeholder="КОД" autocapitalize="characters" aria-label="Код"><select data-k="type" data-i="${i}" aria-label="Тип скидки"><option value="percent" ${p.type !== 'fixed' ? 'selected' : ''}>% скидка</option><option value="fixed" ${p.type === 'fixed' ? 'selected' : ''}>сум скидка</option></select><input type="number" data-k="value" data-i="${i}" value="${p.value || ''}" min="1" placeholder="Размер" aria-label="Размер скидки"></div>
        <div class="grid3"><label class="field"><span>Минимальная сумма заказа</span><input type="number" data-k="minTotal" data-i="${i}" value="${p.minTotal || ''}" min="0" placeholder="0"></label><label class="field"><span>Действует до</span><input type="date" data-k="expires" data-i="${i}" value="${esc(p.expires || '')}"></label><label class="field"><span>Лимит использований (0 = без)</span><input type="number" data-k="limit" data-i="${i}" value="${p.limit || ''}" min="0" placeholder="0"></label></div>
        <div class="promo-foot"><label class="switch"><input type="checkbox" data-k="firstOrder" data-i="${i}" ${p.firstOrder ? 'checked' : ''}> Только на первый заказ</label><label class="switch"><input type="checkbox" data-k="active" data-i="${i}" ${p.active !== false ? 'checked' : ''}> Включён</label><span class="muted">Использован: ${p.used || 0}</span><button class="btn small danger" data-rm="${i}">Удалить</button></div></div>`).join('') : '<p class="empty">Промокодов пока нет.</p>'}
      <button class="btn primary" id="savep" style="margin-top:10px">Сохранить промокоды</button></div>`;
  };
  draw();
  const set = (e) => { const t = e.target, k = t.dataset?.k; if (k === undefined) return; const x = list[+t.dataset.i]; x[k] = t.type === 'checkbox' ? t.checked : ['value', 'minTotal', 'limit'].includes(k) ? Number(t.value) : k === 'code' ? t.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') : t.value; if (k === 'code') t.value = x[k]; };
  v.oninput = set; v.onchange = set;
  v.onclick = async (e) => {
    if (e.target.closest('#addp')) { list.push({ code: '', type: 'percent', value: 10, active: true }); draw(); $$('[data-k=code]', v).at(-1).focus(); }
    if (e.target.closest('#addf')) { list.push({ code: 'FIRST10', type: 'percent', value: 10, firstOrder: true, active: true }); draw(); }
    const rm = e.target.closest('[data-rm]'); if (rm) { list.splice(+rm.dataset.rm, 1); draw(); }
    if (e.target.closest('#savep')) { try { const r = await api('/api/admin/promos', 'PUT', { promos: list }); S.promos = r.promos; toast('Промокоды сохранены'); viewPromos(); } catch (x) { toast(x.message, 1); } }
  };
}

/* ---------- отзывы ---------- */
function viewReviews() {
  const v = $('#view'), list = S.reviews.map((x) => ({ ...x }));
  const draw = () => {
    v.innerHTML = `<div class="card"><h3>Отзывы покупателей</h3><p class="muted">Показываются на главной странице в отдельном блоке. Пока отзывов нет, блока на сайте тоже нет. Добавляйте только настоящие отзывы (например, из Telegram или Instagram) и фото с разрешения клиента.</p>
      ${list.length ? list.map((r, i) => `<div class="rev-edit"><div class="rev-ph">${r.photo ? `<img src="/${esc(r.photo)}" alt=""><button type="button" class="rm" data-rmph="${i}" aria-label="Убрать фото">✕</button>` : `<label class="add-photo"><span><b>+</b>Фото</span><input type="file" accept="image/*" hidden data-ph="${i}"></label>`}</div>
        <div class="rev-f"><div class="grid2"><input type="text" data-k="name" data-i="${i}" value="${esc(r.name)}" maxlength="60" placeholder="Имя"><input type="text" data-k="city" data-i="${i}" value="${esc(r.city || '')}" maxlength="40" placeholder="Город"></div>
          <select data-k="rating" data-i="${i}" aria-label="Оценка">${[5, 4, 3, 2, 1].map((n) => `<option value="${n}" ${+r.rating === n || (!r.rating && n === 5) ? 'selected' : ''}>${'★'.repeat(n)}</option>`).join('')}</select>
          <textarea data-k="text" data-i="${i}" maxlength="600" placeholder="Текст отзыва">${esc(r.text || '')}</textarea><label class="switch"><input type="checkbox" data-k="show" data-i="${i}" ${r.show !== false ? 'checked' : ''}> Показывать на сайте</label></div>
        <div class="acts"><button class="btn small" data-up="${i}" ${i ? '' : 'disabled'} aria-label="Выше">↑</button><button class="btn small" data-down="${i}" ${i < list.length - 1 ? '' : 'disabled'} aria-label="Ниже">↓</button><button class="btn small danger" data-rm="${i}">Удалить</button></div></div>`).join('') : '<p class="empty">Отзывов пока нет.</p>'}
      <div class="bar" style="margin-top:12px"><button class="btn" id="addr">+ Добавить отзыв</button><button class="btn primary" id="saver">Сохранить отзывы</button></div></div>`;
  };
  draw();
  const set = (e) => { const k = e.target.dataset?.k; if (k === undefined) return; list[+e.target.dataset.i][k] = e.target.type === 'checkbox' ? e.target.checked : k === 'rating' ? Number(e.target.value) : e.target.value; };
  v.oninput = set;
  v.onchange = async (e) => {
    set(e); const ph = e.target.dataset?.ph; if (ph === undefined || !e.target.files[0]) return;
    e.target.closest('.add-photo').classList.add('busy');
    try { list[+ph].photo = await upload(e.target.files[0]); draw(); } catch (x) { toast(x.message, 1); draw(); }
  };
  v.onclick = async (e) => {
    const g = (a) => e.target.closest(`[data-${a}]`);
    if (e.target.closest('#addr')) { list.push({ name: '', city: '', text: '', rating: 5, photo: '', show: true }); draw(); $$('[data-k=name]', v).at(-1).focus(); }
    if (g('rmph')) { list[+g('rmph').dataset.rmph].photo = ''; draw(); }
    if (g('up')) { const i = +g('up').dataset.up; [list[i - 1], list[i]] = [list[i], list[i - 1]]; draw(); }
    if (g('down')) { const i = +g('down').dataset.down; [list[i + 1], list[i]] = [list[i], list[i + 1]]; draw(); }
    if (g('rm')) { if (confirm('Удалить отзыв?')) { list.splice(+g('rm').dataset.rm, 1); draw(); } }
    if (e.target.closest('#saver')) { try { const r = await api('/api/admin/reviews', 'PUT', { reviews: list }); S.reviews = r.reviews; toast('Отзывы сохранены'); viewReviews(); } catch (x) { toast(x.message, 1); } }
  };
}

boot();
