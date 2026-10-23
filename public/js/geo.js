/* Выбор адреса на карте (OpenStreetMap + Leaflet, бесплатно) */
let leafletP;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  return (leafletP ||= new Promise((res, rej) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(css);
    const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js';
    s.onload = () => res(window.L); s.onerror = () => { leafletP = null; rej(new Error('Не удалось загрузить карту. Проверьте интернет.')); };
    document.head.appendChild(s);
  }));
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TASHKENT = [41.2995, 69.2401];

export async function openMapPicker({ initial, onPick, toast }) {
  let L;
  try { L = await loadLeaflet(); } catch (e) { toast?.(e.message); return; }
  const root = document.createElement('div');
  root.className = 'mp'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Выбор адреса доставки');
  root.innerHTML = `
    <div class="mp-top">
      <button type="button" class="mp-x" data-x aria-label="Закрыть">✕</button>
      <div class="mp-search"><input id="mpQ" placeholder="Введите улицу, дом или место" autocomplete="off" aria-label="Поиск адреса"><ul id="mpRes" hidden></ul></div>
      <button type="button" class="mp-gps" id="mpGps" aria-label="Моё местоположение" title="Моё местоположение"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg></button>
    </div>
    <div class="mp-mapwrap"><div class="mp-map" id="mpMap"></div>
      <svg class="mp-pin" viewBox="0 0 34 44" width="34" height="44" aria-hidden="true"><path d="M17 43S3 29 3 16a14 14 0 0 1 28 0C31 29 17 43 17 43Z" fill="#d8c3a0" stroke="#0d1416" stroke-width="2.5"/><circle cx="17" cy="16" r="5.5" fill="#0d1416"/></svg>
    </div>
    <div class="mp-bar"><p id="mpAddr" class="mp-addr">Передвиньте карту, чтобы метка встала на ваш дом</p><button type="button" class="btn btn-primary" id="mpOk" disabled>Подтвердить адрес</button></div>`;
  document.body.appendChild(root); document.body.classList.add('lock');
  const $ = (s) => root.querySelector(s);
  const map = L.map($('#mpMap'), { zoomControl: true }).setView(initial ? [initial.lat, initial.lon] : TASHKENT, initial ? 17 : 12);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  setTimeout(() => map.invalidateSize(), 60);

  let addr = initial?.address || '', seq = 0, tm, skip = !!initial, touched = !!initial;
  const ok = $('#mpOk'), addrEl = $('#mpAddr');
  if (initial) { addrEl.textContent = addr || 'Точка выбрана'; ok.disabled = false; }
  const close = () => { clearTimeout(tm); map.remove(); root.remove(); document.body.classList.remove('lock'); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  root.addEventListener('click', (e) => { if (e.target.closest('[data-x]')) close(); });

  async function reverse() {
    const c = map.getCenter(), my = ++seq;
    ok.disabled = true; addrEl.textContent = 'Определяем адрес…';
    let name = '';
    try { const r = await fetch(`api/geo/reverse?lat=${c.lat}&lon=${c.lng}`); const j = await r.json(); name = j.name || ''; } catch {}
    if (my !== seq) return;
    addr = name || `Точка на карте (${c.lat.toFixed(5)}, ${c.lng.toFixed(5)})`;
    addrEl.textContent = addr; ok.disabled = false;
  }
  map.on('movestart', () => { if (skip) return; ok.disabled = true; addrEl.textContent = 'Определяем адрес…'; });
  map.on('moveend', () => {
    if (skip) { skip = false; return; }
    touched = true; clearTimeout(tm); tm = setTimeout(reverse, 500);
  });
  ok.onclick = () => { const c = map.getCenter(); onPick({ lat: +c.lat.toFixed(6), lon: +c.lng.toFixed(6), address: addr }); close(); };

  // поиск по названию
  const q = $('#mpQ'), res = $('#mpRes'); let st, sq = 0;
  q.addEventListener('input', () => {
    clearTimeout(st); const v = q.value.trim();
    if (v.length < 3) { res.hidden = true; return; }
    st = setTimeout(async () => {
      const my = ++sq;
      try {
        const r = await fetch('api/geo/search?q=' + encodeURIComponent(v)); const j = await r.json();
        if (my !== sq) return;
        const list = j.results || [];
        res.innerHTML = list.length ? list.map((x, i) => `<li><button type="button" data-i="${i}">${esc(x.name)}</button></li>`).join('') : '<li class="none">Ничего не найдено. Попробуйте иначе или передвиньте карту вручную.</li>';
        res.hidden = false; res._list = list;
      } catch { res.innerHTML = '<li class="none">Поиск временно недоступен. Передвиньте карту вручную.</li>'; res.hidden = false; }
    }, 450);
  });
  res.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]'); if (!b) return;
    const x = res._list[+b.dataset.i]; res.hidden = true; q.value = x.name; touched = true;
    skip = true; addr = x.name; addrEl.textContent = addr; ok.disabled = false;
    map.setView([x.lat, x.lon], 17);
  });
  // моё местоположение
  $('#mpGps').onclick = () => {
    if (!navigator.geolocation) return toast?.('Определение места недоступно в этом браузере');
    navigator.geolocation.getCurrentPosition((p) => map.setView([p.coords.latitude, p.coords.longitude], 17), () => toast?.('Не удалось определить место. Разрешите доступ или найдите адрес вручную.'), { enableHighAccuracy: true, timeout: 10000 });
  };
  if (!initial) setTimeout(() => q.focus({ preventScroll: true }), 120);
}
