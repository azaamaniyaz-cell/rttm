# RTM IT Management

Texnik xizmat va AKT inventarini boshqarish tizimining ishlaydigan test versiyasi. Manba: `RTM_IT_texnik_topshiriq_2026.docx`, 2026-yil 4-noyabr.

Tizim markaziy serverda ishlaydi. Brauzer, API, autentifikatsiya, QR, PDF, DOCX va Excel funksiyalari tashqi internet yoki CDNga murojaat qilmaydi. Kutubxonalarni dastlab o‘rnatish yoki Docker obrazini qurish uchun internet kerak; tayyor muhitni LANda internetsiz ishlatish mumkin.

## Tez ishga tushirish

Node.js 24 yoki yuqorisi kerak. Loyiha papkasida:

```powershell
npm ci
npm run setup:test
npm start
```

Brauzer: [http://127.0.0.1:3000](http://127.0.0.1:3000). Birinchi ishga tushishda `data/rtm.sqlite` va sun’iy test ma’lumotlari yaratiladi. Ma’lumotlar server qayta ishga tushganda saqlanadi. Windowsda tayyor kutubxonalar mavjud bo‘lsa `start-test.cmd` faylini ochish ham mumkin.

`setup:test` har o‘rnatishga noyob test paroli va MFA sirini yaratib, Gitdan chiqarilgan `.env`ga saqlaydi. Test hisoblarining boshlang‘ich paroli shu fayldagi `BOOTSTRAP_PASSWORD` qiymati. Mavjud `.env` yoki bazaning ustiga yozilmaydi.

| Hisob | Rol |
| --- | --- |
| `rahbar` | Markaz rahbari |
| `diyor`, `madina` | IT mutaxassisi |
| `bolim` | O‘quv-uslubiy bo‘lim rahbari |
| `xodim` | O‘quv-uslubiy bo‘lim xodimi |
| `sport` | Sport fakulteti xodimi |
| `moliya` | Moliya bo‘limi xodimi |
| `ombor` | Moddiy javobgar xodim |
| `admin` | Superadministrator, MFA majburiy |

Administratorning joriy test MFA kodi:

```powershell
npm run mfa
```

Bir MFA kodi qayta ishlatilmaydi. Productionda alohida tasodifiy sir, shaxsiy autentifikator va yangi kuchli parol beriladi. `npm run mfa` productionda ishlamaydi. `.env`, baza va zaxiralar repozitoriyga kiritilmaydi.

## Amalga oshirilgan funksiyalar

- Olti rol va serverda bo‘lim bo‘yicha ruxsat nazorati; kirish, sessiya, CSRF, MFA va audit.
- Murojaat yaratish, izoh/fayl, ijrochi, SLA, guruhlash, vaqtli tarix, bajarish/tasdiqlash/yopish, qayta ochish, 1–5 baho va PDF ariza.
- Qurilmalar kartochkasi, inventar/seriya unikalligi, holat, qidiruv/filtr, Excel import, Excel/CSV/PDF eksport.
- Xodimga biriktirish, bo‘limlararo ko‘chirish, qaytarish, optimistik ziddiyat nazorati, harakat tarixi, chiqish tekshiruvi va avtomatik dalolatnoma loyihasi.
- Serverda yaratiladigan noyob QR-kod, vakolatli kartochka, QR orqali murojaat, inventar tekshiruvi va chop etiladigan yorliq.
- Texnik xizmat rejasi, takroriy topshiriq, diagnostika, bajarilgan ish, vaqt va ombor sarfini bitta tranzaksiyada saqlash.
- Ombor kirim/chiqim/qaytarish tarixi, minimal zaxira, manfiy qoldiqdan himoya.
- Subnet, VLAN, IPv4/MAC, switch-port va qurilma bog‘lanishi; IP takrorlanishini bloklash.
- Dastur litsenziyalari, muddat, o‘rnatishlar va litsenziya soni limitini tekshirish.
- Hujjat loyihalari, rahbar tasdig‘i, PDF/DOCX; dashboard, davr bo‘yicha hisobot, ish yuklamasi va ichki xabarlar.
- PWA qobig‘i va foydalanuvchi roziligi bilan bitta oflayn murojaat loyihasi. Serverga qaytishda qo‘lda yuborish; qayta yuborish dublikat yaratmaydi. API va shaxsiy ma’lumotlar service worker keshiga yozilmaydi.
- SQLite hamda PostgreSQL adapteri, versiyali sxema, zaxira/tiklash skriptlari, Docker Compose va Nginx namunalari.

## Real loyiha bosqichlari

| Bosqich | Natija va hujjat |
| --- | --- |
| 1. Tahlil va loyihalash | [Talablar va qamrov](docs/01-talablar.md), [arxitektura, ER va API](docs/02-arxitektura.md) |
| 2. Asosiy modul | Kirish, xodim/bo‘limlar, murojaatlar va inventar — ishlaydi |
| 3. Kengaytirilgan modul | Biriktirish, QR, xizmat, hujjatlar va dashboard — ishlaydi |
| 4. Qo‘shimcha imkoniyatlar | Tarmoq, ombor, litsenziya, PWA — ishlaydi; tashqi integratsiyalar ulanmagan |
| 5. Sinov va joriy qilish | [Sinov rejasi va natijalari](docs/05-sinov.md), [joylashtirish yo‘riqnomasi](docs/04-joriy-qilish.md) |

Ish oqimlari [foydalanuvchi qo‘llanmasida](docs/03-foydalanish.md) berilgan. Test versiyasi qabul sinoviga tayyorlangan; productionga joriy etilgan deb hisoblanmaydi.

## Tekshirish

```powershell
npm run check
npm test
npm audit --omit=dev
```

Integratsion testlar alohida `test-results/run-*` papkasida yangi baza yaratadi, vaqtinchalik serverni ishga tushiradi va uni yakunda to‘xtatadi. Asosiy test ma’lumotlariga tegmaydi. Natija `summary.json` va `server.log`ga yoziladi; hisobot namunalarini ham shu yerda qoldiradi. Test lokal soket ochish huquqini talab qiladi.

## Zaxiralash va xavfsiz tiklash

```powershell
npm run backup
npm run restore -- backups/ZAXIRA_PAPKA --target data-restored
```

Tiklash faqat **yangi bo‘sh papkaga** bajariladi. Fayllarning SHA-256 xeshi, SQLite yaxlitligi va tashqi kalitlar tekshiriladi. Tiklangan bazada barcha eski sessiyalar bekor qilinadi. Serverni to‘xtatib `.env`dagi `DATA_DIR=./data-restored` bilan qayta ishga tushiring. Zaxira shaxsiy ma’lumotlarni o‘z ichiga olishi mumkin; himoyalangan joyda saqlang. PostgreSQL uchun `pg_dump`/`pg_restore` kerak; tartib joriy qilish hujjatida.

## Muhim chegaralar

SQLite — lokal test adapteri. PostgreSQL uchun kod va joylashtirish konfiguratsiyasi tayyor, lekin ushbu kompyuterda PostgreSQL/Docker mavjud bo‘lmagani sabab unda bajarilish sinovi o‘tkazilmagan. Real VLANlar, CA sertifikati, HTTPS, tiklash maqsadlari va apparat yuklamasi muassasa muhitida tekshiriladi.

Telegram/email, LDAP/SSO, kadrlar tizimi va SNMP real hisoblar yoki ruxsatli APIlarsiz ulanmagan. Ular ichki funksiyalarni bloklamaydi. Hujjatdagi qurilma fotolari va turli fayl ilovalari hozircha murojaatga PNG/JPEG/PDF sifatida biriktiriladi; qurilma uchun alohida media galereyasi, ommaviy QR varaqlari, murakkab tarmoq sxemasi muharriri va tizimga to‘liq ko‘p tillilik keyingi iteratsiyaga qoldirilgan.

Ro‘yxat va eksportlar test versiyasida 2000 yozuv, hujjatlar 1000 yozuv, import 500 qator bilan cheklangan. Katta hajmli production bazasi uchun sahifalash va fon eksportlari talab etiladi. Tashqi antivirus tekshiruvi, elektron raqamli imzo, avtomatik offsite backup va tashqi yetkazish navbati bu versiyada yo‘q.

## Tuzilma

```text
server/          API, ruxsatlar, ma’lumotlar bazasi, fayl eksportlari
public/          O‘zbekcha responsiv UI, barcha lokal resurslar, PWA
scripts/         Test MFA, zaxiralash va yangi bazaga tiklash
tests/           Integratsion va xavfsizlik ssenariylari
docs/            Talablar, arxitektura, foydalanish, deploy va qabul sinovi
deploy/          Nginx HTTPS konfiguratsiyasi va production env namunasi
data/            Lokal baza va himoyalangan yuklangan fayllar (Gitdan tashqari)
test-results/    Alohida test bazalari va tekshiruv dalillari (Gitdan tashqari)
```
