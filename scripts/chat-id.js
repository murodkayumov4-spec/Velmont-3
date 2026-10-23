// Показывает chat id для TELEGRAM_CHAT_ID. Сначала напишите вашему боту любое сообщение.
const fs = require('fs'), path = require('path');
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) for (const l of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) { console.log('Сначала впишите TELEGRAM_BOT_TOKEN в файл .env'); process.exit(1); }
fetch(`https://api.telegram.org/bot${token}/getUpdates`).then(r => r.json()).then(j => {
  if (!j.ok) return console.log('Ошибка Telegram:', j.description);
  const seen = new Map();
  for (const u of j.result) { const c = (u.message || u.channel_post || {}).chat; if (c) seen.set(c.id, c.title || c.username || c.first_name || ''); }
  if (!seen.size) return console.log('Сообщений нет. Откройте вашего бота в Telegram, нажмите Start, напишите «привет» и запустите команду снова.');
  for (const [id, name] of seen) console.log(`TELEGRAM_CHAT_ID=${id}   (${name})`);
}).catch(e => console.log('Не удалось подключиться к Telegram:', e.message));
