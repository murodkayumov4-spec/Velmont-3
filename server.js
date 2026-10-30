'use strict';
/**
 * VELMONT — сервер магазина без внешних зависимостей (нужен Node.js 18+).
 *  - отдаёт сайт из папки public/
 *  - API каталога и настроек
 *  - админ-панель /admin (вход по паролю)
 *  - загрузка фото товаров
 *  - заказы -> Telegram
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { xlsx } = require('./lib/xlsx');
const { buyerMsg, botText } = require('./lib/messages');
const { createPayments } = require('./lib/payments');

const ROOT = __dirname;
const PUB = path.join(ROOT, 'public');
const DATA = path.join(PUB, 'data');
const UPLOADS = path.join(PUB, 'uploads');
const STORE = path.join(ROOT, 'storage');
for (const d of [DATA, UPLOADS, STORE]) fs.mkdirSync(d, { recursive: true });

/* ---------- .env ---------- */
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const SITE_URL = (process.env.SITE_URL || 'https://velmontstyle.uz').trim().replace(/\/+$/, '');

/* ---------- файлы данных ---------- */
const CATALOG_FILE = path.join(DATA, 'products.json');
const SETTINGS_FILE = path.join(DATA, 'settings.json');
const ORDERS_FILE = path.join(STORE, 'orders.json');
const SECRET_FILE = path.join(STORE, 'secret.key');
const PROMOS_FILE = path.join(STORE, 'promos.json');
const REVIEWS_FILE = path.join(STORE, 'reviews.json');
const META_FILE = path.join(STORE, 'meta.json');

/* ---------- хранилище: Supabase (для Render) или обычные файлы ---------- */
const SB_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const SB_KEY = (process.env.SUPABASE_SERVICE_KEY || '').trim();
const SB = !!(SB_URL && SB_KEY);
const sbHeaders = (extra) => Object.assign(SB_KEY.startsWith('sb_') ? { apikey: SB_KEY } : { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY }, extra);
const KEYS = new Map([[CATALOG_FILE, 'catalog'], [SETTINGS_FILE, 'settings'], [ORDERS_FILE, 'orders'], [PROMOS_FILE, 'promos'], [REVIEWS_FILE, 'reviews'], [META_FILE, 'meta']]);
const cache = new Map();
async function sbGet(key) {
  const r = await fetch(`${SB_URL}/rest/v1/kv?key=eq.${encodeURIComponent(key)}&select=value`, { headers: sbHeaders(), signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return j.length ? j[0].value : undefined;
}
async function sbSet(key, value) {
  const r = await fetch(`${SB_URL}/rest/v1/kv`, {
    method: 'POST', headers: sbHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify({ key, value }), signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw Object.assign(new Error(`Не удалось сохранить в базу (${r.status}). ${(await r.text()).slice(0, 150)}`), { status: 502 });
}
function fsRead(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function readJSON(file, fallback) {
  if (SB && KEYS.has(file)) { const v = cache.get(KEYS.get(file)); return v === undefined ? fallback : JSON.parse(JSON.stringify(v)); }
  return fsRead(file, fallback);
}
async function writeJSON(file, data) {
  if (SB && KEYS.has(file)) { cache.set(KEYS.get(file), JSON.parse(JSON.stringify(data))); return sbSet(KEYS.get(file), data); }
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}
let ordersLock = Promise.resolve();
/** Изменить список заказов по очереди (без гонок). Изменения сохраняются, даже если fn бросила ошибку. */
function mutateOrders(fn) {
  const run = ordersLock.then(async () => {
    const orders = readJSON(ORDERS_FILE, []);
    try { return await fn(orders); } finally { await writeJSON(ORDERS_FILE, orders.slice(0, 500)); }
  });
  ordersLock = run.catch(() => {});
  return run;
}
async function saveUpload(file, buf, type) {
  if (!SB) { fs.writeFileSync(path.join(UPLOADS, file), buf); return; }
  const r = await fetch(`${SB_URL}/storage/v1/object/uploads/${file}`, { method: 'POST', headers: sbHeaders({ 'Content-Type': type, 'x-upsert': 'true' }), body: buf, signal: AbortSignal.timeout(90000) });
  if (!r.ok) throw Object.assign(new Error(`Не удалось сохранить файл (${r.status}). Проверьте, что в Supabase создан бакет uploads.`), { status: 502 });
}
let SECRET = '';
if (!SB) {
  try { SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim(); } catch {}
  if (!SECRET) { SECRET = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(SECRET_FILE, SECRET, { mode: 0o600 }); }
}
async function initStorage() {
  if (!SB) return;
  for (const [file, key] of KEYS) {
    let v = await sbGet(key);
    if (v === undefined) {   // первый запуск: берём стартовые данные из файлов проекта
      v = ['orders', 'promos', 'reviews'].includes(key) ? fsRead(file, []) : fsRead(file, key === 'catalog' ? { categories: [], products: [] } : {});
      await sbSet(key, v);
    }
    cache.set(key, v);
  }
  let sec = await sbGet('secret');
  if (!sec) { sec = crypto.randomBytes(32).toString('hex'); await sbSet('secret', sec); }
  SECRET = sec;
}

/* ---------- проверка и очистка данных ---------- */
const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const rid = (p) => p + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
const SHAPES = ['tee', 'polo', 'jacket', 'coat', 'pants', 'shoe', 'sneaker', 'hoodie'];
const okImage = (s) => typeof s === 'string' && (/^uploads\/[a-z0-9._-]+$/i.test(s) || /^https:\/\/[^\s"'<>]+$/i.test(s));

function cleanProduct(p, cats) {
  if (!p || typeof p !== 'object') throw new Error('Некорректный товар');
  const name = str(p.name, 120);
  if (!name) throw new Error('Укажите название товара');
  const cat = str(p.cat, 40);
  if (!cats.some((c) => c.id === cat)) throw new Error('Выберите существующий каталог');
  const price = Math.round(Number(p.price));
  if (!Number.isFinite(price) || price < 0 || price > 1e10) throw new Error('Укажите цену числом');
  const oldPrice = Math.round(Number(p.oldPrice)) || 0;
  const id = /^[a-z0-9_-]{1,40}$/i.test(p.id || '') ? p.id : rid('p');
  const color = /^#[0-9a-f]{6}$/i.test(p.color || '') ? p.color : '#b7a48d';
  const sizes = (Array.isArray(p.sizes) ? p.sizes : []).map((s) => str(String(s), 12)).filter(Boolean).slice(0, 14);
  const images = (Array.isArray(p.images) ? p.images : []).filter(okImage).slice(0, 10);
  const stock = p.stock === '' || p.stock == null ? null : Math.max(0, Math.min(99999, Math.round(Number(p.stock)) || 0));
  return {
    id, name, cat, price, oldPrice: oldPrice > price ? oldPrice : 0,
    type: str(p.type, 40), color, colorName: str(p.colorName, 40),
    shape: SHAPES.includes(p.shape) ? p.shape : 'tee',
    tag: str(p.tag, 24), desc: str(p.desc, 2000), sizes, images,
    inStock: p.inStock !== false && stock !== 0,
    stock, nameUz: str(p.nameUz, 120), descUz: str(p.descUz, 2000),
  };
}
function cleanCategories(list) {
  if (!Array.isArray(list) || !list.length) throw new Error('Нужен хотя бы один каталог');
  const seen = new Set();
  return list.slice(0, 30).map((c) => {
    const name = str(c && c.name, 60);
    if (!name) throw new Error('У каталога должно быть название');
    let id = /^[a-z0-9_-]{1,40}$/i.test((c && c.id) || '') ? c.id : rid('c');
    while (seen.has(id)) id = rid('c');
    seen.add(id);
    return { id, name, nameUz: str(c && c.nameUz, 60) };
  });
}
const SETTING_KEYS = {
  announcement: 160, heroEyebrow: 80, heroTitle: 120, heroText: 400, heroButton: 40,
  aboutTitle: 120, aboutText: 800, contactText: 300, footerText: 160,
  telegram: 60, whatsapp: 30, instagram: 60, phone: 30, email: 80, bgImage: 300, heroVideo: 300,
  avatar: 300, adminName: 40, accent: 7, avatarLogo: 1, ordersPaused: 1, pausedText: 200,
  announcementUz: 160, heroEyebrowUz: 80, heroTitleUz: 120, heroTextUz: 400, heroButtonUz: 40, aboutTitleUz: 120, aboutTextUz: 800, contactTextUz: 300, footerTextUz: 160, pausedTextUz: 200,
  yandexMetrika: 12, googleAnalytics: 20, lowStock: 3, sizeNote: 200, sizeNoteUz: 200, sizeTops: 700, sizePants: 700, sizeShoes: 700,
};
function cleanSettings(s) {
  const out = {};
  for (const [k, n] of Object.entries(SETTING_KEYS)) out[k] = str(s && s[k], n);
  out.telegram = out.telegram.replace(/^@/, '').replace(/^https?:\/\/t\.me\//i, '');
  out.instagram = out.instagram.replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/$/, '');
  if (out.bgImage && !okImage(out.bgImage)) out.bgImage = '';
  if (out.avatar && !okImage(out.avatar)) out.avatar = '';
  if (!/^#[0-9a-f]{6}$/i.test(out.accent)) out.accent = '';
  out.yandexMetrika = out.yandexMetrika.replace(/\D/g, '');
  if (!/^(G|GT|UA|AW)-[A-Z0-9-]{4,16}$/i.test(out.googleAnalytics)) out.googleAnalytics = '';
  out.lowStock = String(Math.max(0, Math.min(50, parseInt(out.lowStock, 10) || 3)));
  out.avatarLogo = out.avatarLogo === '1' ? '1' : '';
  out.ordersPaused = out.ordersPaused === '1' ? '1' : '';
  if (out.heroVideo && !/^uploads\/[a-z0-9._-]+\.(mp4|webm)$/i.test(out.heroVideo)) out.heroVideo = '';
  return out;
}

/* ---------- мусор в uploads ---------- */
function gcUploads() {
  if (SB) return;   // в облаке файлы не чистим автоматически
  try {
    const cat = readJSON(CATALOG_FILE, { products: [] });
    const set = readJSON(SETTINGS_FILE, {});
    const used = new Set();
    for (const p of cat.products || []) for (const i of p.images || []) used.add(path.basename(i));
    if (set.bgImage) used.add(path.basename(set.bgImage));
    if (set.heroVideo) used.add(path.basename(set.heroVideo));
    if (set.avatar) used.add(path.basename(set.avatar));
    for (const r of readJSON(REVIEWS_FILE, [])) if (r.photo) used.add(path.basename(r.photo));
    for (const u of [...used]) used.add(u.replace(/\.(webp|jpg|png)$/i, '-s.webp'));   // миниатюры
    for (const f of fs.readdirSync(UPLOADS)) {
      if (f.startsWith('.') || used.has(f)) continue;
      const full = path.join(UPLOADS, f);
      if (Date.now() - fs.statSync(full).mtimeMs > 3600e3) fs.unlinkSync(full);
    }
  } catch (e) { console.error('gc:', e.message); }
}

/* ---------- авторизация ---------- */
const sign = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
function makeToken() { const body = Buffer.from(JSON.stringify({ exp: Date.now() + 7 * 864e5 })).toString('base64url'); return body + '.' + sign(body); }
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}
function isAdmin(req) {
  const t = parseCookies(req).vm_admin;
  if (!t) return false;
  const [body, sig] = t.split('.');
  if (!body || !sig) return false;
  const a = Buffer.from(sig), b = Buffer.from(sign(body));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString()).exp > Date.now(); } catch { return false; }
}
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();

/* ---------- ограничение частоты ---------- */
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { hits.set(key, arr); return true; }
  arr.push(now); hits.set(key, arr); return false;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < 3600e3)) hits.delete(k); }, 600e3).unref();
const ipOf = (req) => (process.env.TRUST_CF === '1' && req.headers['cf-connecting-ip'] ? String(req.headers['cf-connecting-ip']) : req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();

/* ---------- подтверждение телефона через Telegram-бота и карта ---------- */
const VERIFY_ON = !!process.env.TELEGRAM_BOT_TOKEN;   // проверка включается, когда подключён бот
const signTok = (data) => {
  const body = Buffer.from(JSON.stringify(data)).toString('base64url');
  return body + '.' + crypto.createHmac('sha256', SECRET).update('phone.' + body).digest('base64url');
};
function readTok(tok) {
  const [body, sig] = String(tok || '').split('.');
  if (!body || !sig) return null;
  const a = Buffer.from(sig), b = Buffer.from(crypto.createHmac('sha256', SECRET).update('phone.' + body).digest('base64url'));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { const d = JSON.parse(Buffer.from(body, 'base64url').toString()); return d.exp > Date.now() ? d : null; } catch { return null; }
}
const tgSessions = new Map();   // sid -> { exp, phone, user }
const tgByChat = new Map();     // chat id -> sid
let TG_BOT = '', tgOffset = 0;
async function tgApi(method, body, timeout = 15000) {
  const r = await fetch(`${process.env.TELEGRAM_API_BASE || 'https://api.telegram.org'}/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(timeout) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(`Telegram ${method}: ${j.description || r.status}`);
  return j.result;
}
const say = (chat, text, extra) => tgApi('sendMessage', { chat_id: chat, text, ...extra }).catch((e) => console.warn(e.message));
async function onTgUpdate(u) {
  const m = u.message;
  if (!m || !m.chat || m.chat.type !== 'private') return;
  const chat = m.chat.id, now = Date.now();
  const sOf = () => tgSessions.get(tgByChat.get(chat));
  if (m.contact) {
    const s = sOf();
    if (!m.contact.user_id || m.contact.user_id !== m.from.id) return say(chat, botText('own', s && s.lang));
    if (!s || s.exp < now) return say(chat, botText('exp', s && s.lang), { reply_markup: { remove_keyboard: true } });
    s.phone = String(m.contact.phone_number || '').replace(/\D/g, ''); s.user = m.from.username || ''; s.chat = chat;
    await say(chat, botText('ok', s.lang), { reply_markup: { remove_keyboard: true } });
    return say(chat, '👇', { reply_markup: { inline_keyboard: [[{ text: botText('back', s.lang), url: `${SITE_URL}/?tg=${tgByChat.get(chat)}` }]] } });
  }
  const t = String(m.text || '');
  if (t.startsWith('/start')) {
    const sid = t.split(/\s+/)[1] || '';
    const s = tgSessions.get(sid);
    if (!s || s.exp < now) return say(chat, botText('open', 'ru') + '\n\n' + botText('open', 'uz'));
    tgByChat.set(chat, sid);
    return say(chat, botText('start', s.lang), { reply_markup: { keyboard: [[{ text: botText('btn', s.lang), request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } });
  }
  return say(chat, botText('about', 'ru') + '\n\n' + botText('about', 'uz'));
}
async function tgLoop() {
  if (!VERIFY_ON) return;
  for (;;) {
    try {
      if (!TG_BOT) {
        const me = await tgApi('getMe'); TG_BOT = me.username;
        await tgApi('deleteWebhook', { drop_pending_updates: false });
        console.log('  Telegram-бот для проверки номеров: @' + TG_BOT);
      }
      const ups = await tgApi('getUpdates', { offset: tgOffset, timeout: 25, allowed_updates: ['message'] }, 40000);
      for (const u of ups) { tgOffset = u.update_id + 1; try { await onTgUpdate(u); } catch (e) { console.warn('TG update:', e.message); } }
    } catch (e) { console.warn(e.message); await new Promise((r) => setTimeout(r, 5000)); }
  }
}
setInterval(() => { const n = Date.now(); for (const [k, v] of tgSessions) if (v.exp < n) tgSessions.delete(k); for (const [c, sid] of tgByChat) if (!tgSessions.has(sid)) tgByChat.delete(c); }, 60e3).unref();
/* поиск адресов через OpenStreetMap (бесплатно), не чаще 1 запроса в секунду */
const geoCache = new Map(); let geoChain = Promise.resolve();
function nominatim(path) {
  if (geoCache.has(path)) return Promise.resolve(geoCache.get(path));
  const run = geoChain.then(async () => {
    const r = await fetch('https://nominatim.openstreetmap.org' + path, { headers: { 'User-Agent': 'velmont-shop/1.0', 'Accept-Language': 'ru' }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error('geo ' + r.status);
    const j = await r.json(); geoCache.set(path, j); if (geoCache.size > 500) geoCache.delete(geoCache.keys().next().value);
    await new Promise((x) => setTimeout(x, 1100));
    return j;
  });
  geoChain = run.catch(() => {});
  return run;
}

/* ---------- Telegram ---------- */
const h = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chats = (process.env.TELEGRAM_CHAT_ID || '').split(',').map((s) => s.trim()).filter(Boolean);   // можно число или @имя_канала
  if (!token || !chats.length) return { ok: false, reason: 'Telegram не настроен (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)' };
  let ok = false, reason = '';
  for (const chat of chats) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }),
        signal: AbortSignal.timeout(10000),
      });
      const j = await r.json().catch(() => ({}));
      if (j.ok) ok = true; else reason = j.description || 'ошибка Telegram';
    } catch (e) { reason = e.message; }
  }
  return { ok, reason };
}
const money = (n) => new Intl.NumberFormat('ru-RU').format(n) + ' сум';
/** Сообщение покупателю в Telegram (только если он подтверждал номер через бота) */
async function tgToBuyer(order, kind) {
  if (!VERIFY_ON || !order || !order.tgChat) return false;
  const text = buyerMsg(kind, order, order.lang); if (!text) return false;
  try { await tgApi('sendMessage', { chat_id: order.tgChat, text, parse_mode: 'HTML', disable_web_page_preview: true }); return true; }
  catch (e) { console.warn('buyer notify:', e.message); return false; }
}
const pay = createPayments({
  siteUrl: SITE_URL, getOrders: () => readJSON(ORDERS_FILE, []), mutateOrders,
  onPaid: (o) => { sendTelegram(`💳 <b>Оплачено онлайн: ${h(o.id)}</b> · ${money(o.total)} (${h(o.payment.method)})`); tgToBuyer(o, 'paid'); },
});

/* ---------- промокоды ---------- */
function applyPromo(code, subtotal, phoneDigits) {
  const pr = readJSON(PROMOS_FILE, []).find((x) => x.code === code);
  const today = new Date().toISOString().slice(0, 10);
  if (!pr || !pr.active || (pr.expires && pr.expires < today) || (pr.limit && pr.used >= pr.limit)) return { error: 'Промокод не найден или уже недействителен', code: 'notfound' };
  if (pr.minTotal && subtotal < pr.minTotal) return { error: `Промокод действует от ${money(pr.minTotal)}`, code: 'min', min: pr.minTotal };
  if (pr.firstOrder) {
    if (!phoneDigits) return { error: 'Промокод для первого заказа: сначала подтвердите номер телефона', code: 'phone' };
    if (readJSON(ORDERS_FILE, []).some((o) => String(o.phone || '').replace(/\D/g, '') === phoneDigits)) return { error: 'Этот промокод действует только на первый заказ', code: 'first' };
  }
  let d = pr.type === 'percent' ? Math.round((subtotal * Math.min(90, pr.value)) / 100) : Math.round(pr.value);
  d = Math.max(0, Math.min(d, subtotal));
  return { promo: pr, discount: d };
}
function cleanPromos(list, old) {
  if (!Array.isArray(list)) throw new Error('Некорректный список');
  const seen = new Set();
  return list.slice(0, 100).map((x) => {
    const code = str(x && x.code, 24).toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if (code.length < 3) throw new Error('Промокод: минимум 3 символа (латиница и цифры)');
    if (seen.has(code)) throw new Error('Промокод повторяется: ' + code);
    seen.add(code);
    const type = x.type === 'fixed' ? 'fixed' : 'percent', value = Math.round(Number(x.value));
    if (!(value > 0)) throw new Error(`Промокод ${code}: укажите размер скидки`);
    if (type === 'percent' && value > 90) throw new Error(`Промокод ${code}: скидка не может быть больше 90%`);
    const prev = (old || []).find((o) => o.code === code);
    return { code, type, value, minTotal: Math.max(0, Math.round(Number(x.minTotal)) || 0), firstOrder: !!x.firstOrder, active: x.active !== false, expires: /^\d{4}-\d{2}-\d{2}$/.test(x.expires || '') ? x.expires : '', limit: Math.max(0, Math.round(Number(x.limit)) || 0), used: prev ? prev.used : 0, note: str(x.note, 80) };
  });
}
function cleanReviews(list) {
  if (!Array.isArray(list)) throw new Error('Некорректный список');
  return list.slice(0, 60).map((r) => {
    const text = str(r && r.text, 600), name = str(r && r.name, 60);
    if (!name || !text) throw new Error('У отзыва должны быть имя и текст');
    return { id: /^[a-z0-9_-]{1,40}$/i.test((r && r.id) || '') ? r.id : rid('r'), name, city: str(r.city, 40), text, rating: Math.max(1, Math.min(5, Math.round(Number(r.rating)) || 5)), photo: okImage(r.photo) ? r.photo : '', show: r.show !== false };
  });
}

/* ---------- HTTP-утилиты ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};
const CSP = "default-src 'self'; img-src 'self' data: https:; media-src 'self' https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; font-src https://fonts.gstatic.com; script-src 'self' https://cdn.jsdelivr.net https://mc.yandex.ru https://www.googletagmanager.com https://www.google-analytics.com; connect-src 'self' https://mc.yandex.ru https://mc.yandex.com https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com; frame-src https://mc.yandex.ru; child-src https://mc.yandex.ru; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
function baseHeaders(extra) {
  return Object.assign({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': CSP }, extra);
}
function send(res, status, obj, extra) {
  res.writeHead(status, baseHeaders(Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, extra)));
  res.end(JSON.stringify(obj));
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error('Слишком большой файл'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(Object.assign(new Error('Некорректный JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error('Слишком большой запрос'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/* ---------- API ---------- */
const defaultCatalog = () => readJSON(CATALOG_FILE, { categories: [], products: [] });

async function handleApi(req, res, url) {
  const p = url.pathname;
  const method = req.method;

  if (method === 'GET' && p === '/api/catalog') return send(res, 200, defaultCatalog());
  if (method === 'GET' && p === '/api/settings') return send(res, 200, readJSON(SETTINGS_FILE, {}));

  if (method === 'POST' && p === '/api/admin/upload-video') {
    if (!isAdmin(req)) return send(res, 401, { error: 'Нужен вход' });
    const LIM = SB ? 50e6 : 60e6;
    const chunks = []; let size = 0, tooBig = false;
    await new Promise((resolve) => {
      req.on('data', (c) => { size += c.length; if (size > LIM) { tooBig = true; req.destroy(); resolve(); } else chunks.push(c); });
      req.on('end', resolve); req.on('error', resolve);
    });
    if (tooBig) return send(res, 413, { error: `Видео больше ${SB ? 50 : 60} МБ. Сожмите его или выберите покороче.` });
    const buf = Buffer.concat(chunks);
    const isMp4 = buf.length > 12 && buf.slice(4, 8).toString() === 'ftyp';
    const isWebm = buf.length > 4 && buf.slice(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    if (!(isMp4 || isWebm)) return send(res, 400, { error: 'Нужен файл MP4 или WebM' });
    const file = crypto.randomBytes(8).toString('hex') + (isMp4 ? '.mp4' : '.webm');
    await saveUpload(file, buf, isMp4 ? 'video/mp4' : 'video/webm');
    return send(res, 200, { ok: true, path: 'uploads/' + file });
  }

  /* настройки проверки и поиск адресов */
  if (method === 'GET' && p === '/api/config') return send(res, 200, { verifyRequired: VERIFY_ON, payments: pay.enabled, lowStock: Math.max(0, parseInt(readJSON(SETTINGS_FILE, {}).lowStock, 10) || 3) });
  if (method === 'GET' && p === '/api/reviews') return send(res, 200, { reviews: readJSON(REVIEWS_FILE, []).filter((r) => r.show !== false) });
  /* вебхуки платёжных систем (до проверки Content-Type: Click шлёт форму) */
  if (method === 'POST' && p === '/api/pay/payme') {
    const b = JSON.parse((await readRaw(req, 100e3)) || '{}');
    return send(res, 200, await pay.handlePayme(req.headers.authorization, b));
  }
  if (method === 'POST' && p === '/api/pay/click') {
    const raw = await readRaw(req, 20e3);
    let f; try { f = /json/i.test(req.headers['content-type'] || '') ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw)); } catch { f = {}; }
    return send(res, 200, await pay.handleClick(f));
  }
  if (method === 'GET' && p === '/api/tg/status') {
    if (limited('tgs:' + ipOf(req), 150, 60e3)) return send(res, 429, { error: 'Слишком часто' });
    const s = tgSessions.get(str(url.searchParams.get('sid'), 64));
    if (!s || s.exp < Date.now()) return send(res, 200, { expired: true });
    if (!s.phone) return send(res, 200, { verified: false });
    return send(res, 200, { verified: true, phone: '+' + s.phone, token: signTok({ p: s.phone, u: s.user, c: s.chat || 0, exp: Date.now() + 30 * 60e3 }) });
  }
  if (method === 'GET' && p === '/api/track') {
    if (limited('trk:' + ipOf(req), 90, 60e3)) return send(res, 429, { error: 'Слишком часто' });
    const pairs = str(url.searchParams.get('o'), 600).split(',').slice(0, 10);
    const orders = readJSON(ORDERS_FILE, []), out = [];
    for (const pr of pairs) {
      const [id, key] = pr.split(':');
      const o = orders.find((x) => x.id === id);
      if (!o || !o.track || !key) continue;
      const a = Buffer.from(String(key)), b2 = Buffer.from(o.track);
      if (a.length !== b2.length || !crypto.timingSafeEqual(a, b2)) continue;
      out.push({ id: o.id, status: o.status === 'done' ? 'done' : o.status === 'shipping' ? 'shipping' : 'new', trackNo: o.trackNo || '', date: o.date, updated: o.updated || o.date, total: o.total, discount: o.discount || 0, pay: o.payment ? o.payment.status : 'cod', payUrl: o.payment && o.payment.status === 'pending' && o.payment.method !== 'cod' ? pay.payUrl(o, o.payment.method) : '' });
    }
    return send(res, 200, { orders: out });
  }
  if (method === 'GET' && p === '/api/track/phone') {   // найти свои заказы по номеру, подтверждённому через Telegram
    if (!VERIFY_ON) return send(res, 503, { error: 'Поиск по номеру пока не подключён' });
    if (limited('trkp:' + ipOf(req), 30, 600e3)) return send(res, 429, { error: 'Слишком часто. Попробуйте позже.' });
    const d = readTok(url.searchParams.get('token'));
    if (!d || !d.p) return send(res, 400, { error: 'Подтвердите номер через Telegram ещё раз' });
    const out = readJSON(ORDERS_FILE, []).filter((o) => o.track && String(o.phone || '').replace(/\D/g, '') === String(d.p)).slice(0, 10)
      .map((o) => ({ id: o.id, key: o.track, date: o.date }));
    return send(res, 200, { orders: out });
  }
  if (method === 'GET' && p === '/api/geo/search') {
    if (limited('geo:' + ipOf(req), 40, 60e3)) return send(res, 429, { error: 'Слишком часто. Подождите минуту.' });
    const q = str(url.searchParams.get('q'), 120);
    if (q.length < 3) return send(res, 200, { results: [] });
    try {
      const j = await nominatim('/search?format=jsonv2&countrycodes=uz&limit=6&accept-language=ru&q=' + encodeURIComponent(q));
      return send(res, 200, { results: j.map((x) => ({ name: x.display_name, lat: +x.lat, lon: +x.lon })) });
    } catch { return send(res, 502, { error: 'Поиск адресов временно недоступен' }); }
  }
  if (method === 'GET' && p === '/api/geo/reverse') {
    if (limited('geo:' + ipOf(req), 40, 60e3)) return send(res, 429, { error: 'Слишком часто. Подождите минуту.' });
    const lat = Number(url.searchParams.get('lat')), lon = Number(url.searchParams.get('lon'));
    if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return send(res, 400, { error: 'Неверные координаты' });
    try {
      const j = await nominatim(`/reverse?format=jsonv2&zoom=18&accept-language=ru&lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`);
      return send(res, 200, { name: j.display_name || '' });
    } catch { return send(res, 200, { name: '' }); }
  }

  if (method !== 'GET' && !/^application\/json/i.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'Нужен JSON' });

  /* подтверждение номера через Telegram */
  if (method === 'POST' && p === '/api/tg/start') {
    if (!VERIFY_ON) return send(res, 503, { error: 'Подтверждение номера пока не подключено' });
    if (limited('tgst:' + ipOf(req), 20, 3600e3)) return send(res, 429, { error: 'Слишком много попыток. Попробуйте через час.' });
    if (!TG_BOT) return send(res, 503, { error: 'Бот ещё запускается. Попробуйте через несколько секунд.' });
    const sid = crypto.randomBytes(16).toString('hex');
    const sb = await readBody(req, 1e3).catch(() => ({}));
    tgSessions.set(sid, { exp: Date.now() + 10 * 60e3, phone: '', user: '', chat: 0, lang: sb.lang === 'uz' ? 'uz' : 'ru' });
    return send(res, 200, { sid, link: `https://t.me/${TG_BOT}?start=${sid}` });
  }

  /* проверка промокода */
  if (method === 'POST' && p === '/api/promo/check') {
    if (limited('promo:' + ipOf(req), 30, 600e3)) return send(res, 429, { error: 'Слишком много попыток. Попробуйте позже.' });
    const b = await readBody(req, 20e3);
    const code = str(b.code, 24).toUpperCase();
    if (!code) return send(res, 400, { error: 'Введите промокод' });
    const cat = defaultCatalog(); let subtotal = 0;
    for (const it of (Array.isArray(b.items) ? b.items : []).slice(0, 40)) { const pr = cat.products.find((x) => x.id === it.id), q = Math.round(Number(it.qty)); if (pr && q >= 1 && q <= 20) subtotal += pr.price * q; }
    let digits = ''; const d = readTok(b.phoneToken);
    if (d && d.p) digits = String(d.p); else if (!VERIFY_ON) digits = String(b.phone || '').replace(/\D/g, '');
    const r = applyPromo(code, subtotal, digits.length >= 7 ? digits : '');
    if (r.error) return send(res, 400, { error: r.error, code: r.code, min: r.min });
    return send(res, 200, { ok: true, code: r.promo.code, type: r.promo.type, value: r.promo.value, discount: r.discount, subtotal, total: subtotal - r.discount });
  }

  /* оформление заказа */
  if (method === 'POST' && p === '/api/order') {
    if (limited('order:' + ipOf(req), 6, 600e3)) return send(res, 429, { error: 'Слишком много заказов. Попробуйте позже.' });
    const cfg = readJSON(SETTINGS_FILE, {});
    if (cfg.ordersPaused === '1') return send(res, 503, { error: cfg.pausedText || 'Приём заказов временно приостановлен. Загляните чуть позже.' });
    const b = await readBody(req, 50e3);
    const name = str(b.name, 80); let phone = str(b.phone, 30); const address = str(b.address, 300), comment = str(b.comment, 500);
    if (b.website) return send(res, 200, { ok: true, id: 'VM-0000' }); // ловушка для ботов
    if (name.length < 2) return send(res, 400, { error: 'Укажите имя' });
    let tgUser = '', tgChat = '';
    if (VERIFY_ON) {
      const d = readTok(b.phoneToken);
      if (!d || !d.p) return send(res, 400, { error: 'Подтвердите номер телефона через Telegram' });
      phone = '+' + d.p; tgUser = String(d.u || '').slice(0, 40); tgChat = d.c ? String(d.c) : '';
    } else if (phone.replace(/\D/g, '').length < 7) return send(res, 400, { error: 'Укажите номер телефона' });
    const lat = Number(b.location && b.location.lat), lon = Number(b.location && b.location.lon);
    if (!(Number.isFinite(lat) && Number.isFinite(lon))) return send(res, 400, { error: 'Выберите адрес доставки на карте' });
    if (!(lat > 36 && lat < 46 && lon > 55 && lon < 74)) return send(res, 400, { error: 'Доставка возможна только по Узбекистану. Проверьте точку на карте.' });
    if (address.length < 5) return send(res, 400, { error: 'Укажите адрес доставки' });
    const lang = b.lang === 'uz' ? 'uz' : 'ru';
    const payMethod = ['payme', 'click'].includes(b.payment) && pay.enabled[b.payment] ? b.payment : 'cod';
    const cat = defaultCatalog();
    const lines = [], taken = {}; let subtotal = 0;
    for (const it of (Array.isArray(b.items) ? b.items : []).slice(0, 40)) {
      const prod = cat.products.find((x) => x.id === it.id);
      const qty = Math.round(Number(it.qty));
      if (!prod || !(qty >= 1 && qty <= 20)) continue;
      if (prod.inStock === false) return send(res, 400, { error: `«${prod.name}» временно нет в наличии` });
      taken[prod.id] = (taken[prod.id] || 0) + qty;
      if (prod.stock != null && taken[prod.id] > prod.stock) return send(res, 400, { error: `«${prod.name}»: осталось только ${prod.stock} шт.` });
      const size = str(it.size, 12);
      if ((prod.sizes || []).length && !prod.sizes.includes(size)) return send(res, 400, { error: `Выберите размер для «${prod.name}»` });
      lines.push({ id: prod.id, name: prod.name, size, qty, price: prod.price });
      subtotal += prod.price * qty;
    }
    if (!lines.length) return send(res, 400, { error: 'Корзина пуста' });
    let discount = 0, promoCode = '';
    const code = str(b.promo, 24).toUpperCase();
    if (code) {
      const r = applyPromo(code, subtotal, phone.replace(/\D/g, ''));
      if (r.error) return send(res, 400, { error: r.error, code: r.code, min: r.min });
      discount = r.discount; promoCode = r.promo.code;
    }
    const total = Math.max(0, subtotal - discount);
    const id = 'VM-' + Date.now().toString(36).toUpperCase().slice(-5);
    const text = [
      `🛍 <b>Новый заказ ${id}</b>`, '',
      `👤 ${h(name)}`, `📞 ${h(phone)}`,
      `📍 ${h(address)}`, `🗺 <a href="https://www.google.com/maps?q=${lat.toFixed(6)},${lon.toFixed(6)}">Открыть точку на карте</a>`, VERIFY_ON ? `✅ номер подтверждён через Telegram${tgUser ? ' (@' + h(tgUser) + ')' : ''}` : '', comment ? `💬 ${h(comment)}` : '', '',
      ...lines.map((l, i) => `${i + 1}. ${h(l.name)}${l.size ? ` · ${h(l.size)}` : ''} × ${l.qty} — ${money(l.price * l.qty)}`),
      '', promoCode ? `🏷 Промокод ${h(promoCode)}: −${money(discount)}` : '', `💰 <b>Итого: ${money(total)}</b>`,
      payMethod === 'cod' ? '💵 Оплата при получении' : `💳 Онлайн (${payMethod === 'payme' ? 'Payme' : 'Click'}): ждём оплату, придёт отдельное сообщение`,
      lang === 'uz' ? '🌐 Покупатель выбрал узбекский язык' : '',
    ].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n');
    const tg = await sendTelegram(text);
    const trackKey = crypto.randomBytes(9).toString('hex');
    const order = { id, date: new Date().toISOString(), name, phone, phoneVerified: VERIFY_ON, tgUser, tgChat, lang, address, location: { lat: +lat.toFixed(6), lon: +lon.toFixed(6) }, comment, items: lines, subtotal, discount, promo: promoCode, total, payment: { method: payMethod, status: payMethod === 'cod' ? 'cod' : 'pending' }, telegram: tg.ok, status: 'new', track: trackKey, trackNo: '', updated: new Date().toISOString() };
    await mutateOrders((orders) => { orders.unshift(order); });
    if (!tg.ok) console.warn('Telegram:', tg.reason);
    /* остатки и счётчик промокода */
    try {
      const cat2 = defaultCatalog(), low = [], thr = Math.max(0, parseInt(cfg.lowStock, 10) || 3);
      for (const l of lines) { const pr = cat2.products.find((x) => x.id === l.id); if (pr && pr.stock != null) { pr.stock = Math.max(0, pr.stock - l.qty); if (pr.stock === 0) pr.inStock = false; if (pr.stock <= thr) low.push(pr); } }
      if (lines.some((l) => (cat2.products.find((x) => x.id === l.id) || {}).stock != null)) await writeJSON(CATALOG_FILE, cat2);
      if (low.length) sendTelegram('⚠️ <b>Заканчивается:</b>\n' + low.map((x) => `${h(x.name)} — ${x.stock ? 'осталось ' + x.stock + ' шт.' : 'нет в наличии'}`).join('\n'));
      if (promoCode) { const promos = readJSON(PROMOS_FILE, []), pr = promos.find((x) => x.code === promoCode); if (pr) { pr.used = (pr.used || 0) + 1; await writeJSON(PROMOS_FILE, promos); } }
    } catch (e) { console.warn('stock/promo:', e.message); }
    tgToBuyer(order, 'created');
    return send(res, 200, { ok: true, id, key: trackKey, telegram: tg.ok, total, discount, payUrl: payMethod === 'cod' ? '' : pay.payUrl(order, payMethod) });
  }

  /* вход / выход */
  if (method === 'POST' && p === '/api/login') {
    const ip = ipOf(req);
    if (limited('login:' + ip, 8, 600e3)) return send(res, 429, { error: 'Слишком много попыток. Подождите 10 минут.' });
    if (!ADMIN_PASSWORD) return send(res, 503, { error: 'Пароль не задан: впишите ADMIN_PASSWORD в файл .env и перезапустите сервер' });
    const b = await readBody(req, 5e3);
    const okUser = crypto.timingSafeEqual(sha(String(b.username || '').trim().toLowerCase()), sha(ADMIN_USER.toLowerCase()));
    const okPass = crypto.timingSafeEqual(sha(b.password || ''), sha(ADMIN_PASSWORD));
    if (!(okUser && okPass)) return send(res, 401, { error: 'Неверный логин или пароль' });
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    return send(res, 200, { ok: true }, { 'Set-Cookie': `vm_admin=${makeToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secure}` });
  }
  if (method === 'POST' && p === '/api/logout') return send(res, 200, { ok: true }, { 'Set-Cookie': 'vm_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  if (method === 'GET' && p === '/api/me') return send(res, 200, { admin: isAdmin(req), configured: !!ADMIN_PASSWORD });

  /* ---- только для администратора ---- */
  if (!p.startsWith('/api/admin/')) return send(res, 404, { error: 'Не найдено' });
  if (!isAdmin(req)) return send(res, 401, { error: 'Нужен вход' });

  if (method === 'GET' && p === '/api/admin/status') {
    return send(res, 200, { telegram: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID), target: process.env.TELEGRAM_CHAT_ID || '', weakPassword: passwordWeak(ADMIN_PASSWORD), verify: VERIFY_ON, payments: pay.enabled, backupChat: !!(process.env.BACKUP_CHAT_ID && process.env.TELEGRAM_BOT_TOKEN), lastBackup: readJSON(META_FILE, {}).lastBackup || 0, siteUrl: SITE_URL });
  }
  if (method === 'POST' && p === '/api/admin/test-telegram') {
    const r = await sendTelegram('✅ VELMONT: Telegram подключён. Заказы будут приходить сюда.');
    return send(res, r.ok ? 200 : 502, r.ok ? { ok: true } : { error: r.reason });
  }

  if (method === 'POST' && p === '/api/admin/products') {
    const cat = defaultCatalog();
    const b = await readBody(req, 100e3);
    const item = cleanProduct(b, cat.categories);
    const i = cat.products.findIndex((x) => x.id === item.id);
    if (i >= 0) cat.products[i] = item; else cat.products.push(item);
    await writeJSON(CATALOG_FILE, cat); gcUploads();
    return send(res, 200, { ok: true, product: item });
  }
  if (method === 'DELETE' && p.startsWith('/api/admin/products/')) {
    const id = decodeURIComponent(p.split('/').pop());
    const cat = defaultCatalog();
    cat.products = cat.products.filter((x) => x.id !== id);
    await writeJSON(CATALOG_FILE, cat); gcUploads();
    return send(res, 200, { ok: true });
  }
  if (method === 'PUT' && p === '/api/admin/categories') {
    const cat = defaultCatalog();
    const categories = cleanCategories((await readBody(req, 30e3)).categories);
    const orphan = cat.products.find((x) => !categories.some((c) => c.id === x.cat));
    if (orphan) throw Object.assign(new Error(`В удаляемом каталоге ещё есть товары (например «${orphan.name}»). Сначала перенесите или удалите их.`), { status: 400 });
    cat.categories = categories;
    await writeJSON(CATALOG_FILE, cat);
    return send(res, 200, { ok: true, categories });
  }
  if (method === 'PUT' && p === '/api/admin/settings') {
    const s = cleanSettings(await readBody(req, 30e3));
    await writeJSON(SETTINGS_FILE, s); gcUploads();
    return send(res, 200, { ok: true, settings: s });
  }
  if (method === 'POST' && p === '/api/admin/upload') {
    const b = await readBody(req, 12e6);
    const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(b.data || '');
    if (!m) return send(res, 400, { error: 'Поддерживаются JPG, PNG и WebP' });
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 6e6) return send(res, 413, { error: 'Файл больше 6 МБ' });
    const isPng = buf.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const isJpg = buf.slice(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    const isWebp = buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP';
    if (!(isPng || isJpg || isWebp)) return send(res, 400, { error: 'Файл не похож на изображение' });
    const ext = isPng ? 'png' : isJpg ? 'jpg' : 'webp', base = crypto.randomBytes(8).toString('hex');
    await saveUpload(base + '.' + ext, buf, isPng ? 'image/png' : isJpg ? 'image/jpeg' : 'image/webp');
    const tm = /^data:image\/webp;base64,([A-Za-z0-9+/=]+)$/.exec(b.thumb || '');   // уменьшенная копия для карточек каталога
    if (tm) { const tb = Buffer.from(tm[1], 'base64'); if (tb.length < 1.5e6 && tb.slice(0, 4).toString() === 'RIFF') await saveUpload(base + '-s.webp', tb, 'image/webp'); }
    return send(res, 200, { ok: true, path: 'uploads/' + base + '.' + ext, bytes: buf.length });
  }
  if (method === 'GET' && p === '/api/admin/backup') {
    const body = JSON.stringify({ exportedAt: new Date().toISOString(), catalog: defaultCatalog(), settings: readJSON(SETTINGS_FILE, {}), orders: readJSON(ORDERS_FILE, []), promos: readJSON(PROMOS_FILE, []), reviews: readJSON(REVIEWS_FILE, []) }, null, 2);
    res.writeHead(200, baseHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="velmont-backup-${new Date().toISOString().slice(0, 10)}.json"`, 'Cache-Control': 'no-store' }));
    return res.end(body);
  }
  if (method === 'GET' && p === '/api/admin/orders') return send(res, 200, { orders: readJSON(ORDERS_FILE, []) });
  if (method === 'GET' && p === '/api/admin/orders.xlsx') {
    const orders = readJSON(ORDERS_FILE, []);
    const ST = { new: 'Новый', shipping: 'Доставляется', done: 'Доставлен' }, PAYN = { cod: 'При получении', pending: 'Ждём оплату', paid: 'Оплачен', cancelled: 'Отменена' };
    const dt = (d) => new Date(d).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' });
    const head = ['Номер', 'Дата', 'Статус', 'Оплата', 'Имя', 'Телефон', 'Telegram', 'Адрес', 'Карта', 'Комментарий', 'Состав', 'Сумма товаров', 'Скидка', 'Промокод', 'Итого', '№ BTS'];
    const rows1 = [head, ...orders.map((o) => [o.id, dt(o.date), ST[o.status] || 'Новый', PAYN[o.payment ? o.payment.status : 'cod'] || '', o.name, o.phone, o.tgUser ? '@' + o.tgUser : '', o.address || '', o.location ? `https://www.google.com/maps?q=${o.location.lat},${o.location.lon}` : '', o.comment || '', o.items.map((i) => `${i.name}${i.size ? ' ' + i.size : ''} ×${i.qty}`).join('; '), o.subtotal || o.total, o.discount || 0, o.promo || '', o.total, o.trackNo || ''])];
    const rows2 = [['Номер заказа', 'Дата', 'Товар', 'Размер', 'Кол-во', 'Цена', 'Сумма'], ...orders.flatMap((o) => o.items.map((i) => [o.id, dt(o.date), i.name, i.size || '', i.qty, i.price, i.price * i.qty]))];
    res.writeHead(200, baseHeaders({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="velmont-orders-${new Date().toISOString().slice(0, 10)}.xlsx"`, 'Cache-Control': 'no-store' }));
    return res.end(xlsx([{ name: 'Заказы', rows: rows1, widths: [11, 18, 14, 15, 18, 16, 14, 40, 30, 28, 50, 14, 11, 12, 14, 14] }, { name: 'Товары в заказах', rows: rows2, widths: [12, 18, 34, 9, 9, 13, 14] }]));
  }
  if (method === 'GET' && p === '/api/admin/promos') return send(res, 200, { promos: readJSON(PROMOS_FILE, []) });
  if (method === 'PUT' && p === '/api/admin/promos') {
    const promos = cleanPromos((await readBody(req, 60e3)).promos, readJSON(PROMOS_FILE, []));
    await writeJSON(PROMOS_FILE, promos);
    return send(res, 200, { ok: true, promos });
  }
  if (method === 'GET' && p === '/api/admin/reviews') return send(res, 200, { reviews: readJSON(REVIEWS_FILE, []) });
  if (method === 'PUT' && p === '/api/admin/reviews') {
    const reviews = cleanReviews((await readBody(req, 100e3)).reviews);
    await writeJSON(REVIEWS_FILE, reviews); gcUploads();
    return send(res, 200, { ok: true, reviews });
  }
  if (method === 'POST' && p === '/api/admin/backup-telegram') {
    const r = await sendBackupToTelegram();
    return send(res, r.ok ? 200 : 502, r.ok ? { ok: true } : { error: r.reason });
  }
  if (method === 'PATCH' && p.startsWith('/api/admin/orders/')) {
    const id = decodeURIComponent(p.split('/').pop());
    const b = await readBody(req, 2e3);
    let notify = null, snap = null;
    const found = await mutateOrders((orders) => {
      const o = orders.find((x) => x.id === id);
      if (!o) return false;
      const prevStatus = o.status, prevTrack = o.trackNo || '';
      if (b.status !== undefined) { const st = ['new', 'shipping', 'done'].includes(b.status) ? b.status : 'new'; if (st !== o.status) o.updated = new Date().toISOString(); o.status = st; }
      if (b.trackNo !== undefined) o.trackNo = str(b.trackNo, 40);
      if (o.status !== prevStatus) notify = o.status === 'shipping' ? 'shipping' : o.status === 'done' ? 'done' : null;
      else if (o.trackNo && o.trackNo !== prevTrack && o.status === 'shipping') notify = 'track';
      snap = { ...o };
      return true;
    });
    if (!found) return send(res, 404, { error: 'Заказ не найден' });
    const sent = notify ? await tgToBuyer(snap, notify) : false;   // сбой Telegram не мешает сохранению статуса
    return send(res, 200, { ok: true, notified: sent });
  }
  if (method === 'DELETE' && p.startsWith('/api/admin/orders/')) {
    const id = decodeURIComponent(p.split('/').pop());
    await writeJSON(ORDERS_FILE, readJSON(ORDERS_FILE, []).filter((x) => x.id !== id));
    return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: 'Не найдено' });
}

/* ---------- превью ссылок (Open Graph), sitemap, robots ---------- */
const INDEX_FILE = path.join(PUB, 'index.html');
const attr = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const absImg = (img) => (!img ? SITE_URL + '/img/og.jpg' : /^https:/i.test(img) ? img : SITE_URL + '/' + String(img).replace(/^\/+/, ''));
const ldJson = (o) => JSON.stringify(o).replace(/</g, '\\u003c');
function renderIndex(productId) {
  let html = fs.readFileSync(INDEX_FILE, 'utf8');
  const set = readJSON(SETTINGS_FILE, {});
  let title = 'VELMONT — мужская одежда', desc = (set.heroText || 'Мужская одежда: верхняя одежда, футболки, брюки и обувь. Заказ в пару касаний, доставка по Узбекистану.').replace(/\s+/g, ' ').slice(0, 200);
  let image = absImg(''), url = SITE_URL + '/', type = 'website', extra = '', ld;
  const sameAs = [set.telegram && 'https://t.me/' + set.telegram, set.instagram && 'https://instagram.com/' + set.instagram].filter(Boolean);
  ld = { '@context': 'https://schema.org', '@type': 'Store', name: 'VELMONT', url: SITE_URL + '/', image, description: desc, ...(sameAs.length ? { sameAs } : {}), ...(set.phone ? { telephone: set.phone } : {}), areaServed: 'UZ', priceRange: 'UZS' };
  const prod = productId && readJSON(CATALOG_FILE, { products: [] }).products.find((x) => x.id === productId);
  if (prod) {
    title = `${prod.name} — VELMONT`;
    desc = `${money(prod.price)}. ${(prod.desc || prod.type || 'Мужская одежда VELMONT').replace(/\s+/g, ' ')}`.slice(0, 200);
    image = absImg(prod.images && prod.images[0]); url = `${SITE_URL}/p/${encodeURIComponent(prod.id)}`; type = 'product';
    extra = `<meta property="product:price:amount" content="${prod.price}"><meta property="product:price:currency" content="UZS">`;
    ld = { '@context': 'https://schema.org', '@type': 'Product', name: prod.name, image: [image], description: prod.desc || prod.name, color: prod.colorName || undefined, brand: { '@type': 'Brand', name: 'VELMONT' }, offers: { '@type': 'Offer', url, priceCurrency: 'UZS', price: prod.price, availability: prod.inStock === false ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock' } };
  }
  const block = `${prod ? '<base href="/">' : ''}<link rel="canonical" href="${attr(url)}">
<meta property="og:site_name" content="VELMONT"><meta property="og:type" content="${type}"><meta property="og:locale" content="ru_RU"><meta property="og:locale:alternate" content="uz_UZ">
<meta property="og:title" content="${attr(title)}"><meta property="og:description" content="${attr(desc)}"><meta property="og:url" content="${attr(url)}"><meta property="og:image" content="${attr(image)}">${prod ? '' : '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">'}${extra}
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${attr(title)}"><meta name="twitter:description" content="${attr(desc)}"><meta name="twitter:image" content="${attr(image)}">
<script type="application/ld+json">${ldJson(ld)}</script>`;
  html = html.replace('<!--SEO-->', block).replace(/<title>[\s\S]*?<\/title>/, `<title>${attr(title)}</title>`).replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${attr(desc)}">`);
  return Buffer.from(html);
}
function sitemapXml() {
  const urls = [SITE_URL + '/', ...readJSON(CATALOG_FILE, { products: [] }).products.map((x) => `${SITE_URL}/p/${encodeURIComponent(x.id)}`)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${attr(u)}</loc></url>`).join('\n')}\n</urlset>\n`;
}

/* ---------- статические файлы (сжатие gzip + ETag) ---------- */
const COMPRESSIBLE = /\.(html|css|js|json|svg|txt|xml)$/i;
const gzCache = new Map();
function sendBuf(req, res, status, type, buf, extra) {
  const etag = 'W/"' + crypto.createHash('sha1').update(buf).digest('base64url').slice(0, 20) + '"';
  const headers = baseHeaders(Object.assign({ 'Content-Type': type, ETag: etag, 'Cache-Control': 'no-cache', Vary: 'Accept-Encoding' }, extra));
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
  if (/\bgzip\b/.test(req.headers['accept-encoding'] || '') && buf.length > 800) {
    let z = gzCache.get(etag);
    if (!z) { z = zlib.gzipSync(buf, { level: 6 }); gzCache.set(etag, z); if (gzCache.size > 80) gzCache.delete(gzCache.keys().next().value); }
    buf = z; headers['Content-Encoding'] = 'gzip';
  }
  headers['Content-Length'] = buf.length;
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : buf);
}
function serveStatic(req, res, url) {
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
  if (rel.includes('\0')) { res.writeHead(400); return res.end(); }
  if (rel === '/admin') { res.writeHead(301, { Location: '/admin/' }); return res.end(); }
  if (rel === '/' || rel === '/index.html') return sendBuf(req, res, 200, 'text/html; charset=utf-8', renderIndex(''));
  if (rel === '/robots.txt') return sendBuf(req, res, 200, 'text/plain; charset=utf-8', Buffer.from(`User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\n\nSitemap: ${SITE_URL}/sitemap.xml\n`));
  if (rel === '/sitemap.xml') return sendBuf(req, res, 200, 'application/xml; charset=utf-8', Buffer.from(sitemapXml()));
  const pm = /^\/p\/([^/]+)\/?$/.exec(rel);
  if (pm) return sendBuf(req, res, 200, 'text/html; charset=utf-8', renderIndex(pm[1]));
  if (SB && rel.startsWith('/uploads/')) {   // фото и видео лежат в Supabase Storage
    const name = path.basename(rel);
    if (!/^[a-z0-9._-]+$/i.test(name) || name.startsWith('.')) { res.writeHead(404); return res.end(); }
    res.writeHead(302, baseHeaders({ Location: `${SB_URL}/storage/v1/object/public/uploads/${name}`, 'Cache-Control': 'public, max-age=86400' }));
    return res.end();
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(PUB, rel));
  if (file !== PUB && !file.startsWith(PUB + path.sep)) { res.writeHead(403); return res.end(); }
  if (path.basename(file).startsWith('.')) { res.writeHead(404); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, baseHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
      return res.end('Страница не найдена');
    }
    const ext = path.extname(file).toLowerCase();
    const heavy = /^\/(uploads|img)\//.test(rel);
    const cache = rel.startsWith('/uploads/') ? 'public, max-age=2592000, immutable' : heavy ? 'public, max-age=86400' : 'no-cache';
    const type = MIME[ext] || 'application/octet-stream';
    const etag = `W/"${st.size}-${Math.round(st.mtimeMs)}"`;
    if (req.headers['if-none-match'] === etag && !req.headers.range) { res.writeHead(304, baseHeaders({ ETag: etag, 'Cache-Control': cache })); return res.end(); }
    if (COMPRESSIBLE.test(file) && st.size < 3e6 && !req.headers.range) {
      return fs.readFile(file, (e2, buf) => { if (e2) { res.writeHead(500); return res.end(); } sendBuf(req, res, 200, type, buf, { 'Cache-Control': cache }); });
    }
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m && (m[1] || m[2])) {   // нужно для видео (перемотка, Safari/iPhone)
      let a = m[1] ? Number(m[1]) : Math.max(0, st.size - Number(m[2]));
      let b = m[1] && m[2] ? Number(m[2]) : st.size - 1;
      b = Math.min(b, st.size - 1);
      if (a > b || a >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, baseHeaders({ 'Content-Type': type, 'Content-Range': `bytes ${a}-${b}/${st.size}`, 'Content-Length': b - a + 1, 'Accept-Ranges': 'bytes', 'Cache-Control': cache }));
      return req.method === 'HEAD' ? res.end() : fs.createReadStream(file, { start: a, end: b }).pipe(res);
    }
    res.writeHead(200, baseHeaders({ 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': cache, ETag: etag }));
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

/* ---------- надёжность: пароль, самопинг, резервная копия в Telegram ---------- */
function passwordWeak(pw) {
  return !pw || pw.length < 12 || [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length < 3;
}
async function sendBackupToTelegram() {
  const chat = (process.env.BACKUP_CHAT_ID || '').trim(), token = process.env.TELEGRAM_BOT_TOKEN;
  if (!chat || !token) return { ok: false, reason: 'Не задан BACKUP_CHAT_ID (личный чат для копий). См. README.' };
  try {
    const body = JSON.stringify({ exportedAt: new Date().toISOString(), catalog: defaultCatalog(), settings: readJSON(SETTINGS_FILE, {}), orders: readJSON(ORDERS_FILE, []), promos: readJSON(PROMOS_FILE, []), reviews: readJSON(REVIEWS_FILE, []) }, null, 2);
    const fd = new FormData();
    fd.append('chat_id', chat); fd.append('caption', '💾 Резервная копия VELMONT');
    fd.append('document', new Blob([body], { type: 'application/json' }), `velmont-backup-${new Date().toISOString().slice(0, 10)}.json`);
    const r = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: 'POST', body: fd, signal: AbortSignal.timeout(30000) });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) return { ok: false, reason: j.description || 'ошибка Telegram' };
    const meta = readJSON(META_FILE, {}); meta.lastBackup = Date.now(); await writeJSON(META_FILE, meta);
    return { ok: true };
  } catch (e) { return { ok: false, reason: e.message }; }
}
function startBackground() {
  const base = (process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
  if (base && process.env.KEEP_ALIVE !== '0') {   // на бесплатном Render сайт не засыпает, пока сам себя «будит»
    setInterval(() => fetch(base + '/healthz', { signal: AbortSignal.timeout(20000) }).catch(() => {}), 10 * 60e3).unref();
    console.log('  Самопинг каждые 10 минут: ' + base + '/healthz');
  }
  if (process.env.BACKUP_CHAT_ID && process.env.TELEGRAM_BOT_TOKEN) {
    const check = async () => { if (Date.now() - (readJSON(META_FILE, {}).lastBackup || 0) > 7 * 864e5) { const r = await sendBackupToTelegram(); if (!r.ok) console.warn('backup:', r.reason); } };
    setTimeout(check, 90e3).unref(); setInterval(check, 6 * 3600e3).unref();
    console.log('  Автокопия в Telegram: раз в неделю');
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    serveStatic(req, res, url);
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 400, { error: e.message || 'Ошибка' });
    if (!e.status) console.error('API error:', e.message);
  }
});
initStorage().then(() => server.listen(PORT, () => {
  tgLoop(); startBackground();
  console.log(`\n  VELMONT запущен:  http://localhost:${PORT}`);
  console.log(SB ? '  Хранилище: Supabase (данные не пропадут при перезапуске)' : '  Хранилище: файлы на этом компьютере');
  console.log(`  Админ-панель:     http://localhost:${PORT}/admin/`);
  if (!ADMIN_PASSWORD) console.log('  ⚠ ADMIN_PASSWORD не задан — вход в админку отключён. Создайте файл .env (см. .env.example).');
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) console.log('  ⚠ Telegram не настроен — заказы будут сохраняться только в админке.');
  if (ADMIN_PASSWORD && passwordWeak(ADMIN_PASSWORD)) console.log('  ⚠ ADMIN_PASSWORD слабый: нужно 12+ символов, с буквами разного регистра, цифрами или знаками (npm run genpass создаст надёжный).');
  if (pay.enabled.payme || pay.enabled.click) console.log('  Онлайн-оплата: ' + [pay.enabled.payme && 'Payme', pay.enabled.click && 'Click'].filter(Boolean).join(', '));
  console.log('');
}))
  .catch((e) => { console.error('\n  Не удалось подключиться к Supabase:', e.message, '\n'); process.exit(1); });
