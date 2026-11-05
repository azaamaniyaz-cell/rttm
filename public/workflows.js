/* Shared workflow screens. Loaded before app.js; state is read only on interaction. */
function slaPanel() {
  const policy = S.sla;
  if (!policy) return '';
  return `<section class="panel body-pad" style="margin-bottom:20px"><div class="panel-head" style="padding:0"><div><h2>SLA muddatlari</h2><p>Amaldagi qoida · ${policy.revision}-versiya</p></div>${myRole('superadmin') ? action('sla-edit', 'SLA sozlash', 'clock', 'primary') : ''}</div><div class="detail-grid">${['critical','high','medium','low'].map(key => `<div class="setting-row"><span>${e(label(key))}</span><strong>${policy[key]} soat</strong></div>`).join('')}</div><p class="note">Muddatlar uzluksiz soatlarda hisoblanadi. O‘zgarish yangi murojaatlar va keyin ustuvorligi almashtirilgan murojaatlarga tatbiq etiladi; mavjud muddatlar saqlanadi.</p></section>`;
}
function documentDetail(item) {
  S.document = item;
  const files = item.signed_files, movement = item.movement, snapshot = movement?.snapshot;
  return header(`RTM-DOC-${item.id}`, item.title, link('#documents','Hujjatlarga qaytish','back')) +
    `<div class="split"><section class="panel body-pad"><h2>${e(item.title)}</h2><div style="margin:15px 0">${badge(item.status)}</div>${detailItems([['Tuzuvchi',item.creator],['Tasdiqlovchi',item.approver],['Harakat sanasi',date(movement?.created_at,true)],['Asos',movement?.basis]])}${snapshot ? detailItems([['Qurilma',`${snapshot.inventory_no} — ${snapshot.model}`],['Seriya raqami',snapshot.serial_no],['Topshiruvchi',snapshot.from_employee],['Qabul qiluvchi',snapshot.to_employee],['Bo‘limlar',`${snapshot.from_department} → ${snapshot.to_department}`],['Harakat paytidagi holat',snapshot.condition]]) : '<p class="note">Bu yozuvda harakat paytidagi to‘liq nusxa mavjud emas. Eski hujjat rekvizitlarini imzolashdan oldin tekshiring.</p>'}<div class="divider"></div><h3 class="section-title">Qo‘lda tasdiqlangan nusxalar</h3>${files.length ? files.map(file => `<article class="signed-file"><div class="panel-head" style="padding:0"><div><strong>${e(file.filename)}</strong><p>${e(file.uploader)} · ${e(date(file.uploaded_at,true))} · ${(file.size/1024).toFixed(0)} KB</p></div>${badge(file.status)}</div><p class="note hash">SHA-256: ${e(file.sha256)}</p>${file.reviewed_at ? `<p class="note">Tekshirgan: ${e(file.reviewer)} · ${e(date(file.reviewed_at,true))}<br>${e(file.review_note)}</p>` : '<p class="note">Yuklangan. Tekshirish va qabul qilish kutilmoqda.</p>'}<div class="report-actions" style="margin-top:12px">${link(`/api/signed-files/${file.id}/download`,'Nusxani yuklab olish','download','small')}${elevated() && file.status==='pending' && file.uploaded_by!==S.user.id ? action('signed-review','Nusxani tekshirish','shield','small',`data-id="${file.id}"`) : ''}</div></article>`).join('') : '<p class="note">Imzolangan nusxa hali yuklanmagan.</p>'}</section><aside><section class="panel body-pad"><h3 class="section-title" style="margin-top:0">Dalolatnoma tartibi</h3><ol class="note"><li>PDF yoki DOCX shablonni oling.</li><li>Rekvizitlarni tekshirib, qo‘lda imzolang.</li><li>Imzolangan PDF yoki skanerni yuklang.</li><li>Boshqa rahbar yoki superadmin nusxani tekshiradi.</li></ol><div class="detail-controls">${link(`/api/documents/${item.id}/download?format=docx`,'DOCX shablon','download')}${link(`/api/documents/${item.id}/download?format=pdf`,'PDF shablon','download')}${movement ? action('signed-upload','Imzolangan fayl qo‘shish','upload','primary') : ''}</div><div class="divider"></div><p class="note">PNG, JPEG yoki PDF · 5 MB gacha. Yangi nusxa oldingisini almashtirmaydi. Faylni yuklagan shaxs o‘sha nusxani o‘zi tasdiqlay olmaydi. Bu tekshiruv elektron raqamli imzo o‘rnini bosmaydi.</p><p class="note" style="margin-top:10px">Elektron biriktirish darhol qayd etiladi; imzolangan nusxa qabul qilinmaguncha hujjat rasmiylashtirilishi yakunlanmagan deb ko‘rsatiladi.</p></section></aside></div>`;
}
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button || !['sla-edit','signed-upload','signed-review'].includes(button.dataset.action)) return;
  event.preventDefault();
  try {
    if (button.dataset.action === 'sla-edit') {
      const policy = await api('/settings/sla');
      openModal('SLA muddatlarini sozlash', ['critical','high','medium','low'].map(key => field(key,`${label(key)} (soat)`, 'number', policy[key], 'required min="1" max="720" step="1"')).join('') + '<p class="note field full">Shoshilinch ≤ yuqori ≤ o‘rta ≤ past. Oldingi murojaatlarning muddati o‘zgarmaydi. Saqlash auditga yoziladi.</p>', async values => {
        S.sla = await api('/settings/sla', {method:'PUT',body:{...values,revision:policy.revision}});
        S.ref.sla = Object.fromEntries(['critical','high','medium','low'].map(key=>[key,S.sla[key]]));
        toast('SLA sozlamalari saqlandi'); await route();
      });
    }
    if (button.dataset.action === 'signed-upload') {
      const id = S.document.id;
      openModal('Imzolangan dalolatnoma nusxasi', field('file','Imzolangan PDF yoki skaner (5 MB gacha)','file','','required accept="application/pdf,image/png,image/jpeg"') + '<label class="checkbox"><input type="checkbox" name="confirm" required/>Fayl shu biriktirish yoki qaytarish dalolatnomasining qo‘lda tasdiqlangan nusxasi ekanini tasdiqlayman.</label>', async (values, form) => {
        const body = new FormData(form); body.set('confirm','true');
        await api(`/documents/${id}/signed-files`,{method:'POST',body}); toast('Nusxa yuklandi va tekshiruvga yuborildi'); await route();
      }, 'Tekshiruvga yuborish');
    }
    if (button.dataset.action === 'signed-review') {
      const id = button.dataset.id;
      openModal('Imzolangan nusxani tekshirish', '<p class="note field full">Avval nusxani yuklab olib, imzolar va rekvizitlarni shablon bilan solishtiring.</p>' + select('status','Qaror',[['accepted','Qabul qilish'],['rejected','Rad etish']],'accepted','') + field('note','Izoh (rad etishda kamida 5 belgi)','textarea','','maxlength="2000"') + '<label class="checkbox"><input type="checkbox" required/>Faylni ko‘rib chiqdim va qarorimni tasdiqlayman.</label>', async values => {
        await api(`/signed-files/${id}/review`,{method:'POST',body:{...values,confirm:true}}); toast('Tekshiruv qarori saqlandi'); await route();
      }, 'Qarorni saqlash');
    }
  } catch(error) { toast(error.message,true); }
});
