'use strict';
/** Тексты Telegram-уведомлений покупателю (русский и узбекский). */
const money = (n, lang) => new Intl.NumberFormat('ru-RU').format(Math.round(n)) + (lang === 'uz' ? " so‘m" : ' сум');

const T = {
  ru: {
    created: (o) => `✅ <b>Заказ ${o.id} принят!</b>\nСумма: ${money(o.total, 'ru')}\nМы свяжемся с вами для подтверждения. Статус заказа придёт сюда же.`,
    shipping: (o) => `🚚 <b>Заказ ${o.id} передан в доставку.</b>${o.trackNo ? `\nНомер отправления BTS: <code>${o.trackNo}</code>` : ''}`,
    track: (o) => `📦 Номер отправления BTS по заказу ${o.id}: <code>${o.trackNo}</code>`,
    done: (o) => `🎉 <b>Заказ ${o.id} доставлен.</b>\nСпасибо, что выбрали VELMONT!`,
    paid: (o) => `💳 Оплата заказа ${o.id} получена: ${money(o.total, 'ru')}. Спасибо!`,
  },
  uz: {
    created: (o) => `✅ <b>${o.id}-buyurtma qabul qilindi!</b>\nSumma: ${money(o.total, 'uz')}\nTasdiqlash uchun siz bilan bog‘lanamiz. Buyurtma holati shu yerga keladi.`,
    shipping: (o) => `🚚 <b>${o.id}-buyurtma yetkazib berishga topshirildi.</b>${o.trackNo ? `\nBTS jo‘natma raqami: <code>${o.trackNo}</code>` : ''}`,
    track: (o) => `📦 ${o.id}-buyurtma bo‘yicha BTS jo‘natma raqami: <code>${o.trackNo}</code>`,
    done: (o) => `🎉 <b>${o.id}-buyurtma yetkazildi.</b>\nVELMONT’ni tanlaganingiz uchun rahmat!`,
    paid: (o) => `💳 ${o.id}-buyurtma uchun ${money(o.total, 'uz')} to‘lov qabul qilindi. Rahmat!`,
  },
};
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function buyerMsg(kind, order, lang) {
  const t = T[lang === 'uz' ? 'uz' : 'ru'][kind];
  return t ? t({ ...order, trackNo: esc(order.trackNo || '') }) : '';
}
const BOT = {
  ru: { back: '↩️ Вернуться на сайт', start: 'Чтобы подтвердить номер, нажмите кнопку ниже и поделитесь своим контактом.', btn: '📱 Поделиться номером', ok: '✅ Номер подтверждён. Вернитесь на сайт и оформите заказ. Статус заказа будем присылать сюда.', own: 'Нужен ваш собственный номер. Нажмите кнопку «Поделиться номером» внизу.', exp: 'Время подтверждения вышло. Вернитесь на сайт и нажмите «Подтвердить через Telegram» ещё раз.', open: 'Откройте сайт магазина, при оформлении заказа нажмите «Подтвердить через Telegram» и вернитесь сюда по кнопке.', about: 'Это бот магазина VELMONT. Он подтверждает номер и присылает статус заказа.' },
  uz: { back: '↩️ Saytga qaytish', start: 'Raqamni tasdiqlash uchun pastdagi tugmani bosing va kontaktingizni yuboring.', btn: '📱 Raqamni yuborish', ok: '✅ Raqam tasdiqlandi. Saytga qaytib, buyurtma bering. Buyurtma holatini shu yerga yuboramiz.', own: 'O‘zingizning raqamingiz kerak. Pastdagi «Raqamni yuborish» tugmasini bosing.', exp: 'Tasdiqlash vaqti tugadi. Saytga qaytib, «Telegram orqali tasdiqlash» tugmasini yana bosing.', open: 'Do‘kon saytini oching, buyurtma berishda «Telegram orqali tasdiqlash» tugmasini bosing va shu yerga qayting.', about: 'Bu VELMONT do‘koni boti. U raqamni tasdiqlaydi va buyurtma holatini yuboradi.' },
};
const botText = (key, lang) => (BOT[lang === 'uz' ? 'uz' : 'ru'][key]);
module.exports = { buyerMsg, botText, money };
