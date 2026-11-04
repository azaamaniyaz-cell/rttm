# Joriy qilish va ekspluatatsiya

Ushbu fayl ishlab turgan infratuzilmadan olinmagan, dastur uchun umumiy joylashtirish shablonidir. rtm.example hujjatlashtirish uchun ajratilgan namunaviy domen. Ko‘rsatilgan sertifikat yo‘llari kelajakda operator yaratadigan bo‘sh konfiguratsiya yo‘llari; repozitoriyda haqiqiy domen, sertifikat, maxfiy kalit yoki muassasa serverining rekvizitlari yo‘q.

## Test server

`npm ci`, `npm run setup:test` va `npm start`. Setup noyob parol/MFA sirini lokal `.env`ga yozadi; bu fayl Gitga kiritilmaydi. Dastlab faqat localhost tinglanadi. LANda vaqtinchalik test uchun administrator `.env`da `HOST=0.0.0.0`, `APP_ORIGIN=http://ICHKI_IP:3000`ni belgilaydi va tarmoq ruxsatlarini o‘z siyosatiga muvofiq sozlaydi. Ushbu loyiha Windows firewall yoki tizim xavfsizlik sozlamalarini avtomatik o‘zgartirmaydi. Oddiy HTTP LAN testi PWA o‘rnatilishi va production xavfsizligi uchun yetarli emas.

## Production tayyorlash

1. Ubuntu Server LTS, ishonchli Docker/Compose yoki Node.js 24+ va PostgreSQL 17 muhitini tayyorlang. Vaqtni NTP bilan sinxronlang; TOTP va SLA server soatiga bog‘liq.
2. Filial ichki DNSiga `rtm.example` yoki haqiqiy nomni kiriting. Nginx `server_name` va `APP_ORIGIN`ni aynan shu nomga moslang.
3. Muassasa CA orqali ishonchli TLS sertifikati oling. `deploy/certs/rtm.crt` va `deploy/certs/rtm.key`ga joylang; key faqat operator uchun ochiq bo‘lsin. Mijozlar CAga ishonishi kerak. Sertifikat ogohlantirishlarini chetlab o‘tish tartibi berilmaydi.
4. `deploy/.env.production.example`ni loyiha ildizidagi `.env.production`ga ko‘chiring. PostgreSQL uchun URLga xavfsiz tasodifiy hex parol, administratorga kamida 14 belgili noyob parol va alohida 32+ belgili Base32 TOTP siri yarating. TOTP sirini shaxsiy autentifikatorga `RTM IT / admin`, SHA1, 6 digit, 30 seconds bilan qo‘shing. Uni xavfsiz vaultda saqlang.
5. Quyidagi buyruqni serverda bajaring:

```sh
docker compose --env-file .env.production up -d --build
docker compose --env-file .env.production ps
```

6. PostgreSQL porti hostga chiqarilmagan. API ham to‘g‘ridan to‘g‘ri tashqariga chiqarilmagan; faqat Nginxning 443-porti ochiladi. VLANlararo faqat kerakli HTTPS marshrutlash qoidalarini tarmoq administratori belgilaydi.
7. `https://rtm.example`ga administrator sifatida kiring. Production bo‘sh bazada faqat administrator yaratiladi; sun’iy qurilmalar va demo foydalanuvchilar yaratilmaydi. Bo‘limlarni va haqiqiy xodimlarni kiriting. Alohida PostgreSQL bazasi va alohida DATA_DIRdan foydalaning; test SQLite faylini production deb ko‘chirmang.
8. Qabul sinovlarini bajaring. Test/prod ajratilishi, muassasa ruxsati, zaxira joyi va tiklash mashqini hujjatlashtiring.

Docker konfiguratsiyasi namuna sifatida tayyorlangan, bu ish stansiyasida bajarilmagan. Muassasada obrazlar qurilib sinovdan o‘tgach digest bilan mahkamlansin. To‘liq internetsiz joriy qilishda kerakli obrazlarni oldindan ishonchli muhitda qurish/yuklash va ichki serverga olib o‘tish kerak. Ishlayotgan konteynerga internet talab etilmaydi.

## Node bilan alohida PostgreSQL

`.env`da `APP_MODE=production`, `NODE_ENV=production`, `DATABASE_URL=postgresql://...`, `ADMIN_TOTP_SECRET`, `BOOTSTRAP_PASSWORD`, `SECURE_COOKIE=1`, `TRUST_PROXY=1`, `APP_ORIGIN` va `HOST=127.0.0.1`ni belgilang. Nginxga ruxsatli proxy sifatida yagona kirish nuqtasini bering. Test rejimidagi SQLite ishlab chiqarish uchun tavsiya qilinmaydi; dastur productionda uni qabul qilmaydi.

## Zaxira va tiklash

SQLite `npm run backup` orqali Node backup API bilan yaxlit snapshot oladi; jonli WAL faylini oddiy nusxalash ishlatilmaydi. Fayllar va SHA-256 manifest ham qo‘shiladi. Har kuni tashqi himoyalangan saqlashga nusxalash va davriy tiklash mashqi operator vazifasi.

PostgreSQL ishlatilsa skript `pg_dump --format=custom`ni chaqiradi. Konteyner ichida:

```sh
docker compose --env-file .env.production exec app node scripts/backup.js
```

Zaxira `/app/backups/VAQT/`da, named volume ichida saqlanadi. Operator uni serverdan mustaqil himoyalangan joyga ko‘chiradi. Docker obrazidagi PostgreSQL client major versiyasi servernikidan eski emasligini tekshiring.

Tiklash uchun yangi bo‘sh PostgreSQL bazasi yaratiladi va `DATABASE_URL` shu bazaga yo‘naltiriladi. Yangi bo‘sh DATA_DIR tanlanadi:

```sh
node --env-file=.env.restore scripts/restore.js /path/to/backup --target /path/to/new-data
```

Skript bo‘sh bo‘lmagan target papkaga yoki bo‘sh bo‘lmagan PostgreSQL bazasiga yozmaydi. Eski sessiyalar bekor qilinadi. PostgreSQL holatida `pg_restore` serverida yangi bazani tiklash tekshiruvi bu kompyuterda bajarilmagan; real muhitdagi majburiy qabul bandi. Tiklash xato bilan uzilsa shu qisman yaratilgan bazani ishlatmang; yangi bo‘sh baza bilan qayta boshlang.

Zaxira manifest xeshi tasodifiy buzilishni aniqlaydi, kriptografik imzo o‘rnini bosmaydi. Zaxirani o‘zgartirish huquqini cheklang, at-rest encryption va saqlash muddatini tashkilot siyosati bilan belgilang.

## Kuzatuv

`/api/health` bazaga yengil so‘rov yuboradi. Docker healthcheck shu endpointni tekshiradi. Ilova server xatolarini stderr va auditga yozadi; operator log rotation/markaziy yig‘ishni sozlaydi. Audit shaxsiy ma’lumot bo‘lishi mumkin; faqat superadministrator o‘qiydi. Tashqi SIEMga eksport, log imzosi va audit retention avtomatizatsiyasi keyingi bosqichda.

Ishlayotgan test serverini terminalda `Ctrl+C` bilan to‘xtating. `start-test.cmd` qayta ishga tushirish uchun berilgan. Ilova manba fayllari o‘zgarganda oddiy `npm start` avtomatik qayta yuklanmaydi; serverni qayta ishga tushiring yoki ishlab chiqishda `npm run dev`dan foydalaning.
