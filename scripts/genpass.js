// Создаёт надёжный пароль для ADMIN_PASSWORD:  npm run genpass
const c = require('crypto');
const sets = ['abcdefghjkmnpqrstuvwxyz', 'ABCDEFGHJKMNPQRSTUVWXYZ', '23456789', '!@#$%*-_+='];
const pick = (s) => s[c.randomInt(s.length)];
const chars = sets.map(pick); const all = sets.join('');
while (chars.length < 18) chars.push(pick(all));
for (let i = chars.length - 1; i > 0; i--) { const j = c.randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
console.log('\nНовый пароль для админки:\n\n  ' + chars.join('') + '\n\nВпишите его в ADMIN_PASSWORD (файл .env или Render → Environment) и сохраните в менеджере паролей.\n');
