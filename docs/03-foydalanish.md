# Foydalanuvchi qo‘llanmasi

Bu qo‘llanma sun’iy test loyihasi uchun yozilgan. Ko‘rsatilgan rtm.example domeni va 192.0.2.0/24 tarmog‘i faqat hujjatlashtirish namunalari; ular muassasaning haqiqiy manzillari emas. Haqiqiy server manzili va hisob rekvizitlarini loyiha operatoridan oling.

## Birinchi sinov

1. `npm start` va localhost manzilini oching.
2. Kirish sahifasidagi **Xodim** hisobini tanlang; login to‘ldiriladi. Lokal `.env`dagi boshlang‘ich parolni kiriting va **Tizimga kirish**ni bosing.
3. **Yangi murojaat**: toifa, mavzu, batafsil tavsif, bino, xona, ustuvorlik va tegishli qurilmani kiriting. ID va SLA avtomatik beriladi.
4. Kartochkadan fayl biriktiring, izoh yozing yoki PDF arizani yuklang.
5. Chiqib **Markaz rahbari** hisobida kiring. Murojaatni ko‘rib chiqishga oling, ijrochini tanlang va holatni **Biriktirildi**ga o‘tkazing.
6. Tayinlangan mutaxassis hisobida **Jarayonda**, so‘ng bajarilgan ish izohi bilan **Bajarildi**ni tanlang.
7. Murojaat egasi tasdiqlaydi va baholaydi. Rahbar **Yopildi** holatiga o‘tkazadi. Takror nosozlikda egasi qayta ochadi.

## Qurilma va harakat

Moddiy javobgar yoki rahbar **Qurilmalar reyestri → Qurilma qo‘shish** orqali qurilmani yozadi. Inventar va seriya raqami takrorlanmaydi. Qurilmaning texnik parametrlari, bo‘limi, xona va moddiy javobgarini kiriting.

**Biriktirishlar → O‘tkazish**da yangi xodimni va asosni tanlang, tasdiqlang. Bo‘lim qabul qiluvchining bo‘limiga yangilanadi. Qabul qiluvchini bo‘sh qoldirsangiz qurilma omborga qaytariladi. Harakat tarixi va hujjat loyihasi avtomatik saqlanadi. Boshqa foydalanuvchi shu qurilmani o‘zgartirgan bo‘lsa, shaklni yangilash talab qilinadi.

Kartochkadagi QR-kodni chop eting. Telefon bilan skanerlanganda server manzili LANdan ochilishi va foydalanuvchi tizimga kirgan bo‘lishi kerak. `APP_ORIGIN=https://rtm.example` bilan QR manzilining haqiqiy ichki DNSga mosligini ta’minlang. Localhost URLli QR boshqa kompyuterda serverni topa olmaydi.

Inventar tekshiruvida moddiy javobgar **Inventar tekshiruvi**ni bosadi va xulosani qayd etadi. **Xodimlar va bo‘limlar**dagi qurilmalar soni ishdan ketish oldi tekshiruv ro‘yxatini ochadi. Qurilma yoki ochiq ish qolgan hisobni faolsizlantirish bloklanadi.

## Excel import

1. **Import → XLSX shablonni olish**.
2. Sarlavhalarni o‘zgartirmang. `department_id` va `responsible_id` — tizimdagi raqamli ID; administrator `/api/reference` javobidan olishi mumkin.
3. Sana matn sifatida `2026-11-04` formatida yoziladi. Formula, rich-text va rasmli kataklar qabul qilinmaydi.
4. Ko‘pi bilan 500 qator yuklang. Bitta takror inventar yoki xato bo‘lsa hech qaysi qator bazaga yozilmaydi.

## Texnik xizmat va ombor

Rahbar yoki mutaxassis **Texnik xizmat → Reja qo‘shish**da qurilma, ijrochi, sana va takrorlash kunini beradi. Mutaxassis faqat o‘ziga reja yaratishi mumkin. Xizmat bajarilganda diagnostika, bajarilgan ish, vaqt va ishlatilgan ehtiyot qismni kiriting. Ombor yetarli bo‘lmasa butun amal bekor qilinadi. Takroriy ish tugaganda keyingi reja yaratiladi.

**Ombor hisobi → Kirim/chiqim**: musbat miqdor — kirim yoki qaytarish, manfiy — chiqim. Asos majburiy. Ta’mirlash sarfini xizmatni yakunlash shaklidan kiriting; u ish IDsi bilan bog‘lanadi.

## Tarmoq, litsenziya, hujjat

Tarmoqda canonical subnet (`192.0.2.0/24`) va shu subnetdagi IPni kiriting. Bir subnetda IP takrorlanmaydi. Litsenziyaga faqat hisob ma’lumoti kiritiladi; parol, token yoki maxfiy kalitlarni izohga ham yozmang. Qurilmaga o‘rnatishlar soni sotib olingan limitdan oshmaydi.

Hujjatlar avval **Loyiha** holatida. Markaz rahbari tasdiqlagach **Tasdiqlangan** holati qayd etiladi. PDF/DOCX shakllarini yuklang va muassasaning rasmiy imzolash tartibiga rioya qiling. Raqamli imzo integratsiyasi bu versiyada yo‘q.

## Oflayn loyiha

Tizimni avval bir marta oching. LAN/server uzilganda saqlangan qobiqdagi **Oflayn murojaat loyihasi** orqali bitta loyiha saqlanadi. Maxfiy va shaxsiy ma’lumot kiritmang. Tarmoq qaytganda o‘sha hisobda **Sozlamalar → Loyihani yuborish** orqali tasdiqlab yuboring. Yuborish tugaguncha logout qilmang: chiqish maxfiylik uchun loyihani o‘chiradi. Fayl ilovalari keyin onlayn kartochkada yuklanadi.
