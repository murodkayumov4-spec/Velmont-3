/* VELMONT — аналитика: Яндекс Метрика и Google Analytics 4. Подключается, только если ID указан в админке (Настройки → Аналитика). */
let ymId = '', gaId = '';
export function initAnalytics(settings) {
  ymId = String(settings.yandexMetrika || '').replace(/\D/g, '');
  gaId = /^(G|GT|UA|AW)-[A-Z0-9-]{4,16}$/i.test(settings.googleAnalytics || '') ? settings.googleAnalytics : '';
  if (ymId) {
    window.ym = window.ym || function () { (window.ym.a = window.ym.a || []).push(arguments); };
    window.ym.l = Date.now();
    const s = document.createElement('script'); s.async = true; s.src = 'https://mc.yandex.ru/metrika/tag.js'; document.head.appendChild(s);
    window.ym(Number(ymId), 'init', { clickmap: true, trackLinks: true, accurateTrackBounce: true, webvisor: true });
  }
  if (gaId) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date()); window.gtag('config', gaId);
    const s = document.createElement('script'); s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(gaId); document.head.appendChild(s);
  }
}
/**
 * Цели для воронки (в Метрике создайте «JavaScript-событие» с тем же названием):
 * view_item, add_to_cart, begin_checkout, phone_verified, promo_applied, purchase, favorite, share, size_chart, lang_switch, menu_open
 */
export function track(name, params = {}) {
  try {
    if (ymId && window.ym) window.ym(Number(ymId), 'reachGoal', name, params);
    if (gaId && window.gtag) window.gtag('event', name, params);
  } catch {}
}
export function pageview(url, title) {
  try {
    if (ymId && window.ym) window.ym(Number(ymId), 'hit', url, { title });
    if (gaId && window.gtag) window.gtag('event', 'page_view', { page_location: location.origin + url, page_title: title });
  } catch {}
}
