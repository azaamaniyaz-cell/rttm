# SLA va qurilma hujjatlari bo‘yicha baholash

2026-yil 5-noyabr. Test versiyasi 0.2.0.

Uchala taklif amaliy jihatdan foydali. Ular xizmat muddatini boshqarish, ortiqcha inventar ma’lumotini yashirish va jismoniy topshirishni hujjat bilan bog‘lashni yaxshilaydi. Quyidagi tartibda joriy qilindi.

## 1 SLA muddatlarini superadministrator sozlaydi

Foydasi: muddatlarni kodga tegmasdan tashkilot imkoniyatiga moslash mumkin. Faqat superadministrator yozadi; boshqa rollar joriy qoidani o‘qiy oladi. Sozlamalar bazada va zaxirada saqlanadi; qayta ishga tushirishda yo‘qolmaydi.

Chegaralari: to‘rtta ustuvorlik uchun 1–720 oralig‘idagi butun soatlar; shoshilinch ≤ yuqori ≤ o‘rta ≤ past. Hisob uzluksiz soatlarda, ish kunlari kalendarisiz amalga oshiriladi. 4/8/24/72 soat dastlabki qiymatlar bo‘lib qoladi.

Muhim qaror: mavjud murojaat muddatlari global sozlama tahriri bilan o‘zgarmaydi. Yangi murojaat yoki rahbar tomonidan keyin ustuvorligi almashtirilgan murojaat amaldagi qoidadan foydalanadi. Murojaatda qo‘llangan soat va qoida versiyasi saqlanadi. Shu bilan kechikishni keyin muddatni uzaytirib yashirishning oldi olinadi. Ikki sessiya bir vaqtda tahrir qilsa, eski versiya bilan saqlash 409 ziddiyat javobini oladi; o‘zgarish auditga yoziladi.

Foydalanish: **Superadministrator → Sozlamalar → SLA sozlash**. Markaz rahbari ustuvorlikni tanlaydi, ammo global SLAni o‘zgartirmaydi.

## 2 Mening qurilmalarim

Foydasi: xodim keraksiz umumiy reyestr bilan chalg‘imaydi, boshqa xodimning qurilma kartochkasi ko‘rinmaydi. Cheklov menyu bilan kifoyalanmaydi: API, qidiruv, kartochka, QR, hisobot va xodimning qurilmalar ro‘yxatida ham tekshiriladi.

| Rol | Qurilmalar | Biriktirish va qaytarish |
| --- | --- | --- |
| Superadministrator | Barchasi | Ha |
| Markaz rahbari | Barchasi | Ha |
| IT mutaxassisi | Faqat o‘ziga biriktirilgan | Yo‘q |
| Bo‘lim rahbari | Faqat o‘ziga biriktirilgan | Yo‘q |
| Oddiy xodim | Faqat o‘ziga biriktirilgan | Yo‘q |
| Moddiy javobgar/inventar xodimi | Faqat o‘ziga biriktirilgan | Yo‘q |

Oqibati: inventar xodimi umumiy qurilma hisobini mustaqil boshqarmaydi; yangi qurilma yaratish, import, tekshiruv va harakatlarni rahbar/superadmin bajaradi. Ombor sarf materiallari vakolati alohida saqlanadi. Bu foydalanuvchining qat’iy cheklovi asosidagi qaror; markazda alohida inventar operatori kerak bo‘lsa, keyinchalik aniq delegatsiya huquqi kiritish maqsadga muvofiq.

IT ishining uzilib qolmasligi uchun biriktirilgan murojaat va texnik xizmat topshirig‘i bajarilishi mumkin. Biroq unga tegishli begona qurilmaning IDsi, inventar raqami, modeli va kartochka havolasi ko‘rsatilmaydi. Texnik xizmat reyestri umumiy inventarni ochish yo‘li sifatida ishlamaydi. Bo‘lim rahbarining bo‘lim murojaatlarini ko‘rish huquqi o‘zgarmagan.

## 3 Qo‘lda tasdiqlangan dalolatnoma fayli

Foydasi: elektron yozuvga qog‘ozda imzolangan nusxa biriktiriladi. Biriktirish va omborga qaytarish uchun alohida mazmundagi PDF/DOCX shablon yaratiladi. Qurilma identifikatori, model/seriya, holat, topshiruvchi, qabul qiluvchi, bo‘limlar, asos va sana harakat paytidagi nusxadan olinadi. Keyingi transfer yoki kartochka tahriri oldingi dalolatnomani o‘zgartirmaydi.

Ish tartibi:

1. Rahbar/superadmin qurilmani biriktiradi yoki qaytaradi. Elektron harakat darhol saqlanadi va hujjat kartochkasi ochiladi.
2. Kartochkadan **DOCX shablon** yoki **PDF shablon** yuklab olinadi. Rekvizitlar tekshirilib, muassasa tartibi bo‘yicha qo‘lda imzolanadi.
3. Rahbar yoki shu harakatning topshiruvchi/qabul qiluvchi xodimi **Imzolangan fayl qo‘shish** orqali PDF, PNG yoki JPEG yuklaydi va uning shu hujjatga tegishliligini tasdiqlaydi.
4. Nusxa **Tekshiruvda** bo‘ladi. Faylni yuklagan shaxsdan boshqa rahbar yoki superadmin uni yuklab ko‘rib, qabul qiladi yoki sababini yozib rad etadi.
5. Qabul qilinganda hujjat **Tasdiqlangan** bo‘ladi. Oldingi, jumladan rad etilgan nusxalar ham tarixda qoladi.

Fayl cheklovlari: 5 MB, bitta hujjatda 10 tagacha nusxa; format/magic tekshiruvi; PDFdagi faol skriptlar rad etiladi. SHA-256, yuklovchi, vaqt, tekshiruvchi va qaror saqlanadi. Takror bir xil fayl shu hujjatda qabul qilinmaydi. Yuklangan fayllar `public/`dan tashqarida va vakolatli download API ortida saqlanadi; bazaga qo‘shilgan barcha nusxalar amaldagi backup/tiklash oqimiga kiradi.

Muhim chegaralar: imzolangan skan haqiqiyligini dastur avtomatik isbotlamaydi; tekshiruvchi uni ko‘zdan kechiradi. Bu elektron raqamli imzo yoki antivirus o‘rnini bosmaydi. Fayl yuklashning o‘zi hujjatni tasdiqlamaydi. Elektron harakat tasdiqdan oldin ham amalda bo‘ladi, hujjat rasmiylashtirish holati esa alohida ko‘rsatiladi.

Topshirgan yoki qabul qilgan xodim o‘zi qatnashgan dalolatnomani, qurilma keyin boshqa xodimga o‘tsa ham, o‘qiy oladi. Bu tarixiy hujjat huquqi yangi egaga tegishli qurilma kartochkasini ochmaydi; yangi egaga oldingi begona dalolatnomalar berilmaydi.

Aniq muassasa shabloni taqdim etilmagani sabab tizimdagi shablon kerakli rekvizit va imzo joylari bilan kengaytirildi. Alohida tasdiqlangan blank mavjud bo‘lsa, uning ko‘rinishini ushbu rekvizitlar bilan moslashtirish kerak.

## Migratsiya va tekshiruv

Sxema 3-versiyaga qo‘shimcha migratsiya bilan o‘tadi. Mavjud hisoblar, inventar, harakatlar, murojaatlar va muddatlar saqlanadi. Eski harakatda rekvizitlar nusxasi bo‘lmasa, tizim tarixni uydirmaydi: shablonda joriy rekvizitlar ishlatilgani va tekshirish zarurligi ko‘rsatiladi.

SQLite integratsion testlari role/IDOR, eksport, SLA tahriri va ziddiyatlari, fayl ruxsatlari, o‘z nusxasini tasdiqlashni bloklash, tarix o‘zgarmasligi, backup/tiklash va 2→3 migratsiyani qamrab oladi. PostgreSQL kodi tayyor, ammo shu ish stansiyasida PostgreSQL muhitida bajarilish sinovi mavjud emas.

22/22 avtomatik test o‘tdi. PDF shablon sahifasi Poppler bilan render qilinib vizual tekshirildi. DOCX yaratilishi va yuklanishi tekshirildi; kompyuterda LibreOffice renderer yo‘qligi sabab DOCXning sahifalangan ko‘rinishi avtomatik tasdiqlanmadi. Uni muassasada ishlatiladigan Word/LibreOffice versiyasida tekshirish kerak.
