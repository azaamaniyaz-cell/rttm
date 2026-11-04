import { totp } from '../server/security.js';
if (process.env.APP_MODE === 'production') throw new Error('Productionda shaxsiy autentifikatordan foydalaning. Bu yordamchi faqat test uchun.');
if (!process.env.ADMIN_TOTP_SECRET) throw new Error('ADMIN_TOTP_SECRET sozlanmagan. Avval npm run setup:test ni bajaring.');
console.log(`Administrator test MFA kodi: ${totp(process.env.ADMIN_TOTP_SECRET)} (30 soniya amal qiladi)`);
