# Talablar va loyiha qamrovi

## Maqsad

Texnik murojaatlar, filialning AKT vositalari va xizmat ko‘rsatishni LANdagi yagona tizimga birlashtirish. Test versiya ishlaydigan API va saqlanadigan markaziy bazaga ega; interfeysdagi amallar serverga yoziladi.

## Rollar bo‘yicha ko‘rish huquqi

| Rol | Murojaatlar | Qurilmalar | Boshqaruv |
| --- | --- | --- | --- |
| Superadministrator | Barchasi | Barchasi | Hisob, bo‘lim, audit va barcha modullar; MFA |
| Markaz rahbari | Barchasi | Barchasi | Ijrochilar, xizmat, resurslar, hujjat tasdig‘i |
| IT mutaxassisi | O‘zi yaratgan yoki o‘ziga biriktirilgan | Texnik xizmat uchun barchasi | O‘z ishlarini bajarish, diagnostika, IP va dastur o‘rnatish |
| Bo‘lim rahbari | Faqat o‘z bo‘limi | Faqat o‘z bo‘limi | O‘z murojaatini tasdiqlash, bo‘lim nazorati |
| Oddiy xodim | Faqat o‘zi yaratgan | Faqat o‘ziga biriktirilgan | Yangi murojaat, izoh, tasdiq, baho |
| Moddiy javobgar | Faqat o‘zi yaratgan | Barchasi, markaziy hisob vakolati | Inventar, biriktirish, tekshiruv, ombor, hujjat loyihasi |

Markaziy moddiy javobgarga barcha bo‘limlar hisobi berilgan. Bo‘limlar kesimida bir nechta moddiy javobgar zarur bo‘lsa, alohida delegatsiya jadvali va scope siyosati qo‘shilishi kerak. Rolni almashtirish yoki hisobni faolsizlantirish uning eski sessiyalarini bekor qiladi.

## Murojaat ish oqimi

`yangi → ko‘rib chiqilmoqda → biriktirildi → jarayonda → bajarildi → tasdiqlandi → yopildi`

Qo‘shimcha holatlar: kutishda, rad etildi, qayta ochildi. Holat o‘tishlari serverdagi qat’iy matritsa bilan tekshiriladi. Ijrochi faqat o‘ziga biriktirilgan ishni jarayonga oladi va bajaradi. Bajarilgan ish uchun izoh majburiy. Tasdiqlash va qayta ochish murojaat egasi yoki rahbar vakolatida; baholash faqat murojaat egasiga tegishli.

## Vaqtinchalik o‘lchovli mezonlar

Buyurtmachi bilan yakuniy tasdiqlash uchun taklif:

| Ko‘rsatkich | Test mezoni |
| --- | --- |
| SLA | Shoshilinch 4, yuqori 8, o‘rta 24, past 72 uzluksiz soat |
| Bir import | Ko‘pi bilan 500 qurilma; bitta xatoda to‘liq rollback |
| Fayl | PNG/JPEG yoki faol skriptsiz PDF, ko‘pi bilan 5 MB |
| Kichik yuklama | 30 parallel dashboard so‘rovi xatosiz, yig‘indi vaqt 15 soniyadan kam |
| Sessiya | 8 soat; chiqish va parol almashtirishda bekor qilish |
| Kirish himoyasi | Login/IP juftligiga 15 daqiqada 8 muvaffaqiyatsiz urinish |
| RPO / RTO | Taklif: 24 soat / 4 soat; real serverda mashq bilan tasdiqlash kerak |

SLA ish kunlari kalendarini hisoblamaydi. Ustuvorlik rahbar tomonidan o‘zgartirilsa, yangi muddat shu paytdan qayta hisoblanadi va audit yoziladi. Monitoring tashqi agentga bog‘lanmagan: ogohlantirishlar dashboard va bildirishnoma so‘rovida joriy server vaqti bilan hisoblanadi. Bu faol foydalanuvchiga ishlaydigan ichki eskalatsiya; ekran yopiq paytda email/Telegram yetkazish hali yo‘q.

## Rejimlar

1. Test: SQLite, sun’iy hisob va yozuvlar, localhost HTTP.
2. Production: PostgreSQL, yangi administrator, maxfiy TOTP, HTTPS va Secure cookie majburiy. Test hisoblari yaratilmaydi.
3. Internet uzilgan, LAN ishlayotgan: barcha markaziy funksiyalar ishlaydi.
4. LAN uzilgan: avval keshlangan qobiqda bir murojaat loyihasi; umumiy ma’lumotlar yoki inventar amallari bajarilmaydi.

## Keyingi iteratsiya

Ruxsatli tashqi integratsiyalar, fon xabar navbati, foydalanuvchi kesimida alohida MFA enrollment/recovery, fayllarga antivirus, qurilma media galereyasi, sahifalash, fon eksportlari, ko‘p tillilik, to‘liq tarmoq diagrammasi va imzo integratsiyasi. Alohida MFA enrollment tayyor bo‘lmaguncha ikkinchi superadministrator UI orqali yaratilmaydi.
