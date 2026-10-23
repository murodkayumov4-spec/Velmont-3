import { garment, SHAPE_OPTIONS } from '../js/art.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' сум';
const app = $('#app');
const S = { tab: 'dashboard', ofilter: 'all', oq: '', tgTarget: '', catalog: { categories: [], products: [] }, settings: {}, orders: [], tg: false, q: '', fcat: 'all' };

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
  const [c, s, o, st] = await Promise.all([api('/api/catalog'), api('/api/settings'), api('/api/admin/orders'), api('/api/admin/status')]);
  S.catalog = c; S.settings = s; S.orders = o.orders; S.tg = st.telegram; S.tgTarget = st.target || '';
  renderShell();
}
function renderShell() {
  const newOrders = S.orders.filter((o) => o.status === 'new').length;
  const av = S.settings.avatar ? `<img src="/${esc(S.settings.avatar)}" alt="">` : `<span>${esc((S.settings.adminName || 'V').trim().charAt(0).toUpperCase())}</span>`;
  app.innerHTML = `
    <header class="top"><div class="brand">VELMONT<small>управление</small></div>
      <div class="top-actions"><button class="me" id="meBtn" aria-label="Профиль и настройки"><i class="ava">${av}</i><b>${esc(S.settings.adminName || 'Админ')}</b></button><a class="btn small" href="/" target="_blank" rel="noopener">Открыть сайт</a><button class="btn small" id="logout">Выйти</button></div></header>
    <nav class="tabs" role="tablist">
      ${[['dashboard', 'Обзор'], ['products', 'Товары'], ['categories', 'Каталоги'], ['orders', 'Заказы'], ['settings', 'Настройки']].map(([id, n]) => `<button class="tab ${S.tab === id ? 'on' : ''}" role="tab" data-tab="${id}">${n}${id === 'orders' && newOrders ? `<span class="n">${newOrders}</span>` : ''}</button>`).join('')}
    </nav><main id="view"></main>`;
  $('#meBtn').onclick = () => { S.tab = 'settings'; renderShell(); setTimeout(() => $('#profile')?.scrollIntoView({ behavior: 'smooth' }), 60); };
  $('#logout').onclick = async () => { await api('/api/logout', 'POST', {}); renderLogin(); };
  $$('[data-tab]').forEach((b) => (b.onclick = () => { S.tab = b.dataset.tab; renderShell(); }));
  ({ dashboard: viewDashboard, products: viewProducts, categories: viewCategories, orders: viewOrders, settings: viewSettings })[S.tab]();
}

/* ---------- обзор ---------- */
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
  v.innerHTML = `
    <div class="hello card"><i class="ava big">${av}</i><div><h2>${hi}, ${esc(S.settings.adminName || 'админ')}!</h2><p class="muted">${newO.length ? `У вас ${newO.length} ${newO.length === 1 ? 'новый заказ' : 'новых заказа(ов)'}, ждут ответа.` : 'Новых заказов нет. Спокойный день.'}</p></div></div>
    <div class="stats">
      <div class="stat"><span>Новые заказы</span><b data-n="${newO.length}">0</b></div>
      <div class="stat"><span>Заказов сегодня</span><b data-n="${today.length}">0</b></div>
      <div class="stat"><span>Выручка (выполненные)</span><b data-n="${sum(O.filter((o) => o.status === 'done'))}" data-m="1">0</b></div>
      <div class="stat"><span>Товаров на сайте</span><b data-n="${P.length}">0</b><small>${out ? out + ' нет в наличии' : 'всё в наличии'}</small></div>
    </div>
    <div class="card"><h3>Заказы за 7 дней</h3><div class="chart">${days.map((d) => `<div class="col" title="${money(d.sum)}"><i style="--h:${Math.round((d.n / max) * 100)}%"></i><b>${d.n}</b><span>${new Date(d.t).toLocaleDateString('ru-RU', { weekday: 'short' })}</span></div>`).join('')}</div></div>
    <div class="card"><div class="switch-row"><div><h3>Приём заказов</h3><p class="muted">${paused ? 'Сейчас приостановлен: покупатели видят сообщение и не могут оформить заказ.' : 'Открыт: покупатели могут оформлять заказы.'}</p></div>
      <label class="switch tog"><input type="checkbox" id="pauseTog" ${paused ? '' : 'checked'}><i></i></label></div></div>
    <div class="card"><h3>Быстрые действия</h3><div class="bar"><button class="btn" data-go="products">+ Новый товар</button><button class="btn" data-go="orders">Все заказы</button><button class="btn" id="copyLink">Скопировать ссылку на сайт</button><button class="btn" id="backup">Скачать резервную копию</button></div></div>
    ${O.length ? `<div class="card"><h3>Последние заказы</h3>${O.slice(0, 4).map((o) => `<div class="mini"><span><b>${esc(o.id)}</b> · ${esc(o.name)}</span><span>${money(o.total)} <i class="pill ${o.status === 'done' ? 'done' : o.status === 'shipping' ? 'ship' : 'new'}">${ST[o.status] || 'Новый'}</i></span></div>`).join('')}</div>` : ''}`;
  $$('[data-n]', v).forEach((el) => { const to = +el.dataset.n, m = el.dataset.m, t0 = performance.now(); (function f(t) { const k = Math.min(1, (t - t0) / 800), e = 1 - Math.pow(1 - k, 3); el.textContent = m ? money(to * e) : Math.round(to * e); if (k < 1) requestAnimationFrame(f); })(t0); });
  v.onclick = (e) => {
    const g = e.target.closest('[data-go]'); if (g) { S.tab = g.dataset.go; renderShell(); if (g.dataset.go === 'products') setTimeout(() => $('#add')?.click(), 50); }
    if (e.target.closest('#copyLink')) navigator.clipboard?.writeText(location.origin + '/').then(() => toast('Ссылка скопирована'), () => toast(location.origin + '/'));
    if (e.target.closest('#backup')) location.href = '/api/admin/backup';
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
        <div><h3>${esc(p.name)}</h3><p><span class="pill">${esc(catName(p.cat))}</span>${money(p.price)}${p.inStock === false ? ' <span class="pill off">нет в наличии</span>' : ''}</p></div>
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
        if (sk) { const r = await api('/api/admin/products', 'POST', { ...p, inStock: p.inStock === false }); Object.assign(p, r.product); toast(p.inStock === false ? 'Отмечен: нет в наличии' : 'Снова в наличии'); }
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

async function fileToData(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const g = c.getContext('2d'); g.drawImage(bmp, 0, 0, c.width, c.height);
  let d = c.toDataURL('image/webp', .86);
  if (!d.startsWith('data:image/webp')) { g.globalCompositeOperation = 'destination-over'; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); d = c.toDataURL('image/jpeg', .88); }
  return d;
}
async function avatarToData(file) {
  const bmp = await createImageBitmap(file), side = Math.min(bmp.width, bmp.height), size = 480;
  const c = document.createElement('canvas'); c.width = c.height = size;
  c.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  return c.toDataURL('image/webp', .9);
}
async function upload(file) { const r = await api('/api/admin/upload', 'POST', { data: await fileToData(file) }); return r.path; }

function editProduct(p) {
  const isNew = !p;
  const cur = p ? JSON.parse(JSON.stringify(p)) : { name: '', cat: S.catalog.categories[0]?.id || '', price: '', type: '', color: '#b7a48d', colorName: '', shape: 'tee', tag: '', desc: '', sizes: [], images: [], inStock: true };
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
      <div class="field"><span>Фотографии (первая будет главной)</span><div class="photos" id="photos"></div><small>Лучше вертикальные фото. Они автоматически уменьшаются до удобного размера.</small></div>
      <label class="field"><span>Описание</span><textarea name="desc" maxlength="2000" placeholder="Ткань, посадка, уход">${esc(cur.desc)}</textarea></label>
      <label class="field"><span>Размеры (через запятую)</span><input type="text" name="sizes" value="${esc((cur.sizes || []).join(', '))}" placeholder="S, M, L, XL">
        <div class="sizes-quick">${[['XS–XL', 'XS,S,M,L,XL'], ['S–XXL', 'S,M,L,XL,XXL'], ['Обувь 39–45', '39,40,41,42,43,44,45'], ['Без размеров', '']].map(([n, v]) => `<button type="button" class="chipbtn" data-sz="${v}">${n}</button>`).join('')}</div></label>
      <div class="grid2">
        <div class="field"><span>Цвет</span><div class="colorrow"><input type="color" name="color" value="${esc(cur.color)}"><input type="text" name="colorName" maxlength="40" value="${esc(cur.colorName)}" placeholder="Название цвета"></div></div>
        <label class="field"><span>Тип вещи</span><input type="text" name="type" maxlength="40" value="${esc(cur.type)}" placeholder="Пальто, Футболка, Лоферы"></label>
      </div>
      <label class="field"><span>Силуэт, если нет фото</span><select name="shape">${SHAPE_OPTIONS.map(([v, n]) => `<option value="${v}" ${cur.shape === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
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
      images: cur.images, inStock: f.inStock.checked,
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
      <div id="clist">${cats.map((c, i) => `<div class="crow"><input type="text" data-n="${i}" value="${esc(c.name)}" maxlength="60" aria-label="Название каталога"><div class="acts">
        <button class="btn small" data-up="${i}" aria-label="Выше" ${i ? '' : 'disabled'}>↑</button><button class="btn small" data-down="${i}" aria-label="Ниже" ${i < cats.length - 1 ? '' : 'disabled'}>↓</button><button class="btn small danger" data-rm="${i}">Удалить</button></div></div>`).join('')}</div>
      <div class="bar" style="margin-top:14px"><button class="btn" id="addc">+ Новый каталог</button><button class="btn primary" id="savec">Сохранить</button></div></div>`;
  };
  draw();
  v.oninput = (e) => { const n = e.target.dataset?.n; if (n !== undefined) cats[+n].name = e.target.value; };
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
    <div class="bar"><input type="search" id="oq" placeholder="Поиск: имя, телефон, номер" value="${esc(S.oq)}" aria-label="Поиск заказа"><button class="btn" id="csv">Скачать Excel (CSV)</button></div>
    <div class="seg">${[['all', 'Все'], ['new', 'Новые'], ['shipping', 'Доставляются'], ['done', 'Доставленные']].map(([id, n]) => `<button class="chipbtn ${S.ofilter === id ? 'on' : ''}" data-f="${id}">${n} <b>${cnt(id)}</b></button>`).join('')}</div>
    <div id="olist"></div>`;
  const draw = () => {
    const l = list();
    $('#olist').innerHTML = l.length ? l.map((o) => `<div class="order"><div class="order-head"><strong>${esc(o.id)} · ${esc(o.name)}</strong><span class="muted">${fmt(o.date)}</span></div>
      <div class="status-line"><a href="tel:${esc(o.phone.replace(/[^\d+]/g, ''))}">${esc(o.phone)}</a><span class="pill ${o.status === 'done' ? 'done' : o.status === 'shipping' ? 'ship' : 'new'}">${ST[o.status] || 'Новый'}</span>${o.phoneVerified ? '<span class="ok">✓ номер подтверждён</span>' : ''}${o.tgUser ? `<a href="https://t.me/${esc(o.tgUser)}" target="_blank" rel="noopener">@${esc(o.tgUser)}</a>` : ''}${o.telegram ? '<span class="ok">✓ отправлен в Telegram</span>' : '<span class="bad">не отправлен в Telegram</span>'}</div>
      ${o.address ? `<p class="muted">📍 ${esc(o.address)}${o.location ? ` · <a href="https://www.google.com/maps?q=${o.location.lat},${o.location.lon}" target="_blank" rel="noopener">Открыть на карте</a>` : ''}</p>` : ''}${o.comment ? `<p class="muted">💬 ${esc(o.comment)}</p>` : ''}
      <ul>${o.items.map((i) => `<li>${esc(i.name)}${i.size ? ' · ' + esc(i.size) : ''} × ${i.qty} — ${money(i.price * i.qty)}</li>`).join('')}</ul>
      <strong>Итого: ${money(o.total)}</strong>
      <label class="trackno"><span>№ отправления BTS (увидит покупатель)</span><input data-trk="${esc(o.id)}" value="${esc(o.trackNo || '')}" maxlength="40" placeholder="Например: 123456789"></label>
      <div class="acts"><a class="btn small" href="https://wa.me/${esc(o.phone.replace(/\D/g, ''))}" target="_blank" rel="noopener">WhatsApp</a><button class="btn small" data-cp="${esc(o.id)}">Копировать</button>${o.status !== 'shipping' && o.status !== 'done' ? `<button class="btn small" data-st="${esc(o.id)}" data-to="shipping">Передан в доставку</button>` : ''}${o.status !== 'done' ? `<button class="btn small" data-st="${esc(o.id)}" data-to="done">Доставлен</button>` : `<button class="btn small" data-st="${esc(o.id)}" data-to="new">Вернуть в новые</button>`}<button class="btn small danger" data-od="${esc(o.id)}">Удалить</button></div></div>`).join('') : '<p class="empty">Здесь пока пусто.</p>';
  };
  draw();
  $('#oq').oninput = (e) => { S.oq = e.target.value; draw(); };
  $('#csv').onclick = () => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([ordersCSV(list())], { type: 'text/csv;charset=utf-8' })); a.download = `velmont-orders-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  v.onchange = async (e) => {
    const t = e.target.closest('[data-trk]'); if (!t) return;
    try { await api('/api/admin/orders/' + encodeURIComponent(t.dataset.trk), 'PATCH', { trackNo: t.value }); S.orders.find((x) => x.id === t.dataset.trk).trackNo = t.value; toast('Номер сохранён'); } catch (x) { toast(x.message, 1); }
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
      if (st) { const o = S.orders.find((x) => x.id === st.dataset.st); o.status = st.dataset.to; await api('/api/admin/orders/' + encodeURIComponent(o.id), 'PATCH', { status: o.status }); toast('Статус: ' + ST[o.status]); renderShell(); }
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
    <div class="card"><h3>Контакты</h3><p class="muted">Показываются внизу сайта. Telegram-имя также нужно для запасного способа заказа.</p>${F('contactText', 'Текст над контактами', '', 1)}<div class="grid2">${F('telegram', 'Telegram (без @)', 'velmont_shop')}${F('whatsapp', 'WhatsApp (номер)', '998901234567')}${F('instagram', 'Instagram', 'velmont')}${F('phone', 'Телефон', '+998 90 123 45 67')}</div>${F('email', 'Email')}</div>
    <div class="card"><h3>Telegram для заказов</h3><p class="muted">${S.tg ? 'Бот подключён.' : 'Бот ещё не подключён. Токен и chat id вписываются в файл .env на сервере (инструкция в README).'}</p>${S.tgTarget ? `<p class="muted">Заказы уходят: <b>${esc(S.tgTarget)}</b></p>` : ''}<button type="button" class="btn" id="tgtest">Отправить тестовое сообщение</button></div>
    <div class="card"><h3>Резервная копия</h3><p class="muted">Один файл с товарами, настройками и заказами. Скачивайте время от времени.</p><a class="btn" href="/api/admin/backup">Скачать копию</a></div>
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
  $('#tgtest', v).onclick = async () => { try { await api('/api/admin/test-telegram', 'POST', {}); toast('Сообщение отправлено, проверьте Telegram'); } catch (x) { toast(x.message, 1); } };
  $('#sf', v).onsubmit = async (e) => {
    e.preventDefault();
    for (const el of e.target.elements) if (el.name && el.type !== 'file' && el.type !== 'checkbox') s[el.name] = el.value;
    s.avatarLogo = e.target.avatarLogo.checked ? '1' : ''; s.ordersPaused = e.target.ordersPaused.checked ? '1' : '';
    s.avatar = S.settings.avatar || s.avatar || '';
    try { const r = await api('/api/admin/settings', 'PUT', s); S.settings = r.settings; toast('Настройки сохранены'); renderShell(); } catch (x) { toast(x.message, 1); }
  };
}

boot();
