import { randomBytes } from 'node:crypto';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import ExcelJS from 'exceljs';
import { totp, hashPassword, verifyPassword } from '../server/security.js';

let processHandle, dir, base, admin, lead, employee, other, tech, inventoryUser;
const logs = [], results = [];
const testPassword = randomBytes(18).toString('base64url');
const testTotpSecret = Array.from(randomBytes(32), value => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[value % 32]).join('');
const exec = promisify(execFile);
async function client(username) {
  const loginOtp = username==='admin' ? totp(testTotpSecret) : undefined;
  const response = await fetch(base+'/api/auth/login', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:testPassword,...(loginOtp?{otp:loginOtp}:{})})});
  assert.equal(response.status,200,await response.clone().text());const session=await response.json(),cookie=response.headers.get('set-cookie').split(';')[0];
  return { ...session, loginOtp, async request(path, method='GET', body, csrf=true) { const response=await fetch(base+'/api'+path,{method,headers:{cookie,...(csrf?{'X-CSRF-Token':session.csrf}:{}),...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});return response; }, async json(path,method='GET',body) { const response=await this.request(path,method,body);assert.ok(response.ok,`${method} ${path}: ${response.status} ${await response.clone().text()}`);return response.json(); } };
}
before(async()=>{
  await mkdir(resolve('test-results'),{recursive:true});dir=await mkdtemp(resolve('test-results/run-'));
  const port=16000+process.pid%10000;base=`http://127.0.0.1:${port}`;
  processHandle=spawn(process.execPath,['server/index.js'],{cwd:resolve('.'),windowsHide:true,env:{...process.env,DATABASE_URL:'',APP_MODE:'test',NODE_ENV:'test',BOOTSTRAP_PASSWORD:testPassword,ADMIN_TOTP_SECRET:testTotpSecret,PORT:String(port),HOST:'127.0.0.1',DATA_DIR:join(dir,'data'),SECURE_COOKIE:'0'}});
  processHandle.stderr.on('data',chunk=>logs.push(String(chunk)));
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Server ishga tushmadi: '+logs.join(''))),20000);processHandle.on('exit',code=>{clearTimeout(timeout);reject(new Error('Server exited '+code+logs.join('')));});processHandle.stdout.on('data',chunk=>{logs.push(String(chunk));if(String(chunk).includes('RTM IT TEST:')){clearTimeout(timeout);resolve();}});});
  lead=await client('rahbar');employee=await client('xodim');other=await client('sport');tech=await client('diyor');inventoryUser=await client('ombor');admin=await client('admin');
});
after(async()=>{if(processHandle)processHandle.kill();if(dir){await writeFile(join(dir,'server.log'),logs.join(''));await writeFile(join(dir,'summary.json'),JSON.stringify({date:new Date().toISOString(),database:'SQLite',results},null,2));}});
async function check(name,fn){await fn();results.push({name,status:'passed'});}

test('LAN uchun asosiy ssenariylar va xavfsizlik',async t=>{
  await t.test('Parol xeshi va TOTP standart vektori',()=>check('Password / TOTP',async()=>{const hash=hashPassword(testPassword);assert.ok(verifyPassword(testPassword,hash));assert.ok(!verifyPassword('wrong',hash));assert.notEqual(hash,hashPassword(testPassword));assert.equal(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',59000),'287082');}));
  await t.test('Login, HttpOnly, MFA va CSRF',()=>check('Auth / MFA / CSRF',async()=>{
    assert.equal((await fetch(base+'/api/tickets')).status,401);
    assert.equal((await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:testPassword})})).status,401);
    assert.equal((await employee.request('/tickets','POST',{title:'Valid title',description:'Long enough description'},false)).status,403);
    assert.equal((await employee.request('/users')).status,403);
    assert.equal((await employee.request('/audit')).status,403);
    assert.equal((await lead.request('/audit')).status,403);
    const replay=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:testPassword,otp:admin.loginOtp})});assert.equal(replay.status,401);
    const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'xodim',password:testPassword})});assert.match(login.headers.get('set-cookie'),/HttpOnly/i);assert.match(login.headers.get('set-cookie'),/SameSite=Strict/i);
  }));
  await t.test('Bo‘limlararo RBAC, IDOR va qidiruv',()=>check('RBAC / IDOR',async()=>{
    const own=await employee.json('/tickets');assert.ok(own.length);assert.ok(own.every(x=>x.created_by===employee.user.id));
    const foreign=(await other.json('/tickets'))[0];assert.equal((await employee.request('/tickets/'+foreign.id)).status,404);
    const head=await client('bolim');assert.ok((await head.json('/tickets')).every(x=>x.department_id===head.user.department_id));
    const ownDevices=await employee.json('/devices');assert.ok(ownDevices.every(x=>x.employee_id===employee.user.id));
    const foreignDevice=(await other.json('/devices'))[0];assert.equal((await employee.request('/devices/'+foreignDevice.id)).status,404);assert.equal((await employee.request('/devices/'+foreignDevice.id+'/qr')).status,404);
    assert.equal((await employee.request('/stock')).status,403);assert.equal((await employee.request('/networks')).status,403);
    assert.deepEqual(await lead.json('/tickets?q='+encodeURIComponent("' OR 1=1 --")),[]);
    const stats=await employee.json('/dashboard');assert.equal(stats.total,own.length);
  }));
  let ticket;
  await t.test('Murojaat yaratish, SLA va oflayn dublikatdan himoya',()=>check('Ticket create / SLA / idempotency',async()=>{
    const device=(await employee.json('/devices'))[0];
    const body={title:'Test: internet aloqasini tekshirish',description:'Lokal tarmoqdagi internet porti ishlamayapti. Tekshirish kerak.',category:'Internet',priority:'high',building:'Asosiy bino',room:'203',device_id:device.id,client_request_id:'offline-test-unique'};
    ticket=await employee.json('/tickets','POST',body);assert.equal(ticket.status,'new');assert.ok(Math.abs(Date.parse(ticket.due_at)-Date.parse(ticket.created_at)-8*3600000)<2000);
    const again=await employee.json('/tickets','POST',body);assert.equal(ticket.id,again.id);
    assert.equal((await employee.json('/tickets/'+ticket.id)).events.length,1);
    assert.equal((await other.request('/tickets/'+ticket.id)).status,404);
  }));
  await t.test('Murojaatning to‘liq hayot sikli va baholash',()=>check('Ticket workflow / history / rating',async()=>{
    assert.equal((await employee.request('/tickets/'+ticket.id,'PATCH',{status:'closed'})).status,400);
    await lead.json('/tickets/'+ticket.id,'PATCH',{status:'reviewing',comment:'Qabul qilindi'});
    await lead.json('/tickets/'+ticket.id,'PATCH',{status:'assigned',assigned_to:tech.user.id});
    assert.equal((await employee.request('/tickets/'+ticket.id,'PATCH',{assigned_to:tech.user.id})).status,403);
    await tech.json('/tickets/'+ticket.id,'PATCH',{status:'in_progress',comment:'Diagnostika boshlandi'});
    assert.equal((await tech.request('/tickets/'+ticket.id,'PATCH',{status:'completed'})).status,400);
    await tech.json('/tickets/'+ticket.id,'PATCH',{status:'completed',comment:'Switch porti almashtirildi, ulanish tiklandi'});
    assert.equal((await tech.request('/tickets/'+ticket.id,'PATCH',{status:'confirmed'})).status,403);
    await employee.json('/tickets/'+ticket.id,'PATCH',{status:'confirmed',rating:5,comment:'Ish bajarilganini tasdiqlayman'});
    await lead.json('/tickets/'+ticket.id,'PATCH',{status:'closed'});
    const detail=await employee.json('/tickets/'+ticket.id);assert.equal(detail.status,'closed');assert.equal(detail.rating,5);assert.equal(detail.events.length,7);assert.ok(detail.completed_at&&detail.first_response_at);
    await employee.json('/tickets/'+ticket.id,'PATCH',{status:'reopened',comment:'Nosozlik qaytdi'});assert.equal((await employee.json('/tickets/'+ticket.id)).completed_at,null);
  }));
  let device;
  await t.test('Inventar yaratish, unikallik va QR',()=>check('Inventory / uniqueness / QR',async()=>{
    const body={inventory_no:'TEST-001',category:'Noutbuk',model:'Test HP 2026',serial_no:'TEST-SERIAL-001',specs:'16GB RAM',building:'Asosiy bino',room:'101',department_id:2,responsible_id:8,commissioned_at:'2026-01-01',status:'warehouse'};
    assert.equal((await employee.request('/devices','POST',body)).status,403);device=await inventoryUser.json('/devices','POST',body);
    assert.equal((await inventoryUser.request('/devices','POST',body)).status,409);
    const search=await lead.json('/devices?q=TEST-001');assert.equal(search[0].id,device.id);
    const qr=await lead.request('/devices/'+device.id+'/qr');assert.equal(qr.status,200);assert.match(await qr.text(),/<svg/);
  }));
  await t.test('Biriktirish, qaytarish, tarix va chiqish tekshiruvi',()=>check('Assignment / transfer / return',async()=>{
    assert.equal((await inventoryUser.request(`/devices/${device.id}/assign`,'POST',{employee_id:employee.user.id,basis:'Sinov uchun'})).status,400);
    await inventoryUser.json(`/devices/${device.id}/assign`,'POST',{employee_id:employee.user.id,basis:'Xodim ish joyini jihozlash',confirm:true,expected_updated_at:device.updated_at});
    const detail=await employee.json('/devices/'+device.id);assert.equal(detail.employee_id,employee.user.id);assert.equal(detail.assignments.length,1);
    assert.equal((await inventoryUser.request(`/devices/${device.id}/assign`,'POST',{employee_id:other.user.id,basis:'Eski versiya bilan o‘tkazish',confirm:true,expected_updated_at:device.updated_at})).status,409);
    await inventoryUser.json(`/devices/${device.id}/assign`,'POST',{employee_id:other.user.id,basis:'Sport bo‘limiga topshirish',confirm:true});
    assert.equal((await employee.request('/devices/'+device.id)).status,404);assert.equal((await other.json('/devices/'+device.id)).department_id,3);
    const checklist=await inventoryUser.json('/users/'+other.user.id+'/checklist');assert.ok(checklist.some(d=>d.id===device.id));
    await inventoryUser.json(`/devices/${device.id}/assign`,'POST',{employee_id:null,basis:'Omborga qaytarish dalolatnomasi',confirm:true});
    const returned=await lead.json('/devices/'+device.id);assert.equal(returned.employee_id,null);assert.equal(returned.status,'warehouse');assert.equal(returned.assignments.length,3);
    await inventoryUser.json(`/devices/${device.id}/check`,'POST',{note:'Qurilma joyida tekshirildi'});assert.equal((await lead.json('/devices/'+device.id)).checks.length,1);
  }));
  await t.test('Texnik xizmat, ombor sarfi, takroriy reja, atomarlik',()=>check('Maintenance / stock / transactions',async()=>{
    const stock=(await inventoryUser.json('/stock'))[0],before=stock.quantity;
    const m=await lead.json('/maintenance','POST',{title:'Test profilaktikasi',device_id:device.id,assigned_to:tech.user.id,planned_at:'2026-11-05',repeat_days:30});
    const body={diagnosis:'Disk eskirgan',work_done:'Yangi SSD o‘rnatildi',minutes:35,stock_id:stock.id,quantity:before+1};
    assert.equal((await tech.request('/maintenance/'+m.id+'/complete','POST',body)).status,409);
    assert.equal((await inventoryUser.json('/stock')).find(s=>s.id===stock.id).quantity,before);
    await tech.json('/maintenance/'+m.id+'/complete','POST',{...body,quantity:1});
    assert.equal((await inventoryUser.json('/stock')).find(s=>s.id===stock.id).quantity,before-1);
    assert.equal((await tech.request('/maintenance/'+m.id+'/complete','POST',{...body,quantity:1})).status,409);
    const history=await inventoryUser.json('/stock/'+stock.id+'/moves');assert.ok(history.some(x=>x.maintenance_id===m.id));
    const plans=await lead.json('/maintenance');assert.ok(plans.some(x=>x.id!==m.id&&x.title===m.title&&x.status==='planned'));
    assert.equal((await inventoryUser.request('/stock/'+stock.id+'/move','POST',{delta:-100000,reason:'Mavjud bo‘lmagan qoldiq'})).status,409);
    await inventoryUser.json('/stock/'+stock.id+'/move','POST',{delta:2,reason:'Kirim dalolatnomasi'});
  }));
  await t.test('Parallel ombor chiqimi manfiy qoldiq bermaydi',()=>check('Concurrent stock safety',async()=>{
    const s=await inventoryUser.json('/stock','POST',{name:'Parallel sinov',unit:'dona',minimum:0,location:'Test'});await inventoryUser.json(`/stock/${s.id}/move`,'POST',{delta:1,reason:'Boshlang‘ich kirim'});
    const statuses=await Promise.all([1,2].map(()=>inventoryUser.request(`/stock/${s.id}/move`,'POST',{delta:-1,reason:'Parallel chiqim'}).then(r=>r.status)));assert.deepEqual(statuses.sort(),[200,409]);
    assert.equal((await inventoryUser.json('/stock')).find(x=>x.id===s.id).quantity,0);
  }));
  await t.test('IP takrorlanishi, CIDR va litsenziya limitlari',()=>check('Network / IP / license limits',async()=>{
    const network={name:'Test LAN',subnet:'10.10.0.0/24',vlan:100,ip:'10.10.0.20',building:'Asosiy bino'};await tech.json('/networks','POST',network);
    assert.equal((await tech.request('/networks','POST',network)).status,409);assert.equal((await tech.request('/networks','POST',{...network,ip:'10.20.0.1'})).status,400);
    assert.equal((await lead.request('/licenses','POST',{name:'Unsafe',owner:'Test',seats:1,expires_at:'2027-12-31',secret_key:'unsafe'})).status,400);
    const l=await lead.json('/licenses','POST',{name:'Test license',owner:'Test',seats:1,expires_at:'2027-12-31'});await tech.json('/licenses/'+l.id+'/install','POST',{device_id:device.id});
    assert.equal((await tech.request('/licenses/'+l.id+'/install','POST',{device_id:1})).status,409);
  }));
  await t.test('Fayl yuklash cheklovi va ruxsat tekshiruvi',()=>check('Uploads / attachment IDOR',async()=>{
    const bad=new FormData();bad.set('file',new Blob(['<script>alert(1)</script>'],{type:'image/png'}),'fake.png');assert.equal((await employee.request('/tickets/'+ticket.id+'/attachments','POST',bad)).status,400);
    const pdf=await employee.request('/tickets/'+ticket.id+'/pdf');const buffer=await pdf.arrayBuffer();assert.equal(Buffer.from(buffer).subarray(0,5).toString(),'%PDF-');
    const good=new FormData();good.set('file',new Blob([buffer],{type:'application/pdf'}),'request.pdf');const attachment=await employee.json('/tickets/'+ticket.id+'/attachments','POST',good);
    assert.equal((await other.request('/attachments/'+attachment.id)).status,404);assert.equal((await employee.request('/attachments/'+attachment.id)).status,200);
  }));
  await t.test('PDF, XLSX, CSV va DOCX eksportlari',()=>check('Exports / documents / approval',async()=>{
    for(const format of ['pdf','xlsx','csv']) { const r=await employee.request('/exports/tickets?format='+format);assert.equal(r.status,200);const data=Buffer.from(await r.arrayBuffer());assert.ok(data.length>100);if(format==='pdf')assert.equal(data.subarray(0,5).toString(),'%PDF-');if(format==='xlsx'){const b=new ExcelJS.Workbook();await b.xlsx.load(data);assert.ok(b.worksheets[0].rowCount>1);}await writeFile(join(dir,'tickets.'+format),data); }
    const docs=await lead.json('/documents'),doc=docs.find(d=>d.device_id===device.id);assert.ok(doc);assert.equal(doc.status,'draft');
    assert.equal((await employee.request('/documents/'+doc.id+'/download')).status,404);
    await lead.json('/documents/'+doc.id+'/approve','POST',{confirm:true});
    for(const format of ['pdf','docx']){const r=await lead.request('/documents/'+doc.id+'/download?format='+format);assert.equal(r.status,200);const data=Buffer.from(await r.arrayBuffer());assert.ok(data.length>100);await writeFile(join(dir,'transfer.'+format),data);}
  }));
  await t.test('Import tekshiruvi va to‘liq rollback',()=>check('Excel import / rollback',async()=>{
    const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Import');sheet.addRow(['inventory_no','category','model','serial_no','building','room','department_id','responsible_id','commissioned_at']);sheet.addRow(['IMPORT-GOOD','Kompyuter','Test model','IMPORT-SERIAL','Bino','101','2','8','2026-01-01']);sheet.addRow(['TEST-001','Kompyuter','Duplicate','IMPORT-SERIAL2','Bino','102','2','8','2026-01-01']);
    const data=await book.xlsx.writeBuffer(),form=new FormData();form.set('file',new Blob([data]),'test.xlsx');assert.equal((await inventoryUser.request('/devices-import','POST',form)).status,409);assert.equal((await lead.json('/devices?q=IMPORT-GOOD')).length,0);
    sheet.spliceRows(3,1);const good=new FormData();good.set('file',new Blob([await book.xlsx.writeBuffer()]),'good.xlsx');assert.equal((await inventoryUser.json('/devices-import','POST',good)).imported,1);
    const invalid=new FormData();invalid.set('file',new Blob(['not-a-zip']),'invalid.xlsx');assert.equal((await inventoryUser.request('/devices-import','POST',invalid)).status,400);
  }));
  await t.test('Foydalanuvchilar, bo‘limlar va faolsizlantirish himoyasi',()=>check('User / department / offboarding',async()=>{
    const department=await admin.json('/departments','POST',{name:'Test bo‘limi',building:'Test binosi'});
    const u=await admin.json('/users','POST',{name:'Test Foydalanuvchi',username:'testuser',password:testPassword,role:'employee',department_id:department.id});
    assert.equal((await lead.request('/users','POST',{name:'Fake'})).status,403);
    assert.equal((await admin.request('/users/'+employee.user.id,'PATCH',{active:false,confirm:true})).status,409);
    await admin.json('/users/'+u.id,'PATCH',{active:false,confirm:true});
    const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'testuser',password:testPassword})});assert.equal(login.status,401);
  }));
  await t.test('Audit, bildirishnomalar va PWA lokal resurslari',()=>check('Audit / notifications / local assets',async()=>{
    const audit=await admin.json('/audit');for(const action of ['create','transfer','return','consume','approve','export','import'])assert.ok(audit.some(a=>a.action===action),action);
    const messages=await employee.json('/notifications');assert.ok(messages.messages.length>0);await employee.json('/notifications/read','POST',{});assert.ok((await employee.json('/notifications')).messages.every(m=>m.read_at));
    for(const asset of ['/','/app.js','/styles.css','/sw.js','/manifest.webmanifest','/icon.svg']) { const r=await fetch(base+asset);assert.equal(r.status,200);assert.ok(!/https?:\/\/(?:cdn|fonts\.)/.test(await r.text())); }
    const r=await fetch(base+'/');assert.match(r.headers.get('content-security-policy'),/script-src 'self'/);assert.equal(r.headers.get('x-content-type-options'),'nosniff');
  }));
  await t.test('Zaxiralash, SHA-256 va yangi bazaga tiklash',()=>check('Backup / integrity / restore',async()=>{
    const backup=join(dir,'backup'),restored=join(dir,'restored');const env={...process.env,DATABASE_URL:'',DATA_DIR:join(dir,'data')};
    await exec(process.execPath,['scripts/backup.js',backup],{env,windowsHide:true});await exec(process.execPath,['scripts/restore.js',backup,'--target',restored],{env,windowsHide:true});
    const snapshot=new DatabaseSync(join(restored,'rtm.sqlite'),{readOnly:true});try{assert.equal(snapshot.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.ok(snapshot.prepare('SELECT id FROM tickets WHERE id=?').get(ticket.id));assert.ok(snapshot.prepare('SELECT COUNT(*) AS n FROM audit').get().n>10);assert.equal(snapshot.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);}finally{snapshot.close();}
    const manifest=JSON.parse(await readFile(join(backup,'manifest.json'),'utf8'));assert.ok(manifest.files.some(f=>f.path.startsWith('uploads/')));
    await writeFile(join(backup,'rtm.sqlite'),'corrupt');await assert.rejects(exec(process.execPath,['scripts/restore.js',backup,'--target',join(dir,'invalid-restore')],{env,windowsHide:true}),/yaxlitligi/);
  }));
  await t.test('Yengil yuklama — 30 parallel dashboard so‘rovi',()=>check('30 concurrent requests',async()=>{
    const start=performance.now();const statuses=await Promise.all(Array.from({length:30},()=>lead.request('/dashboard').then(r=>r.status)));assert.ok(statuses.every(s=>s===200));const elapsed=Math.round(performance.now()-start);results.push({name:'30 concurrent dashboard duration',milliseconds:elapsed});assert.ok(elapsed<15000,elapsed+'ms');
  }));
});
