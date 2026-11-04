# Sinov va qabul qilish

## Avtomatik tekshiruv

`npm run check` JavaScript sintaksisini tekshiradi. `npm test` har safar mustaqil SQLite bazasi bilan server ochadi. Testlar asosiy `data/`ga yozmaydi. 17 ta biznes/xavfsizlik ssenariysi va ularni o‘rab turgan bitta test — jami Node test hisobotida 18 ta test.

| Ssenariy | Tekshiruv |
| --- | --- |
| Parol / TOTP | Tasodifiy scrypt salt, noto‘g‘ri parol, standart TOTP vektori |
| Kirish | Anonim API 401, admin MFA, HttpOnly/SameSite, CSRF |
| RBAC | Oddiy xodim va bo‘lim rahbari scope, boshqa bo‘lim ticket/device/QRga 404 |
| Murojaat | Avtomatik ID/SLA, qayta oflayn yuborish dublikat yaratmasligi |
| Hayot sikli | Holatlar, ijrochi, majburiy yakun izohi, egasi tasdig‘i, baho, reopen |
| Inventar | Unikal inventar/seriya, qidiruv, QR SVG |
| Biriktirish | Tasdiq, versiya ziddiyati, boshqa bo‘limga transfer, qaytarish, tarix |
| Xizmat | Ombor yetishmasa rollback, sarf, takroriy reja, ikki marta yakunlash bloklanishi |
| Parallel ombor | Bitta qoldiq uchun ikki parallel chiqimdan faqat bittasi o‘tishi |
| Tarmoq/litsenziya | Takror IP, noto‘g‘ri CIDR/IP, maxfiy kalit maydoni, seat limiti |
| Fayllar | Soxta PNGni rad qilish, haqiqiy PDF, boshqa xodimga attachmentni bermaslik |
| Hisobotlar | PDF/XLSX/CSV, haqiqiy Excel parse, DOCX va hujjat tasdig‘i |
| Import | Takror IDda barcha qatorlarni rollback qilish, keyin valid import |
| Hisoblar | Bo‘lim/xodim yaratish, rahbarning hisob yaratishini rad etish, inventar qarzdorligi |
| Audit/PWA | Muhim amallar logi, shaxsiy xabarlar, lokal resurslar, CSP/nosniff |
| Zaxira | Baza va fayllar snapshoti, yangi targetga tiklash, eski sessiyalarni tozalash, buzilgan backupni rad etish |
| Yengil yuklama | 30 parallel dashboard so‘rovi, 200 statuslari va jami <15 soniya |

Natijalar `test-results/run-*/summary.json`da vaqt belgisi bilan saqlanadi. Lokal tekshiruv 2026-yil 4-noyabrda bajarildi. Qayta bajarilgan testning eng yangi `summary.json`i yakuniy dalil hisoblanadi. Ishlash vaqti konkret ish stansiyasi va kichik sun’iy bazaga tegishli; haqiqiy foydalanuvchi soni uchun kafolat emas.

## Brauzer tekshiruvi

Desktop va 390px mobil breakpointlarda sahifalar, forma ochilishi, navigatsiya, reyestr, QR kartochka, hisobot havolalari va JS xatolari tekshiriladi. Test ma’lumotiga kiritilgan yozuvlar asosiy test bazasida saqlanadi. UI ekranlari operatorning lokal `docs/screenshots/` papkasida saqlanadi va ommaviy GitHub repozitoriysiga kiritilmaydi.

2026-yil 4-noyabrdagi brauzer sinovida rahbar hisobi bilan quyidagilar kuzatildi: dashboard, qurilma yaratish shakli, 8 modul sahifasiga navigatsiya, yangi murojaat shaklini to‘ldirish va `RTM-0017` sifatida haqiqiy serverga saqlanishi. Brauzerning error loglari bo‘sh. 390px ekranda asosiy sahifa kengligi 388px, gorizontal sahifa toshishi yo‘q; mobil menyu ochilib, navigatsiyadan keyin yopildi. Ushbu UI sinoviga tegishli test murojaati sun’iy asosiy bazada qoldirilgan.

## Muassasada majburiy qabul sinovi

Quyidagi tashqi infratuzilma mezonlari ushbu ish stansiyasida bajarilgan deb hisoblanmaydi:

1. Ubuntu/Nginx/PostgreSQL muhitini ko‘tarish; bo‘sh production bazada demo hisoblar yo‘qligini tekshirish.
2. Ichki CA sertifikati bilan kamida ikki VLANdan HTTPS kirish; DB porti mijozdan ochilmasligi.
3. Internet uplinkni uzib, LANni saqlagan holda xodim kirishi, murojaat, inventar, transfer, PDF/XLSX va hujjatlarni to‘liq bajarish.
4. Telefon kamerasida haqiqiy QR skaneri bilan LAN DNSga o‘tish; ruxsatsiz hisobga kartochka ko‘rinmasligi.
5. PWAni HTTPSda oldindan ochib, LANni uzish, loyiha saqlash, qaytishda yuborish va qayta yuborish dublikat yaratmasligi.
6. To‘liq PostgreSQL+upload zaxirasini yangi server/bazaga tiklash, miqdorlar va fayl xeshlarini solishtirish; RPO/RTOni o‘lchash.
7. Kelishilgan real foydalanuvchi soni va ma’lumot hajmida p95 javob vaqti, xotira, DB blokirovkalari va eksport hajmini o‘lchash.
8. TOTP autentifikatori, sirni saqlash, administratorni tiklash tartibi, audit retention va shaxsga doir ma’lumotlar siyosatini tashkilot bilan kelishish.
9. Inventar migratsiya fayli, mas’ul xodimlar ro‘yxati, rasmiy dalolatnoma shakllari va o‘qitish mashg‘ulotini tasdiqlash.

## Xavfsizlik tekshiruvi

`npm audit --omit=dev` tekshiruvida topilgan ExcelJS transitive `uuid` va `minimatch` muammolari package overrides orqali tuzatilgan versiyaga ko‘tarildi. Shu o‘zgarishdan keyin XLSX import/eksport testlari qayta bajariladi. Audit natijasi vaqtga bog‘liq: joriy qilishdan avval yangi audit va kerak bo‘lsa mutaxassis pentesti bajarilsin. Bu dastur audit tekshiruvini to‘liq xavfsizlik sertifikati deb ko‘rsatmaydi.
