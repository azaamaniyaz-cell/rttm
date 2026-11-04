import { randomBytes } from 'node:crypto';
import { writeFileSync, existsSync } from 'node:fs';
if (existsSync('.env')) throw new Error('.env mavjud. Ustiga yozilmadi. Mavjud lokal sozlamalarni saqlang.');
if (existsSync('data/rtm.sqlite')) throw new Error('Mavjud baza topildi. Uning avvalgi paroli va MFA siriga mos .env faylini tiklang.');
const password = randomBytes(18).toString('base64url');
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const secret = Array.from(randomBytes(32), value => alphabet[value % 32]).join('');
writeFileSync('.env', [
  'APP_MODE=test', 'NODE_ENV=development', 'HOST=127.0.0.1', 'PORT=3000',
  'DATA_DIR=./data', 'SECURE_COOKIE=0', 'TRUST_PROXY=0',
  `BOOTSTRAP_PASSWORD=${password}`, `ADMIN_TOTP_SECRET=${secret}`, ''
].join('\n'), { flag: 'wx', mode: 0o600 });
console.log('Noyob test paroli va MFA siri .env fayliga yozildi. Parolni shu lokal fayldan oling. .env ni ulashmang va Gitga qo‘shmang.');
