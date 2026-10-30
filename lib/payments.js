'use strict';
/**
 * Онлайн-оплата: Payme (Merchant API) и Click (Shop API).
 * Включается только если заданы переменные окружения (см. README, раздел «Онлайн-оплата»).
 * ВАЖНО: перед боевым запуском проверьте обе интеграции в тестовом кабинете Payme / Click.
 */
const crypto = require('crypto');

function createPayments({ siteUrl, getOrders, mutateOrders, onPaid }) {
  const E = process.env;
  const PAYME = { id: (E.PAYME_MERCHANT_ID || '').trim(), key: (E.PAYME_KEY || '').trim(), test: E.PAYME_TEST === '1' };
  const CLICK = { service: (E.CLICK_SERVICE_ID || '').trim(), merchant: (E.CLICK_MERCHANT_ID || '').trim(), secret: (E.CLICK_SECRET_KEY || '').trim() };
  const enabled = { payme: !!(PAYME.id && PAYME.key), click: !!(CLICK.service && CLICK.merchant && CLICK.secret) };
  const TIMEOUT = 12 * 3600e3;

  /* ---------- ссылка на оплату ---------- */
  function payUrl(order, method) {
    const back = siteUrl + '/#orders';
    if (method === 'payme' && enabled.payme) {
      const raw = `m=${PAYME.id};ac.order_id=${order.id};a=${Math.round(order.total * 100)};c=${back};l=${order.lang === 'uz' ? 'uz' : 'ru'}`;
      return `https://checkout.${PAYME.test ? 'test.' : ''}paycom.uz/` + Buffer.from(raw).toString('base64');
    }
    if (method === 'click' && enabled.click) {
      const q = new URLSearchParams({ service_id: CLICK.service, merchant_id: CLICK.merchant, amount: String(order.total), transaction_param: order.id, return_url: back });
      return 'https://my.click.uz/services/pay?' + q;
    }
    return '';
  }

  /* ---------- Payme ---------- */
  const pErr = (code, ru, uz, en, data) => ({ code, message: { ru, uz: uz || ru, en: en || ru }, data });
  const ERR = {
    auth: pErr(-32504, 'Недостаточно привилегий', 'Ruxsat yo‘q', 'Insufficient privilege'),
    method: pErr(-32601, 'Метод не найден', 'Metod topilmadi', 'Method not found'),
    amount: pErr(-31001, 'Неверная сумма', 'Noto‘g‘ri summa', 'Wrong amount'),
    notFoundTx: pErr(-31003, 'Транзакция не найдена', 'Tranzaksiya topilmadi', 'Transaction not found'),
    cantCancel: pErr(-31007, 'Заказ выполнен, отмена невозможна', 'Buyurtma bajarilgan', 'Cannot cancel'),
    cantPerform: pErr(-31008, 'Невозможно выполнить операцию', 'Amalni bajarib bo‘lmaydi', 'Cannot perform'),
    order: pErr(-31050, 'Заказ не найден', 'Buyurtma topilmadi', 'Order not found', 'order_id'),
    busy: pErr(-31099, 'Заказ уже оплачивается или оплачен', 'Buyurtma to‘lanmoqda yoki to‘langan', 'Order is busy', 'order_id'),
  };
  class PErr extends Error { constructor(e) { super(e.message.en); this.e = e; } }
  const txOf = (o) => ({ create_time: o.payme.create_time, perform_time: o.payme.perform_time || 0, cancel_time: o.payme.cancel_time || 0, transaction: o.id, state: o.payme.state, reason: o.payme.reason ?? null });
  const findTx = (orders, id) => orders.find((o) => o.payme && o.payme.id === id);
  function checkOrder(o, amount) {
    if (!o) throw new PErr(ERR.order);
    if (Math.round(o.total * 100) !== Number(amount)) throw new PErr(ERR.amount);
    if ((o.payment && (o.payment.status === 'paid' || o.payment.status === 'cancelled')) || o.payme?.state === 2) throw new PErr(ERR.busy);
  }
  async function paymeCall(method, p) {
    const now = Date.now();
    switch (method) {
      case 'CheckPerformTransaction': {
        const o = getOrders().find((x) => x.id === p.account?.order_id);
        checkOrder(o, p.amount); return { allow: true };
      }
      case 'CreateTransaction': {
        return mutateOrders((orders) => {
          let o = findTx(orders, p.id);
          if (o) {
            if (o.payme.state !== 1) throw new PErr(ERR.cantPerform);
            if (now - o.payme.create_time > TIMEOUT) { o.payme.state = -1; o.payme.reason = 4; o.payme.cancel_time = now; throw new PErr(ERR.cantPerform); }
            return txOf(o);
          }
          o = orders.find((x) => x.id === p.account?.order_id);
          checkOrder(o, p.amount);
          if (o.payme && o.payme.state === 1 && now - o.payme.create_time <= TIMEOUT) throw new PErr(ERR.busy);
          o.payme = { id: p.id, time: p.time, create_time: now, perform_time: 0, cancel_time: 0, state: 1, reason: null };
          o.payment = { ...(o.payment || {}), method: 'payme', status: 'pending' };
          return txOf(o);
        });
      }
      case 'PerformTransaction': {
        let paidOrder = null;
        const r = await mutateOrders((orders) => {
          const o = findTx(orders, p.id); if (!o) throw new PErr(ERR.notFoundTx);
          if (o.payme.state === 1) {
            if (now - o.payme.create_time > TIMEOUT) { o.payme.state = -1; o.payme.reason = 4; o.payme.cancel_time = now; throw new PErr(ERR.cantPerform); }
            o.payme.state = 2; o.payme.perform_time = now; o.payment = { ...(o.payment || {}), method: 'payme', status: 'paid', paidAt: new Date().toISOString() }; paidOrder = { ...o };
          } else if (o.payme.state !== 2) throw new PErr(ERR.cantPerform);
          return { transaction: o.id, perform_time: o.payme.perform_time, state: o.payme.state };
        });
        if (paidOrder) onPaid(paidOrder);
        return r;
      }
      case 'CancelTransaction': {
        return mutateOrders((orders) => {
          const o = findTx(orders, p.id); if (!o) throw new PErr(ERR.notFoundTx);
          if (o.payme.state === 1) { o.payme.state = -1; }
          else if (o.payme.state === 2) { if (o.status === 'done') throw new PErr(ERR.cantCancel); o.payme.state = -2; }
          else return { transaction: o.id, cancel_time: o.payme.cancel_time, state: o.payme.state };
          o.payme.reason = p.reason ?? null; o.payme.cancel_time = now;
          o.payment = { ...(o.payment || {}), status: 'cancelled' };
          return { transaction: o.id, cancel_time: now, state: o.payme.state };
        });
      }
      case 'CheckTransaction': {
        const o = findTx(getOrders(), p.id); if (!o) throw new PErr(ERR.notFoundTx); return txOf(o);
      }
      case 'GetStatement': {
        return { transactions: getOrders().filter((o) => o.payme && o.payme.create_time >= p.from && o.payme.create_time <= p.to).map((o) => ({ id: o.payme.id, time: o.payme.time, amount: Math.round(o.total * 100), account: { order_id: o.id }, ...txOf(o) })) };
      }
      default: throw new PErr(ERR.method);
    }
  }
  async function handlePayme(authHeader, body) {
    const id = body && body.id !== undefined ? body.id : null;
    const want = 'Basic ' + Buffer.from('Paycom:' + PAYME.key).toString('base64');
    const a = Buffer.from(String(authHeader || '')), b = Buffer.from(want);
    if (!enabled.payme || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { error: ERR.auth, id };
    try { return { result: await paymeCall(body.method, body.params || {}), id }; }
    catch (e) { if (e instanceof PErr) return { error: e.e, id }; console.error('payme:', e.message); return { error: pErr(-32400, 'Системная ошибка'), id }; }
  }

  /* ---------- Click ---------- */
  const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
  async function handleClick(f) {
    const base = { click_trans_id: f.click_trans_id, merchant_trans_id: f.merchant_trans_id };
    const fail = (error, error_note) => ({ ...base, error, error_note });
    if (!enabled.click) return fail(-8, 'Click disabled');
    const action = String(f.action);
    const raw = action === '0'
      ? [f.click_trans_id, f.service_id, CLICK.secret, f.merchant_trans_id, f.amount, f.action, f.sign_time]
      : [f.click_trans_id, f.service_id, CLICK.secret, f.merchant_trans_id, f.merchant_prepare_id, f.amount, f.action, f.sign_time];
    if (md5(raw.join('')) !== String(f.sign_string || '').toLowerCase() || String(f.service_id) !== CLICK.service) return fail(-1, 'SIGN CHECK FAILED!');
    if (action !== '0' && action !== '1') return fail(-3, 'Action not found');
    let paidOrder = null;
    const res = await mutateOrders((orders) => {
      const o = orders.find((x) => x.id === f.merchant_trans_id);
      if (!o) return fail(-5, 'Order not found');
      if (Math.round(Number(f.amount)) !== Math.round(o.total)) return fail(-2, 'Incorrect parameter amount');
      if (o.payment?.status === 'paid') return fail(-4, 'Already paid');
      if (o.payment?.status === 'cancelled') return fail(-9, 'Transaction cancelled');
      if (action === '0') {
        o.click = { trans_id: f.click_trans_id, paydoc_id: f.click_paydoc_id, prepare_id: Date.now() };
        o.payment = { ...(o.payment || {}), method: 'click', status: 'pending' };
        return { ...base, merchant_prepare_id: o.click.prepare_id, error: 0, error_note: 'Success' };
      }
      if (!o.click || String(o.click.prepare_id) !== String(f.merchant_prepare_id)) return fail(-6, 'Transaction not found');
      if (Number(f.error) < 0) { o.payment = { ...(o.payment || {}), status: 'cancelled' }; return fail(-9, 'Transaction cancelled'); }
      o.payment = { ...(o.payment || {}), method: 'click', status: 'paid', paidAt: new Date().toISOString() }; paidOrder = { ...o };
      return { ...base, merchant_confirm_id: o.click.prepare_id, error: 0, error_note: 'Success' };
    });
    if (paidOrder) onPaid(paidOrder);
    return res;
  }

  return { enabled, payUrl, handlePayme, handleClick };
}
module.exports = { createPayments };
