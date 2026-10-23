/* VELMONT — дополнительные эффекты: слова заголовков, появление блоков, магнитные кнопки, конфетти */
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;

function splitWords(el) {
  let i = 0;
  const walk = (node) => {
    [...node.childNodes].forEach((n) => {
      if (n.nodeType === 3) {
        const frag = document.createDocumentFragment();
        n.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.append(' '); return; }
          const w = document.createElement('span'); w.className = 'w';
          const inner = document.createElement('i'); inner.textContent = part; inner.style.setProperty('--wi', i++); w.append(inner); frag.append(w);
        });
        n.replaceWith(frag);
      } else if (n.nodeType === 1) walk(n);
    });
  };
  walk(el);
}

export function initFx() {
  if (reduce) return;
  document.documentElement.classList.add('fx');

  // заголовок главной: слова выезжают после заставки
  const h1 = document.querySelector('.hero h1');
  if (h1) { splitWords(h1); h1.closest('.hero').style.setProperty('--base', '1.45s'); requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector('.hero').classList.add('go'))); }
  $$('.about h2').forEach(splitWords);

  // появление блоков
  const targets = [
    ...$$('.section-head'), ...$$('.chips'), ...$$('.about-grid > div'), ...$$('.facts li'), ...$$('.contact-box'), ...$$('.footer > *'),
  ];
  targets.forEach((el, i) => { el.classList.add('fx-rise'); el.style.setProperty('--fd', (el.matches('.facts li') ? $$('.facts li').indexOf(el) * 120 : 0) + 'ms'); });
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('fx-in'); io.unobserve(e.target); } }), { threshold: 0.15, rootMargin: '0px 0px -6% 0px' });
  targets.forEach((el) => io.observe(el));
  $$('.about h2').forEach((h) => io.observe(h));

  // магнитные кнопки
  if (fine) {
    document.addEventListener('pointermove', (e) => {
      const b = e.target.closest?.('.btn-primary, .btn-ghost'); if (!b || b.disabled) return;
      const r = b.getBoundingClientRect();
      b.style.setProperty('--mx', ((e.clientX - r.left - r.width / 2) * .18).toFixed(1) + 'px');
      b.style.setProperty('--my', ((e.clientY - r.top - r.height / 2) * .28).toFixed(1) + 'px');
    });
    document.addEventListener('pointerout', (e) => {
      const b = e.target.closest?.('.btn'); if (!b || b.contains(e.relatedTarget)) return;
      b.style.setProperty('--mx', '0px'); b.style.setProperty('--my', '0px');
    });
  }
}

/* конфетти для экрана «Заказ принят» */
export function confetti(canvas, accent = '#d8c3a0') {
  if (reduce || !canvas) return;
  const ctx = canvas.getContext('2d'), dpr = Math.min(2, devicePixelRatio || 1);
  const W = canvas.clientWidth, H = canvas.clientHeight; canvas.width = W * dpr; canvas.height = H * dpr; ctx.scale(dpr, dpr);
  const colors = [accent, '#9db5a8', '#ece6d8', '#f2d9a6', '#ffffff', '#e9a98f'];
  const mk = (x, y, ang, spd) => ({ x, y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, w: 6 + Math.random() * 7, h: 4 + Math.random() * 6, r: Math.random() * 6.28, vr: (Math.random() - .5) * .45, c: colors[(Math.random() * colors.length) | 0], life: 1, round: Math.random() < .3 });
  const parts = [];
  const burst = (x, y, n, a0, a1, s0, s1) => { for (let i = 0; i < n; i++) parts.push(mk(x, y, a0 + Math.random() * (a1 - a0), s0 + Math.random() * (s1 - s0))); };
  burst(W * .5, H * .38, 90, 0, Math.PI * 2, 4, 13);
  setTimeout(() => burst(W * .08, H * .85, 55, -1.35, -.5, 9, 18), 280);
  setTimeout(() => burst(W * .92, H * .85, 55, -2.65, -1.8, 9, 18), 280);
  setTimeout(() => burst(W * .5, H * .3, 60, 0, Math.PI * 2, 3, 10), 900);
  const endAt = performance.now() + 4200; let last = performance.now(), alive = true;
  (function frame(t) {
    const dt = Math.min(2, (t - last) / 16.7); last = t;
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += .28 * dt; p.vx *= .992; p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt; if (p.y > H * .75) p.life -= .012 * dt;
      if (p.life <= 0) continue;
      ctx.save(); ctx.globalAlpha = Math.max(0, p.life); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
      if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2.4, 0, 6.28); ctx.fill(); } else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2) * .8 + .3));
      ctx.restore();
    }
    alive = parts.some((p) => p.life > 0 && p.y < H + 40);
    if (alive || performance.now() < endAt) requestAnimationFrame(frame); else ctx.clearRect(0, 0, W, H);
  })(last);
}
