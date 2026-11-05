# Arxitektura va API

## Texnologiya tanlovi

Node.js 24+, Express 5, lokal HTML/CSS/JavaScript, PostgreSQL adapteri va test uchun SQLite. Texnik topshiriqdagi Laravel/Django va Vue/React tavsiya sifatida berilgan. Testni ushbu Windows muhitida minimal tashqi infratuzilma bilan ishlatish uchun Node tanlandi. PostgreSQL ishlab chiqarish arxitekturasida saqlandi. Frameworksiz mijoz lokal resurslar bilan ishlaydi va build jarayoniga bog‘liq emas.

## Komponentlar

```mermaid
flowchart LR
    B[LAN brauzeri / PWA] --> N[Nginx HTTPS]
    N --> A[Express API + lokal statik resurslar]
    A --> P[(PostgreSQL)]
    A --> F[Himoyalangan fayl katalogi]
    A -. test adapteri .-> S[(SQLite)]
    P --> K[pg_dump zaxirasi]
    F --> K
```

Brauzerga ma’lumotlar bazasi rekvizitlari berilmaydi. Fayl katalogi `public/`dan tashqarida; yuklab olishda murojaat ruxsati qayta tekshiriladi. SQL faqat parametrli so‘rovlar bilan bajariladi. PostgreSQLda har bir biznes tranzaksiyasi alohida pool connection oladi; qurilma ko‘chirish, ticket statusi, xizmat va litsenziya limitlarida qator blokirovkasi ishlatiladi. SQLite tranzaksiyalari bitta yozuv navbatida serial bajariladi; tashqi so‘rovlar tugayotgan tranzaksiyani kutadi.

## ER modeli

```mermaid
erDiagram
    DEPARTMENTS ||--o{ USERS : includes
    DEPARTMENTS ||--o{ DEVICES : owns
    USERS ||--o{ USER_ROLES : permissions
    USERS ||--o{ DEVICES : assigned
    USERS ||--o{ TICKETS : creates
    USERS ||--o{ TICKETS : executes
    DEVICES o|--o{ TICKETS : related
    TICKETS ||--o{ TICKET_EVENTS : history
    TICKETS ||--o{ ATTACHMENTS : contains
    DEVICES ||--o{ ASSIGNMENTS : movements
    DEVICES ||--o{ INVENTORY_CHECKS : checked
    DEVICES ||--o{ MAINTENANCE : serviced
    TICKETS o|--o{ MAINTENANCE : repair
    STOCK ||--o{ STOCK_MOVES : movements
    MAINTENANCE o|--o{ STOCK_MOVES : consumes
    LICENSES ||--o{ LICENSE_INSTALLS : seats
    DEVICES ||--o{ LICENSE_INSTALLS : installed
    DEVICES o|--o{ NETWORKS : connected
    ASSIGNMENTS o|--o{ DOCUMENTS : formalizes
    USERS ||--o{ NOTIFICATIONS : receives
    USERS ||--o{ AUDIT : acts
    USERS ||--o{ SESSIONS : authenticates
```

Sxema `server/db.js`da versiyalangan: 1 — asosiy jadvallar va indekslar; 2 — qayta ishlatilgan MFA kodini bloklash uchun `mfa_last_step`. Boshlang‘ich ma’lumotlar faqat foydalanuvchilar jadvali bo‘sh bo‘lganda yaratiladi. Keyingi sxema o‘zgarishlari yangi versiya sifatida qo‘shiladi.

3-versiya: `sla_policy`, murojaatda `sla_hours`/`sla_policy_revision`, harakatda `snapshot_json` va `signed_document_files`. Oxirgi jadval hujjatga tashqi kalit bilan bog‘langan, nusxaning SHA-256 xeshi, yuklovchi, vaqt va mustaqil tekshiruv qarorini saqlaydi. Fayllar amaldagi himoyalangan upload katalogida saqlanadi. Mavjud yozuvlar hamda muddatlar migratsiyada o‘zgartirilmaydi.

Yangi API: `GET /api/settings/sla` (barcha hisoblar), `PUT /api/settings/sla` (faqat superadmin, to‘rtta soat va `revision`), `GET /api/documents/:id`, `GET/POST /api/documents/:id/signed-files`, `GET /api/signed-files/:id/download`, `POST /api/signed-files/:id/review` (`status: accepted|rejected`, `confirm: true`, `note`). Upload multipart `file` va `confirm=true` talab qiladi. Fayl yuklovchisi o‘z nusxasini tasdiqlay olmaydi. Transfer hujjati uchun eski umumiy `/approve` yo‘li ham tekshirilgan nusxasiz tasdiqlashga yo‘l bermaydi.

4-versiya (0.3.0): `user_roles(user_id, role)` bog‘lanish jadvali mavjud asosiy rollardan to‘ldiriladi. `users.employment_status`, `users.revision`, `departments.revision`, `audit.before_json/after_json` hamda rol/jurnal indekslari qo‘shiladi. Mavjud faol/faol emas hisoblar, bo‘limlar va tarix saqlanadi. Bazadagi CHECK cheklovi bo‘shagan hisobning faol bo‘lishini taqiqlaydi. Eski `users.role` moslik uchun saqlanadi; haqiqiy vakolat `user_roles`dan olinadi.

`POST /api/users` va `PATCH /api/users/:id` `roles: ["technician", "department_head"]` qabul qiladi. Eski bitta `role` maydoni ham qo‘llab-quvvatlanadi. Tahrirda `confirm: true`; UI joriy `revision`ni yuboradi, eskirgan versiya 409 qaytaradi. `active` boolean; yuborilmasa o‘zgarmaydi. `employment_status` employed/dismissed. O‘z superadmin huquqini yoki faolligini olib tashlash, oxirgi faol adminni bloklash va alohida MFA sozlashsiz yangi superadmin berish rad etiladi. Tahrir target xodimning barcha sessiyalarini bekor qiladi.

`GET /api/users`: `q`, `role` (barcha biriktirilgan rollar ichidan), `department_id`, `active=0|1`, `employment_status`. `GET /api/departments`: `q`, `building`. `PATCH /api/departments/:id`: `name`, `building`, `revision`, `confirm: true`. Departament tahriri mavjud IDni saqlaydi.

`GET /api/audit`: `q`, `action`, `entity`, `user_id`, `entity_id`, `from`, `to`, `page`, `limit` (1–500); UI 50 yozuvli sahifalar ishlatadi. Sana chegaralari Toshkent vaqti bo‘yicha hisoblanadi. Yozuvda actor, sana, IP, amal, obyekt va tafsilot mavjud. Yangi xodim/bo‘lim/SLA tahrirlari uchun xavfsiz oldingi-keyingi maydonlar ham bor; parol xeshi va MFA siri ularga kiritilmaydi. API jurnalni tahrirlash yoki o‘chirish yo‘lini bermaydi.

## API shartnomasi

JSON javob; muvaffaqiyatsiz so‘rov `{"error":"..."}`. HTTP: 400 validatsiya, 401 sessiya, 403 vakolat/CSRF, 404 topilmagan yoki ko‘rishga ruxsat yo‘q, 409 ziddiyat, 413 hajm, 429 kirish urinishlari. Mutatsiyalar `X-CSRF-Token` talab qiladi. `POST /auth/login` javobidagi `csrf` keyingi so‘rovlarga yuboriladi; sessiya cookie orqali saqlanadi.

| Yo‘l (`/api` prefiksi bilan) | Usul | Vazifa |
| --- | --- | --- |
| `/health` | GET | Sog‘lomlik, muhit va baza turi |
| `/auth/login`, `/auth/logout` | POST | Kirish/chiqish; admin uchun `otp` |
| `/auth/me` | GET | Joriy hisob va CSRF |
| `/auth/password` | POST | Parol almashtirish, barcha sessiyalarni tugatish |
| `/reference` | GET | Vakolatga mos bo‘lim, xodim va lug‘atlar |
| `/tickets` | GET, POST | Scope bo‘yicha ro‘yxat va yaratish |
| `/tickets/:id` | GET, PATCH | Kartochka, status, ijrochi, izoh va baho |
| `/tickets/:id/attachments` | POST multipart | Himoyalangan fayl ilovasi |
| `/attachments/:id`, `/tickets/:id/pdf` | GET | Ruxsat bilan fayl va PDF ariza |
| `/devices` | GET, POST | Reyestr va yangi qurilma |
| `/devices/:id` | GET, PATCH | Kartochka va texnik holat |
| `/devices/:id/assign` | POST | `employee_id`, `basis`, `confirm`, `expected_updated_at` |
| `/devices/:id/qr`, `/devices/:id/check` | GET / POST | QR SVG va inventar tekshiruv |
| `/device-template`, `/devices-import` | GET / POST multipart | Excel shablon va atomar import |
| `/maintenance`, `/maintenance/:id/complete` | GET, POST / POST | Reja va xizmatni yakunlash |
| `/stock`, `/stock/:id/moves`, `/stock/:id/move` | GET, POST / GET / POST | Nomenklatura, tarix va kirim-chiqim |
| `/networks` | GET, POST | Subnet va IP nazorati |
| `/licenses`, `/licenses/:id/install` | GET, POST / POST | Litsenziya va o‘rnatish |
| `/users`, `/users/:id`, `/users/:id/checklist` | GET, POST / PATCH / GET | Hisoblar va chiqish tekshiruvi |
| `/departments`, `/departments/:id` | GET, POST / PATCH | Bo‘limlar va tahrirlash |
| `/documents`, `/documents/:id/approve` | GET, POST / POST | Hujjat va tasdiqlash |
| `/documents/:id/download?format=pdf\|docx` | GET | Hujjat yaratib yuklash |
| `/exports/:entity?format=xlsx\|csv\|pdf` | GET | Scope va filtr bo‘yicha hisobot |
| `/dashboard`, `/notifications`, `/audit` | GET | Tahlil, xabarlar va audit |
| `/notifications/read` | POST | Xabarlarni o‘qilgan qilish |

Murojaat filtrlari: `q`, `status`, `priority`, `category`, `from`, `to`, `overdue=1`. Qurilma filtrlari: `q`, `status`, `category`, `department_id`, `unassigned=1`. Hozir barcha filtrlarga API javob beradi; UI eng ko‘p ishlatiladigan qidiruv, holat, ustuvorlik va bo‘limni ko‘rsatadi.

## Xavfsizlik qarorlari

Scrypt va tasodifiy salt; bazada faqat sessiya tokenining SHA-256 xeshi; HttpOnly/SameSite=Strict cookie; server ruxsati; CSRF; CSP `script-src 'self'`; HTML escape; fayl hajmi/magic tekshiruvi va majburiy attachment; XLSX ZIP ochilishidan oldin hajm chegarasi; formulali import kataklarini rad qilish; CSV formula injectiondan himoya. Fayl signature tekshiruvi antivirus o‘rnini bosmaydi. JSON tana 256 KB. Muhim jadvallarda tashqi kalit va unikallik cheklovlari bor.

Of­layn loyiha serverga yuborilganda hisob IDsi bilan prefikslangan `client_request_id` bo‘yicha takror so‘rov oldingi ticketni qaytaradi. Mahalliy loyiha qo‘lda yuboriladi va logout vaqtida o‘chiriladi. API, sessiya yoki hisobot service worker keshiga yozilmaydi. LANda PWA uchun ishonchli HTTPS kerak; localhost testida HTTP xavfsiz kontekst hisoblanadi.
