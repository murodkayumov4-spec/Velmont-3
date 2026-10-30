/* VELMONT — анимации главного меню: побуквенное появление, «плавающая» плашка в шапке, параллакс в мобильном меню */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Слово -> побуквенные span для анимации «выезжают из-под маски» */
export const letters = (s) => [...String(s)].map((c, i) => (c === ' ' ? ' ' : `<span class="ch" style="--k:${i}">${esc(c)}</span>`)).join('');

/** Дублирует текст в .roll, чтобы на наведении слово «прокручивалось» */
export function syncRoll(root = document) {
  root.querySelectorAll('.roll').forEach((r) => {
    const a = r.firstElementChild; if (!a) return;
    let b = r.children[1]; if (!b) { b = document.createElement('span'); b.setAttribute('aria-hidden', 'true'); r.appendChild(b); }
    b.textContent = a.textContent;
  });
}

/** Скользящая плашка под пунктом меню в шапке */
export function initNavPill(nav) {
  const pill = nav && nav.querySelector('.nav-pill'); if (!pill) return;
  const move = (el) => {
    if (!el) { pill.style.opacity = '0'; return; }
    const nr = nav.getBoundingClientRect(), r = el.getBoundingClientRect();
    if (!r.width) return;
    pill.style.width = r.width + 'px'; pill.style.height = r.height + 'px'; pill.style.top = r.top - nr.top + 'px';
    pill.style.transform = `translateX(${r.left - nr.left}px)`; pill.style.opacity = '1';
  };
  const target = (e) => { const a = e.target.closest && e.target.closest('a'); return a && nav.contains(a) && !a.closest('.drop-panel') ? a : null; };
  const rest = () => move(nav.querySelector('a.active'));
  nav.addEventListener('pointerover', (e) => { const a = target(e); if (a) move(a); });
  nav.addEventListener('focusin', (e) => { const a = target(e); if (a) move(a); });
  nav.addEventListener('pointerleave', rest);
  nav.addEventListener('focusout', rest);
  new MutationObserver(() => { if (!nav.matches(':hover')) rest(); }).observe(nav, { attributes: true, attributeFilter: ['class'], subtree: true });
  addEventListener('resize', rest);
  document.fonts && document.fonts.ready.then(rest);
  setTimeout(rest, 3300);   // после заставки
  return rest;
}

/** Мобильное меню: свет и водяной знак слегка следуют за пальцем/мышью */
export function initMenuFx(menu) {
  let raf = 0;
  const set = (e) => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      menu.style.setProperty('--px', ((e.clientX / innerWidth) * 2 - 1).toFixed(3));
      menu.style.setProperty('--py', ((e.clientY / innerHeight) * 2 - 1).toFixed(3));
    });
  };
  menu.addEventListener('pointermove', set, { passive: true });
}
