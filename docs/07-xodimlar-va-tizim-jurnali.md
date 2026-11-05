# 0.3.0 — xodimlar, rollar va tizim jurnali

2026-yil 5-noyabr. Yangilanish avvalgi SLA, shaxsiy qurilmalar va imzolangan dalolatnoma funksiyalari ustiga qurilgan. Ishga tushirishdan oldin lokal baza va fayllarning zaxirasi olindi; sxema 4-versiyaga ko‘tarildi.

## Qarorlar va foyda

| Taklif | Natija va qoida |
| --- | --- |
| Bitta xodimga bir nechta rol | Lavozimlarni birga bajarish uchun foydali. Belgilangan rollarning huquqlari birlashadi; kamida bittasi qoladi. Barcha server va interfeys tekshiruvlari ko‘p rolni hisobga oladi. |
| Rol va bo‘lim ma’lumotini tahrirlash | Xodimning biriktirilgan rollari, bo‘limi, F.I.Sh. va telefoni o‘zgaradi. Bo‘limning nomi va binosi alohida tahrirlanadi. Login va tarixiy ID saqlanadi. |
| Bo‘shagan | Alohida ish holati sifatida bajarildi. U yangi huquq bermaydi; avval hisob faol emas bo‘lishi shart. Faol hisobni bir so‘rovda o‘chirib, bo‘shagan qilish ham rad etiladi. |
| Toggle switch | Faollikni aniq ko‘rsatadi. O‘chirish tasdiqlanadi; server muvaffaqiyatidan keyin holat yangilanadi. O‘z admin hisobini o‘chirish bloklangan. |
| Qidiruv va filtrlar | Xodim: F.I.Sh./login/telefon/bo‘lim bo‘yicha qidiruv, rol/bo‘lim/faollik/ish holati filtrlari. Bo‘lim: nom/bino qidiruvi va bino filtri. |
| Tizim jurnali | Superadmin uchun sana, ijrochi, amal, obyekt, tafsilot va IP tarixi. Qidiruv, filtrlar, 50 yozuvli sahifalar va tafsilot oynasi. |

## Ish tartibi

1. Superadmin hisobida **Xodimlar va bo‘limlar**ni oching.
2. **Tahrirlash**da kerakli rollarning checkboxlarini belgilang, bo‘limni tanlang va saqlang. Masalan, **Bo‘lim rahbari + IT mutaxassisi**.
3. **Bo‘limlar** tabida kerakli bo‘limni toping va nom/bino ma’lumotini tahrirlang.
4. Xodim ketayotganda uning qurilmalarini dalolatnoma bilan qaytaring, ijrodagi murojaatlarini taqsimlang va rejalashtirilgan xizmatlarini yakunlang.
5. Toggle orqali hisobni faolsizlantiring; keyin tahrir oynasida **Bo‘shagan**ni belgilang. Hisob va tarix o‘chirilmaydi.
6. Qayta ishga olinganda avval holatni **Ishlayapti**ga qaytaring, keyin toggle bilan yoqing.
7. **Tizim jurnali → Batafsil**dan o‘zgarishlarni tekshiring.

## Huquq va tarixning chegaralari

Markaz rahbari xodim/bo‘lim ro‘yxatini o‘qiydi; hisob, rol, ish holati va bo‘lim tahriri faqat superadmin vakolatida. Qurilmalarni hamma ko‘rishi uchun manager yoki superadmin roli bo‘lishi kerak; qolgan rollar birgalikda berilsa ham faqat xodimning o‘z qurilmalari ochiladi.

Har bir xodim tahriri uning eski sessiyalarini bekor qiladi. Yangi kirishda yangilangan vakolatlar olinadi. UI versiya raqamini yuboradi: bir paytdagi ikkinchi tahrir oldingi o‘zgarishni bilmasdan ustidan yozmaydi. Xodim bo‘limi o‘zgarishi qurilmaning joylashuvi, eski murojaat bo‘limi yoki tarixiy dalolatnomani avtomatik almashtirmaydi.

Yangi xodim, bo‘lim va SLA o‘zgarishlarida oldingi-keyingi maydonlar saqlanadi. Boshqa biznes hodisalari mavjud tafsilot/hayot sikli tarixi orqali qayd etiladi. Eski jurnal yozuvlariga yo‘q maydonlar o‘ylab to‘ldirilmaydi. Parollar, xeshlar va MFA sirlari strukturali nusxaga kiritilmaydi. Jurnal API orqali o‘zgartirilmaydi; bazaga to‘liq administrator kirishidan kriptografik himoya va tashqi o‘zgarmas saqlash ushbu test versiyada yo‘q.

Rollar oltita belgilangan turdan tanlanadi. Yangi rol ta’rifi yoki huquqlar matritsasini foydalanuvchi orqali tahrirlash ushbu ishga kirmaydi. Qo‘shimcha superadmin yaratish/berish har xodim uchun alohida MFA ulash va tiklash jarayoni tayyor bo‘lguncha bloklangan; mavjud admin o‘zining qolgan rollarini boshqara oladi.

## Tekshiruv

27 ta Node testi o‘tdi: 26 ta biznes/xavfsizlik ssenariysi va tashqi test. Ko‘p rol huquqlari, ikkinchi rol orqali ijrochi tanlash, sessiya bekor qilinishi, bo‘lim tahriri, qo‘shma filtrlar, bo‘shagan holati, audit nusxalari va sahifalash hamda eski 3-versiya bazasining 4-versiyaga migratsiyasi sinovdan o‘tdi. Natija [test-results.json](test-results.json)da.

Brauzerda superadmin kirishi, xodim/bo‘lim qidiruvi, rol filtri, tahrir oynalari, faol hisobda bo‘shagan variantining bloklanishi, qurilmali xodimni faolsizlantirish rad etilishi, jurnal qidiruvi va tafsiloti tekshirildi. 390px mobil ekranda sahifa tashqariga toshmadi; jadval ichida gorizontal aylantiriladi. Brauzer error logi bo‘sh. Mavjud xodimlarning rollari va faolligi UI sinovi uchun o‘zgartirilmagan. PostgreSQLda bajarilish sinovi hali o‘tkazilmagan.
