import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import QRCode from 'qrcode';
import ExcelJS from 'exceljs';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';
import { db, initDb, transaction, dataDir, isPostgres, closeDb } from './db.js';
import { roles, roleLabels, token, digest, hashPassword, verifyPassword, verifyTotp, totp, manager, inventoryManager, canSeeDevice, canSeeTicket, transitions, slaHours, cleanText, positiveId, hasRole, rolesOf } from './security.js';
import { labels, excelBuffer, csvBuffer, pdfBuffer, docxBuffer, exportColumns, validateXlsx, assignmentTemplate } from './exports.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const production = process.env.APP_MODE === 'production';
if (production && (!isPostgres || !process.env.ADMIN_TOTP_SECRET || process.env.SECURE_COOKIE !== '1')) throw new Error('Production uchun PostgreSQL, ADMIN_TOTP_SECRET va SECURE_COOKIE=1 majburiy.');
const totpSecret = process.env.ADMIN_TOTP_SECRET;
if (!totpSecret) throw new Error('ADMIN_TOTP_SECRET ni lokal .env faylida sozlang. Test muhitini tayyorlash: npm run setup:test');
if (production && totpSecret.length < 32) throw new Error('Production TOTP siri noyob, kamida 32 belgili Base32 bo‘lsin.');
totp(totpSecret); // Fail early when the configured authenticator secret is invalid.
await initDb();
mkdirSync(join(dataDir, 'uploads'), { recursive: true });
const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:', 'blob:'], connectSrc: ["'self'"], fontSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"], upgradeInsecureRequests: production ? [] : null } }, crossOriginEmbedderPolicy: false, strictTransportSecurity: production ? undefined : false }));
app.use(express.json({ limit: '256kb' }));
app.use('/api', (req, res, next) => {
  if (req.is('application/json') && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))) return res.status(400).json({ error: 'JSON obyekt kutilmoqda' });
  next();
});
const now = () => new Date().toISOString();
const fail = (status, message) => Object.assign(new Error(message), { status });
const requireValue = (test, message, status = 400) => { if (!test) throw fail(status, message); };
const permission = (req, condition) => requireValue(condition, 'Bu amal uchun ruxsat berilmagan', 403);
const safeUser = user => ({ id: user.id, name: user.name, username: user.username, role: user.role, roles: rolesOf(user), department_id: user.department_id, department: user.department, phone: user.phone, active: user.active, employment_status: user.employment_status, revision: user.revision });
async function attachRoles(user, tx = db) {
  if (!user) return user;
  return { ...user, roles: (await tx.all('SELECT role FROM user_roles WHERE user_id=?', [user.id])).map(row => row.role) };
}
async function attachManyRoles(users, tx = db) {
  const assignments = await tx.all('SELECT user_id, role FROM user_roles');
  const map = new Map();
  for (const item of assignments) { if (!map.has(item.user_id)) map.set(item.user_id, []); map.get(item.user_id).push(item.role); }
  return users.map(user => ({ ...user, roles: rolesOf({ roles: map.get(user.id) || [] }) }));
}
const userRecord = async (tx, id) => attachRoles(await tx.get('SELECT u.*, d.name AS department FROM users u JOIN departments d ON d.id=u.department_id WHERE u.id=?', [id]), tx);
const log = (tx, req, action, entity, id, detail = '', changes = null) => tx.run('INSERT INTO audit (user_id, action, entity, entity_id, detail, ip, created_at, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [req.user?.id || null, action, entity, id || null, cleanText(detail, 2000), req.ip, now(), changes?.before ? JSON.stringify(changes.before) : '', changes?.after ? JSON.stringify(changes.after) : '']);
async function notify(tx, ids, title, entity, id) {
  for (const userId of [...new Set(ids.filter(Boolean))]) await tx.run('INSERT INTO notifications (user_id, title, entity_type, entity_id, created_at) VALUES (?, ?, ?, ?, ?)', [userId, title, entity, id, now()]);
}
const leads = async tx => (await tx.all("SELECT id FROM users WHERE active=1 AND EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id=users.id AND ur.role IN ('manager','superadmin'))")).map(user => user.id);
const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: process.env.SECURE_COOKIE === '1', path: '/', maxAge: 8 * 3600000 };
const attempts = new Map();
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.get('/api/health', async (req, res) => { await db.get('SELECT 1 AS ok'); res.json({ ok: true, mode: production ? 'production' : 'test', database: isPostgres ? 'PostgreSQL' : 'SQLite', version: '0.3.0' }); });
app.post('/api/auth/login', async (req, res) => {
  const username = cleanText(req.body.username, 60).toLowerCase();
  const key = `${req.ip}:${username}`;
  const attempt = attempts.get(key) || { count: 0, until: Date.now() + 900000 };
  if (attempt.until < Date.now()) { attempt.count = 0; attempt.until = Date.now() + 900000; }
  if (attempt.count >= 8) throw fail(429, 'Ko‘p urinish. 15 daqiqadan so‘ng qayta urinib ko‘ring.');
  const user = await attachRoles(await db.get("SELECT u.*, d.name AS department FROM users u JOIN departments d ON d.id=u.department_id WHERE username=? AND active=1 AND employment_status='employed'", [username]));
  const valid = user && typeof req.body.password === 'string' && req.body.password.length <= 200 && verifyPassword(req.body.password, user.password_hash);
  if (!valid) {
    if (!user) verifyPassword('dummy', hashPassword('dummy'));
    attempt.count++; attempts.set(key, attempt);
    await log(db, req, 'login_failed', 'auth', null, username);
    throw fail(401, 'Login yoki parol noto‘g‘ri');
  }
  if (hasRole(user, 'superadmin') && !verifyTotp(totpSecret, String(req.body.otp || ''))) {
    attempt.count++; attempts.set(key, attempt);
    req.user = user; await log(db, req, 'mfa_failed', 'auth', user.id);
    throw fail(401, 'Administrator uchun autentifikatordagi 6 xonali MFA kodi kerak');
  }
  if (hasRole(user, 'superadmin')) {
    const step = Math.floor(Date.now() / 30000);
    const matchedStep = [step - 1, step, step + 1].find(n => totp(totpSecret, n * 30000) === String(req.body.otp));
    const consumed = await db.get('UPDATE users SET mfa_last_step=? WHERE id=? AND mfa_last_step<? RETURNING id', [matchedStep, user.id, matchedStep]);
    if (!consumed) { req.user = user; await log(db, req, 'mfa_replay', 'auth', user.id); throw fail(401, 'Bu MFA kodi ishlatilgan. Keyingi kodni kuting.'); }
  }
  attempts.delete(key);
  const session = token(), csrf = token(), time = now();
  await db.run('DELETE FROM sessions WHERE expires_at < ?', [time]);
  await db.run('INSERT INTO sessions (id, user_id, csrf, expires_at, created_at) VALUES (?, ?, ?, ?, ?)', [digest(session), user.id, csrf, new Date(Date.now() + cookieOptions.maxAge).toISOString(), time]);
  req.user = user; await log(db, req, 'login', 'auth', user.id);
  res.cookie('rtm_session', session, cookieOptions).json({ user: safeUser(user), csrf, mode: production ? 'production' : 'test' });
});
app.use('/api', async (req, res, next) => {
  const raw = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('rtm_session='))?.slice(12);
  if (!raw || !/^[a-f0-9]{64}$/.test(raw)) throw fail(401, 'Tizimga kiring');
  const session = await db.get("SELECT s.*, u.name, u.username, u.role, u.department_id, u.phone, u.active, u.employment_status, u.revision, d.name AS department FROM sessions s JOIN users u ON u.id=s.user_id JOIN departments d ON d.id=u.department_id WHERE s.id=? AND s.expires_at>? AND u.active=1 AND u.employment_status='employed'", [digest(raw), now()]);
  if (!session) throw fail(401, 'Sessiya tugagan. Qayta kiring.');
  req.session = session; req.user = await attachRoles({ ...session, id: session.user_id });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    requireValue(req.get('X-CSRF-Token') === session.csrf, 'Xavfsizlik tokeni noto‘g‘ri. Sahifani yangilang.', 403);
    if (req.get('Sec-Fetch-Site') === 'cross-site') throw fail(403, 'Tashqi manbadan so‘rov rad etildi');
  }
  next();
});
app.get('/api/auth/me', (req, res) => res.json({ user: safeUser(req.user), csrf: req.session.csrf, mode: production ? 'production' : 'test' }));
const readSla = async (tx = db) => tx.get('SELECT * FROM sla_policy WHERE id=1');
const slaValues = policy => Object.fromEntries(Object.keys(slaHours).map(key => [key, policy[key]]));
app.get('/api/settings/sla', async (req, res) => res.json(await readSla()));
app.put('/api/settings/sla', async (req, res) => {
  permission(req, hasRole(req.user, 'superadmin'));
  const values = Object.keys(slaHours).map(key => {
    const value = req.body[key];
    requireValue((typeof value === 'number' || typeof value === 'string') && /^\d+$/.test(String(value)), 'SLA muddatlari butun soatlarda kiritiladi');
    const hours = Number(value); requireValue(hours >= 1 && hours <= 720, 'SLA 1–720 soat oralig‘ida bo‘lsin'); return hours;
  });
  requireValue(values.every((value, index) => index === 0 || value >= values[index - 1]), 'Shoshilinch ≤ yuqori ≤ o‘rta ≤ past tartibini saqlang');
  const result = await transaction(async tx => {
    const previous = await readSla(tx);
    requireValue(previous.revision === positiveId(req.body.revision), 'SLA boshqa sessiyada o‘zgargan. Sozlamani yangilang.', 409);
    const updated = await tx.get('UPDATE sla_policy SET critical=?, high=?, medium=?, low=?, revision=revision+1, updated_by=?, updated_at=? WHERE id=1 AND revision=? RETURNING *', [...values, req.user.id, now(), positiveId(req.body.revision) || 0]);
    requireValue(updated, 'SLA boshqa sessiyada o‘zgargan. Sozlamani yangilang.', 409);
    await log(tx, req, 'sla_update', 'settings', 1, `SLA qoidasi yangilandi; v${updated.revision}`, {before:slaValues(previous),after:slaValues(updated)});
    return updated;
  }); res.json(result);
});
app.post('/api/auth/logout', async (req, res) => { await transaction(async tx => { await tx.run('DELETE FROM sessions WHERE id=?', [req.session.id]); await log(tx, req, 'logout', 'auth', req.user.id); }); res.clearCookie('rtm_session', cookieOptions).json({ ok: true }); });
app.post('/api/auth/password', async (req, res) => {
  const user = await db.get('SELECT * FROM users WHERE id=?', [req.user.id]);
  requireValue(verifyPassword(String(req.body.current || ''), user.password_hash), 'Joriy parol noto‘g‘ri');
  requireValue(typeof req.body.password === 'string' && req.body.password.length >= 14 && req.body.password.length <= 128, 'Yangi parol 14–128 belgidan iborat bo‘lsin');
  await transaction(async tx => { await tx.run('UPDATE users SET password_hash=? WHERE id=?', [hashPassword(req.body.password), req.user.id]); await tx.run('DELETE FROM sessions WHERE user_id=?', [req.user.id]); await log(tx, req, 'password_changed', 'users', req.user.id); });
  res.clearCookie('rtm_session', cookieOptions).json({ ok: true });
});
function ticketScope(user, alias = 't') {
  if (manager(user)) return { sql: '1=1', args: [] };
  const parts = [`${alias}.created_by=?`], args = [user.id];
  if (hasRole(user, 'department_head')) { parts.push(`${alias}.department_id=?`); args.push(user.department_id); }
  if (hasRole(user, 'technician')) { parts.push(`${alias}.assigned_to=?`); args.push(user.id); }
  return { sql: '(' + parts.join(' OR ') + ')', args };
}
function deviceScope(user, alias = 'v') {
  return manager(user) ? { sql: '1=1', args: [] } : { sql: `${alias}.employee_id=?`, args: [user.id] };
}
const ticketSelect = `SELECT t.*, u.name AS creator, d.name AS department, a.name AS assignee, v.inventory_no, v.employee_id AS device_employee_id FROM tickets t JOIN users u ON u.id=t.created_by JOIN departments d ON d.id=t.department_id LEFT JOIN users a ON a.id=t.assigned_to LEFT JOIN devices v ON v.id=t.device_id`;
function visibleTicket(user, ticket) {
  const { device_employee_id, ...item } = ticket;
  if (!manager(user) && device_employee_id !== user.id) { item.device_id = null; item.inventory_no = null; }
  return item;
}
const deviceSelect = `SELECT v.*, d.name AS department, u.name AS employee, r.name AS responsible FROM devices v JOIN departments d ON d.id=v.department_id LEFT JOIN users u ON u.id=v.employee_id JOIN users r ON r.id=v.responsible_id`;
async function getTicket(req, id = req.params.id, tx = db) { const item = await tx.get(ticketSelect + ' WHERE t.id=?', [positiveId(id) || 0]); requireValue(item && canSeeTicket(req.user, item), 'Murojaat topilmadi', 404); return item; }
async function getDevice(req, id = req.params.id, tx = db) { const item = await tx.get(deviceSelect + ' WHERE v.id=?', [positiveId(id) || 0]); requireValue(item && canSeeDevice(req.user, item), 'Qurilma topilmadi', 404); return item; }
async function listTickets(req) {
  const scope = ticketScope(req.user), params = [...scope.args], where = [scope.sql];
  for (const key of ['status', 'priority', 'category']) if (req.query[key]) { where.push(`t.${key}=?`); params.push(cleanText(req.query[key])); }
  if (req.query.q) { where.push('(LOWER(t.title) LIKE ? OR CAST(t.id AS TEXT) LIKE ?)'); params.push(`%${cleanText(req.query.q).toLowerCase()}%`, `%${cleanText(req.query.q).replace(/^RTM-/, '')}%`); }
  if (req.query.from) { requireValue(validDate(req.query.from), 'Boshlanish sanasi noto‘g‘ri'); where.push('t.created_at>=?'); params.push(req.query.from); }
  if (req.query.to) { requireValue(validDate(req.query.to), 'Tugash sanasi noto‘g‘ri'); where.push('t.created_at<=?'); params.push(req.query.to + 'T23:59:59.999Z'); }
  if (req.query.overdue === '1') { where.push("t.due_at<? AND t.status NOT IN ('closed','confirmed','completed','rejected')"); params.push(now()); }
  return (await db.all(ticketSelect + ` WHERE ${where.join(' AND ')} ORDER BY t.id DESC LIMIT 2000`, params)).map(t => visibleTicket(req.user, t));
}
async function listDevices(req) {
  const scope = deviceScope(req.user), params = [...scope.args], where = [scope.sql];
  for (const key of ['status', 'category', 'department_id']) if (req.query[key]) { where.push(`v.${key}=?`); params.push(cleanText(req.query[key])); }
  if (req.query.unassigned === '1') where.push('v.employee_id IS NULL');
  if (req.query.q) { where.push('(LOWER(v.model) LIKE ? OR LOWER(v.inventory_no) LIKE ? OR LOWER(v.serial_no) LIKE ?)'); const q = `%${cleanText(req.query.q).toLowerCase()}%`; params.push(q, q, q); }
  return db.all(deviceSelect + ` WHERE ${where.join(' AND ')} ORDER BY v.id DESC LIMIT 2000`, params);
}
app.get('/api/reference', async (req, res) => {
  const broad = manager(req.user) || (hasRole(req.user, 'inventory') || hasRole(req.user, 'technician'));
  const departments = await db.all('SELECT * FROM departments' + (broad ? '' : ' WHERE id=?'), broad ? [] : [req.user.department_id]);
  const users = await db.all('SELECT u.id, u.name, u.role, u.department_id, u.active, u.employment_status, d.name AS department FROM users u JOIN departments d ON d.id=u.department_id WHERE u.active=1' + (broad ? '' : ' AND u.department_id=?'), broad ? [] : [req.user.department_id]);
  res.json({ departments, users: await attachManyRoles(users), roles: roleLabels, categories: ['Kompyuter/noutbuk', 'Internet', 'Wi-Fi', 'Printer/skaner', 'Operatsion tizim/dastur', 'Akkaunt/elektron pochta', 'HEMIS va boshqa tizimlar', 'Videokuzatuv', 'Server/tarmoq', 'Multimedia', 'Maslahat', 'Boshqa'], deviceCategories: ['Kompyuter', 'Monoblok', 'Noutbuk', 'Monitor', 'Printer', 'Skaner', 'Server', 'Router', 'Switch', 'Access point', 'Kamera', 'NVR/DVR', 'UPS', 'Proyektor', 'Interaktiv panel', 'Saqlash qurilmasi', 'Boshqa'], labels, sla: slaValues(await readSla()) });
});
app.get('/api/tickets', async (req, res) => res.json(await listTickets(req)));
app.get('/api/tickets/:id', async (req, res) => {
  const ticket = await getTicket(req);
  const events = await db.all('SELECT e.*, u.name AS actor FROM ticket_events e JOIN users u ON u.id=e.user_id WHERE ticket_id=? ORDER BY e.id', [ticket.id]);
  const attachments = await db.all('SELECT id, filename, mime, size, created_at FROM attachments WHERE ticket_id=?', [ticket.id]);
  res.json({ ...visibleTicket(req.user, ticket), events, attachments });
});
app.post('/api/tickets', async (req, res) => {
  const b = req.body, title = cleanText(b.title, 200), description = cleanText(b.description, 6000), priority = b.priority || 'medium';
  requireValue(title.length >= 5 && description.length >= 10, 'Mavzu kamida 5, tavsif kamida 10 belgidan iborat bo‘lsin');
  requireValue(Object.hasOwn(slaHours, priority), 'Ustuvorlik noto‘g‘ri');
  requireValue(cleanText(b.category).length && cleanText(b.building).length && cleanText(b.room).length, 'Toifa, bino va xonani kiriting');
  const deviceId = positiveId(b.device_id); if (deviceId) await getDevice(req, deviceId);
  const item = await transaction(async tx => {
    const time = now();
    const requestId = b.client_request_id ? `${req.user.id}:${cleanText(b.client_request_id, 100)}` : null;
    if (requestId) { const existing = await tx.get('SELECT * FROM tickets WHERE client_request_id=?', [requestId]); if (existing) return existing; }
    const policy = await readSla(tx);
    const item = await tx.get('INSERT INTO tickets (title, description, category, priority, created_by, department_id, device_id, building, room, phone, client_request_id, due_at, created_at, updated_at, sla_hours, sla_policy_revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *', [title, description, cleanText(b.category), priority, req.user.id, req.user.department_id, deviceId, cleanText(b.building), cleanText(b.room, 50), cleanText(b.phone, 40), requestId, new Date(Date.now() + policy[priority] * 3600000).toISOString(), time, time, policy[priority], policy.revision]);
    await tx.run('INSERT INTO ticket_events (ticket_id, user_id, kind, message, created_at) VALUES (?, ?, ?, ?, ?)', [item.id, req.user.id, 'created', 'Murojaat yaratildi', time]);
    await notify(tx, await leads(tx), `Yangi murojaat: ${title}`, 'tickets', item.id);
    await log(tx, req, 'create', 'tickets', item.id, title); return item;
  });
  res.status(201).json(item);
});
app.patch('/api/tickets/:id', async (req, res) => {
  const result = await transaction(async tx => {
    if (isPostgres) await tx.get('SELECT id FROM tickets WHERE id=? FOR UPDATE', [positiveId(req.params.id) || 0]);
    const ticket = await getTicket(req, req.params.id, tx), b = req.body;
    const isLead = manager(req.user), isTech = hasRole(req.user, 'technician') && ticket.assigned_to === req.user.id;
    const isOwner = ticket.created_by === req.user.id;
    const status = b.status || ticket.status;
    if (status !== ticket.status) {
      requireValue(transitions[ticket.status]?.includes(status), 'Bu holatga o‘tishga ruxsat yo‘q');
      if (['confirmed', 'reopened'].includes(status)) permission(req, isOwner || isLead);
      else permission(req, isLead || (isTech && ['in_progress', 'waiting', 'completed'].includes(status)));
      if (status === 'completed') requireValue(cleanText(b.comment, 6000).length >= 5, 'Bajarilgan ish haqida izoh yozing');
    }
    let assignee = ticket.assigned_to, assigneeName = '';
    if (Object.hasOwn(b, 'assigned_to')) {
      permission(req, isLead);
      assignee = positiveId(b.assigned_to);
      const technician = assignee && await tx.get("SELECT id, name FROM users WHERE id=? AND active=1 AND EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id=users.id AND ur.role='technician')", [assignee]);
      requireValue(technician, 'Faol IT mutaxassisini tanlang'); assigneeName = technician.name;
    }
    if (['assigned', 'in_progress', 'completed'].includes(status)) requireValue(assignee, 'Avval ijrochini biriktiring');
    const priority = b.priority || ticket.priority;
    if (priority !== ticket.priority) { permission(req, isLead); requireValue(Object.hasOwn(slaHours, priority), 'Ustuvorlik noto‘g‘ri'); }
    if (b.group_key !== undefined) permission(req, isLead);
    const rating = b.rating === undefined ? ticket.rating : Number(b.rating);
    if (b.rating !== undefined) { permission(req, isOwner && ['completed', 'confirmed', 'closed'].includes(ticket.status)); requireValue(Number.isInteger(rating) && rating >= 1 && rating <= 5, 'Baho 1–5 oralig‘ida bo‘lsin'); }
    const policy = priority !== ticket.priority ? await readSla(tx) : null;
    const due = policy ? new Date(Date.now() + policy[priority] * 3600000).toISOString() : ticket.due_at;
    const response = ticket.first_response_at || ((isLead || isTech) ? now() : null);
    await tx.run('UPDATE tickets SET status=?, assigned_to=?, priority=?, group_key=?, rating=?, due_at=?, first_response_at=?, completed_at=?, updated_at=?, sla_hours=?, sla_policy_revision=? WHERE id=?', [status, assignee, priority, b.group_key === undefined ? ticket.group_key : cleanText(b.group_key, 100), rating, due, response, status === 'completed' ? now() : status === 'reopened' ? null : ticket.completed_at, now(), policy ? policy[priority] : ticket.sla_hours, policy ? policy.revision : ticket.sla_policy_revision, ticket.id]);
    const message = [status !== ticket.status ? `${labels[ticket.status]} → ${labels[status]}` : '', assignee !== ticket.assigned_to ? `Ijrochi: ${assigneeName} (#${assignee})` : '', priority !== ticket.priority ? `Ustuvorlik: ${labels[ticket.priority]} → ${labels[priority]}` : '', b.group_key !== undefined && b.group_key !== ticket.group_key ? `Guruh: ${cleanText(b.group_key, 100) || 'olib tashlandi'}` : '', b.rating !== undefined ? `Xodim bahosi: ${rating}/5` : '', cleanText(b.comment, 6000)].filter(Boolean).join('. ') || 'Murojaat yangilandi';
    await tx.run('INSERT INTO ticket_events (ticket_id, user_id, kind, message, created_at) VALUES (?, ?, ?, ?, ?)', [ticket.id, req.user.id, status !== ticket.status ? 'status' : 'comment', message, now()]);
    await notify(tx, [ticket.created_by, assignee], `RTM-${ticket.id}: ${message.slice(0, 180)}`, 'tickets', ticket.id);
    await log(tx, req, 'update', 'tickets', ticket.id, message);
    return tx.get(ticketSelect + ' WHERE t.id=?', [ticket.id]);
  });
  res.json(visibleTicket(req.user, result));
});
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 5 } });
function checkedUpload(file) {
  requireValue(file, 'Faylni tanlang');
  const buffer = file.buffer;
  const png = buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpg = buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  const pdf = buffer.subarray(0, 5).toString() === '%PDF-' && !/\/(JavaScript|JS|OpenAction|Launch|EmbeddedFile)\b/i.test(buffer.toString('latin1'));
  requireValue(png || jpg || pdf, 'Faqat PNG, JPEG yoki faol skriptsiz PDF fayllar (5 MB gacha) qabul qilinadi');
  return { mime: png ? 'image/png' : jpg ? 'image/jpeg' : 'application/pdf', filename: cleanText(file.originalname.replace(/[\\/]/g, '_'), 180), sha256: digest(buffer) };
}
app.post('/api/tickets/:id/attachments', upload.single('file'), async (req, res) => {
  const ticket = await getTicket(req); requireValue(req.file, 'Faylni tanlang');
  const { buffer, originalname, size } = req.file;
  const png = buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpg = buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  const pdf = buffer.subarray(0, 5).toString() === '%PDF-' && !/\/(JavaScript|JS|OpenAction|Launch|EmbeddedFile)\b/i.test(buffer.toString('latin1'));
  requireValue(png || jpg || pdf, 'Faqat PNG, JPEG yoki faol skriptsiz PDF fayllar (5 MB gacha) qabul qilinadi');
  const storage = token(), filename = cleanText(originalname.replace(/[\\/]/g, '_'), 180);
  const path = join(dataDir, 'uploads', storage); writeFileSync(path, buffer, { mode: 0o600 });
  try {
    const result = await transaction(async tx => {
      const item = await tx.get('INSERT INTO attachments (ticket_id, filename, storage_name, mime, size, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id, filename, size', [ticket.id, filename, storage, png ? 'image/png' : jpg ? 'image/jpeg' : 'application/pdf', size, req.user.id, now()]);
      await log(tx, req, 'upload', 'tickets', ticket.id, filename); return item;
    }); res.status(201).json(result);
  } catch (e) { unlinkSync(path); throw e; }
});
app.get('/api/attachments/:id', async (req, res) => {
  const item = await db.get('SELECT * FROM attachments WHERE id=?', [positiveId(req.params.id) || 0]); requireValue(item, 'Fayl topilmadi', 404); await getTicket(req, item.ticket_id);
  res.set('Content-Type', item.mime).attachment(item.filename).sendFile(join(dataDir, 'uploads', item.storage_name));
});
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const deviceStatuses = ['warehouse', 'in_use', 'reserve', 'diagnostics', 'repair', 'faulty', 'retired'];
function deviceValues(b) {
  for (const key of ['inventory_no', 'category', 'model', 'serial_no', 'building', 'room']) requireValue(cleanText(b[key]).length, `${key} maydoni majburiy`);
  requireValue(validDate(b.commissioned_at), 'Foydalanishga topshirish sanasi noto‘g‘ri');
  requireValue(!b.warranty_until || validDate(b.warranty_until), 'Kafolat sanasi noto‘g‘ri');
  requireValue(!b.ip || isIP(b.ip) === 4, 'IPv4 manzil noto‘g‘ri');
  requireValue(!b.mac || /^([\da-f]{2}:){5}[\da-f]{2}$/i.test(b.mac), 'MAC manzil noto‘g‘ri');
  const status = b.status || 'warehouse'; requireValue(deviceStatuses.includes(status), 'Qurilma holati noto‘g‘ri');
  requireValue(Number.isFinite(Number(b.purchase_value || 0)) && Number(b.purchase_value || 0) >= 0, 'Xarid qiymati noto‘g‘ri');
  return [cleanText(b.inventory_no, 100), cleanText(b.category), cleanText(b.model), cleanText(b.serial_no), cleanText(b.specs, 2000), cleanText(b.building), cleanText(b.floor, 20), cleanText(b.room, 50), positiveId(b.department_id), null, positiveId(b.responsible_id), status, b.commissioned_at, b.purchased_at || null, Number(b.purchase_value || 0), b.warranty_until || null, b.ip || '', cleanText(b.mac), cleanText(b.os), now(), now()];
}
const deviceInsert = 'INSERT INTO devices (inventory_no, category, model, serial_no, specs, building, floor, room, department_id, employee_id, responsible_id, status, commissioned_at, purchased_at, purchase_value, warranty_until, ip, mac, os, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *';
app.get('/api/devices', async (req, res) => res.json(await listDevices(req)));
app.post('/api/devices', async (req, res) => {
  permission(req, inventoryManager(req.user)); const values = deviceValues(req.body);
  requireValue(await db.get('SELECT id FROM departments WHERE id=?', [values[8] || 0]), 'Bo‘limni tanlang');
  requireValue(await db.get('SELECT id FROM users WHERE id=? AND active=1', [values[10] || 0]), 'Moddiy javobgar xodimni tanlang');
  const item = await transaction(async tx => { const item = await tx.get(deviceInsert, values); await log(tx, req, 'create', 'devices', item.id, item.inventory_no); return item; });
  res.status(201).json(item);
});
app.get('/api/devices/:id', async (req, res) => {
  const device = await getDevice(req);
  const assignments = await db.all('SELECT a.*, f.name AS from_employee, t.name AS to_employee, u.name AS actor FROM assignments a LEFT JOIN users f ON f.id=a.from_employee_id LEFT JOIN users t ON t.id=a.to_employee_id JOIN users u ON u.id=a.actor_id WHERE device_id=? ORDER BY a.id DESC', [device.id]);
  const checks = await db.all('SELECT c.*, u.name AS actor FROM inventory_checks c JOIN users u ON u.id=c.actor_id WHERE device_id=? ORDER BY c.id DESC', [device.id]);
  const repairs = await db.all('SELECT m.*, u.name AS assignee FROM maintenance m JOIN users u ON u.id=m.assigned_to WHERE device_id=? ORDER BY m.id DESC', [device.id]);
  const scope = ticketScope(req.user);
  const tickets = await db.all(ticketSelect + ` WHERE t.device_id=? AND ${scope.sql} ORDER BY t.id DESC`, [device.id, ...scope.args]);
  res.json({ ...device, assignments, checks, repairs, tickets });
});
app.patch('/api/devices/:id', async (req, res) => {
  permission(req, inventoryManager(req.user) || hasRole(req.user, 'technician'));
  const item = await getDevice(req), b = req.body;
  const status = b.status || item.status; requireValue(deviceStatuses.includes(status), 'Holat noto‘g‘ri');
  if (status === 'retired') permission(req, inventoryManager(req.user) && b.confirm === true && !item.employee_id);
  requireValue(!b.ip || isIP(b.ip) === 4, 'IP manzil noto‘g‘ri');
  await transaction(async tx => { await tx.run('UPDATE devices SET status=?, specs=?, os=?, ip=?, updated_at=? WHERE id=?', [status, b.specs === undefined ? item.specs : cleanText(b.specs, 2000), b.os === undefined ? item.os : cleanText(b.os), b.ip === undefined ? item.ip : cleanText(b.ip), now(), item.id]); await log(tx, req, 'update', 'devices', item.id, `${item.status} → ${status}`); });
  res.json({ ok: true });
});
app.post('/api/devices/:id/assign', async (req, res) => {
  permission(req, inventoryManager(req.user)); requireValue(req.body.confirm === true, 'O‘tkazishni tasdiqlang');
  const basis = cleanText(req.body.basis, 2000); requireValue(basis.length >= 5, 'Biriktirish asosini kiriting');
  const result = await transaction(async tx => {
    // PostgreSQL row lock prevents concurrent transfers of the same asset.
    if (isPostgres) await tx.get('SELECT id FROM devices WHERE id=? FOR UPDATE', [positiveId(req.params.id) || 0]);
    const item = await getDevice(req, req.params.id, tx);
    requireValue(item.status !== 'retired', 'Hisobdan chiqarilgan qurilmani biriktirib bo‘lmaydi');
    if (req.body.expected_updated_at) requireValue(req.body.expected_updated_at === item.updated_at, 'Qurilma boshqa foydalanuvchi tomonidan o‘zgartirilgan. Yangilang.', 409);
    const employeeId = positiveId(req.body.employee_id);
    const employee = employeeId ? await tx.get('SELECT * FROM users WHERE id=? AND active=1', [employeeId]) : null;
    requireValue(!employeeId || employee, 'Xodim topilmadi'); requireValue(employeeId !== item.employee_id, 'Qurilma bu xodimga allaqachon biriktirilgan');
    const dept = employee?.department_id || item.department_id;
    const assignment = await tx.get('INSERT INTO assignments (device_id, from_employee_id, to_employee_id, from_department_id, to_department_id, basis, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *', [item.id, item.employee_id, employeeId, item.department_id, dept, basis, req.user.id, now()]);
    await tx.run('UPDATE devices SET employee_id=?, department_id=?, status=?, updated_at=? WHERE id=?', [employeeId, dept, employeeId ? 'in_use' : 'warehouse', now(), item.id]);
    const fromDepartment = await tx.get('SELECT name FROM departments WHERE id=?', [item.department_id]);
    const toDepartment = await tx.get('SELECT name FROM departments WHERE id=?', [dept]);
    const snapshot = { inventory_no: item.inventory_no, model: item.model, serial_no: item.serial_no, specs: item.specs, building: item.building, room: item.room, condition: labels[item.status], responsible: item.responsible, from_employee: item.employee || 'Ombor', to_employee: employee?.name || 'Ombor', from_department: fromDepartment.name, to_department: toDepartment.name, actor: req.user.name };
    await tx.run('UPDATE assignments SET snapshot_json=? WHERE id=?', [JSON.stringify(snapshot), assignment.id]);
    const document = await tx.get('INSERT INTO documents (kind, title, device_id, assignment_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id', ['transfer', `${item.inventory_no} — ${employeeId ? 'biriktirish' : 'qaytarish'} dalolatnomasi`, item.id, assignment.id, req.user.id, now()]);
    await notify(tx, [item.employee_id, employeeId], `${item.inventory_no}: qurilma ${employeeId ? 'biriktirildi' : 'omborga qaytarildi'}`, 'devices', item.id);
    await log(tx, req, employeeId ? 'transfer' : 'return', 'devices', item.id, basis); return { ...assignment, document_id: document.id };
  }); res.status(201).json(result);
});
app.get('/api/devices/:id/qr', async (req, res) => {
  const item = await getDevice(req);
  const origin = process.env.APP_ORIGIN || `${req.protocol}://${req.get('host')}`;
  const svg = await QRCode.toString(`${origin}/?device=${item.id}`, { type: 'svg', width: 256, margin: 2, errorCorrectionLevel: 'M' });
  res.type('svg').send(svg);
});
app.post('/api/devices/:id/check', async (req, res) => {
  permission(req, inventoryManager(req.user)); const item = await getDevice(req);
  await transaction(async tx => { await tx.run('INSERT INTO inventory_checks (device_id, actor_id, note, created_at) VALUES (?, ?, ?, ?)', [item.id, req.user.id, cleanText(req.body.note, 1000) || 'Qurilma joyida tekshirildi', now()]); await log(tx, req, 'inventory_check', 'devices', item.id); }); res.json({ ok: true });
});
app.post('/api/devices-import', upload.single('file'), async (req, res) => {
  permission(req, inventoryManager(req.user)); requireValue(req.file && /\.xlsx$/i.test(req.file.originalname), 'XLSX faylini tanlang');
  validateXlsx(req.file.buffer);
  const book = new ExcelJS.Workbook(); await book.xlsx.load(req.file.buffer);
  const sheet = book.worksheets[0]; requireValue(sheet && sheet.rowCount <= 501, 'Bir importda ko‘pi bilan 500 qator');
  const fields = ['inventory_no', 'category', 'model', 'serial_no', 'building', 'room', 'department_id', 'responsible_id', 'commissioned_at'];
  const headers = sheet.getRow(1).values.slice(1).map(String); requireValue(fields.every(field => headers.includes(field)), `Sarlavhalar: ${fields.join(', ')}`);
  const rows = [];
  sheet.eachRow((row, index) => { if (index === 1) return; const item = {}; headers.forEach((key, i) => { const value = row.getCell(i + 1).value; requireValue(value === null || ['string', 'number'].includes(typeof value), `${index}-qatorda faqat matn yoki son kiriting`); item[key] = value === null ? '' : String(value); }); rows.push(deviceValues(item)); });
  await transaction(async tx => { for (const values of rows) { requireValue(await tx.get('SELECT id FROM departments WHERE id=?', [values[8] || 0]), 'Importda bo‘lim topilmadi'); requireValue(await tx.get('SELECT id FROM users WHERE id=? AND active=1', [values[10] || 0]), 'Importda javobgar xodim topilmadi'); await tx.get(deviceInsert, values); } await log(tx, req, 'import', 'devices', null, `${rows.length} ta qurilma`); });
  res.json({ imported: rows.length });
});
app.get('/api/device-template', async (req, res) => {
  permission(req, inventoryManager(req.user)); const fields = ['inventory_no', 'category', 'model', 'serial_no', 'building', 'room', 'department_id', 'responsible_id', 'commissioned_at'];
  res.attachment('inventar-import.xlsx').send(await excelBuffer('Import', fields.map(f => [f, f]), []));
});
const maintenanceSelect = `SELECT m.*, v.inventory_no, v.model, u.name AS assignee FROM maintenance m JOIN devices v ON v.id=m.device_id JOIN users u ON u.id=m.assigned_to`;
function maintenanceScope(user) {
  if (manager(user)) return { sql: '1=1', args: [] };
  if (hasRole(user, 'technician')) return { sql: '(m.assigned_to=? OR v.employee_id=?)', args: [user.id, user.id] };
  const scope = deviceScope(user); return scope;
}
async function listMaintenance(req) {
  const scope = maintenanceScope(req.user);
  const rows = await db.all(maintenanceSelect.replace('SELECT m.*,', 'SELECT v.employee_id AS device_employee_id, m.*,') + ` WHERE ${scope.sql} ORDER BY m.planned_at LIMIT 2000`, scope.args);
  return rows.map(({ device_employee_id, ...item }) => { if (!manager(req.user) && device_employee_id !== req.user.id) { item.device_id = null; item.inventory_no = null; item.model = null; } return item; });
}
app.get('/api/maintenance', async (req, res) => res.json(await listMaintenance(req)));
app.post('/api/maintenance', async (req, res) => {
  permission(req, manager(req.user) || hasRole(req.user, 'technician')); const b = req.body;
  await getDevice(req, b.device_id); requireValue(cleanText(b.title).length >= 5 && validDate(b.planned_at), 'Ish nomi va reja sanasini kiriting');
  const assignee = positiveId(b.assigned_to) || req.user.id;
  permission(req, manager(req.user) || assignee === req.user.id);
  requireValue(await db.get("SELECT id FROM users WHERE id=? AND active=1 AND EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id=users.id AND ur.role='technician')", [assignee]), 'IT mutaxassisini tanlang');
  const ticketId = positiveId(b.ticket_id);
  if (ticketId) { const t = await getTicket(req, ticketId); requireValue(!t.device_id || t.device_id === Number(b.device_id), 'Murojaat boshqa qurilmaga tegishli'); }
  const repeat = Number(b.repeat_days || 0); requireValue(Number.isInteger(repeat) && repeat >= 0 && repeat <= 3650, 'Takrorlash oralig‘i noto‘g‘ri');
  const item = await transaction(async tx => { const item = await tx.get('INSERT INTO maintenance (device_id, ticket_id, title, assigned_to, planned_at, repeat_days, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *', [Number(b.device_id), ticketId, cleanText(b.title), assignee, b.planned_at, repeat, now()]); await log(tx, req, 'create', 'maintenance', item.id, item.title); await notify(tx, [assignee], `Profilaktika: ${item.title}`, 'maintenance', item.id); return item; }); res.status(201).json(item);
});
app.post('/api/maintenance/:id/complete', async (req, res) => {
  const b = req.body;
  requireValue(cleanText(b.diagnosis, 2000).length >= 3 && cleanText(b.work_done, 3000).length >= 5, 'Diagnostika va bajarilgan ishni yozing');
  const minutes = Number(b.minutes); requireValue(Number.isInteger(minutes) && minutes > 0 && minutes <= 100000, 'Sarflangan vaqtni daqiqada kiriting');
  const result = await transaction(async tx => {
    if (isPostgres) await tx.get('SELECT id FROM maintenance WHERE id=? FOR UPDATE', [positiveId(req.params.id) || 0]);
    const item = await tx.get('SELECT * FROM maintenance WHERE id=?', [positiveId(req.params.id) || 0]); requireValue(item, 'Ish topilmadi', 404);
    permission(req, manager(req.user) || (hasRole(req.user, 'technician') && item.assigned_to === req.user.id)); requireValue(item.status === 'planned', 'Bu ish allaqachon yakunlangan', 409);
    const stockId = positiveId(b.stock_id), qty = Number(b.quantity || 0);
    if (stockId) {
      requireValue(Number.isInteger(qty) && qty > 0, 'Sarf miqdori musbat butun son bo‘lsin');
      const stock = await tx.get('UPDATE stock SET quantity=quantity-? WHERE id=? AND quantity>=? RETURNING *', [qty, stockId, qty]); requireValue(stock, 'Omborda yetarli qoldiq yo‘q', 409);
      await tx.run('INSERT INTO stock_moves (stock_id, delta, reason, maintenance_id, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', [stockId, -qty, 'Ta’mirlash uchun sarf', item.id, req.user.id, now()]);
      await log(tx, req, 'consume', 'stock', stockId, `${qty} ${stock.unit}; ish #${item.id}`);
    }
    await tx.run('UPDATE maintenance SET diagnosis=?, work_done=?, minutes=?, completed_at=?, status=? WHERE id=?', [cleanText(b.diagnosis, 2000), cleanText(b.work_done, 3000), minutes, now(), 'done', item.id]);
    if (item.repeat_days > 0) {
      const next = new Date(Math.max(Date.parse(item.planned_at), Date.now()) + item.repeat_days * 86400000).toISOString().slice(0, 10);
      await tx.run('INSERT INTO maintenance (device_id, title, assigned_to, planned_at, repeat_days, created_at) VALUES (?, ?, ?, ?, ?, ?)', [item.device_id, item.title, item.assigned_to, next, item.repeat_days, now()]);
    }
    await log(tx, req, 'complete', 'maintenance', item.id, cleanText(b.work_done, 3000)); return { ok: true };
  }); res.json(result);
});
const canManageResources = user => manager(user) || hasRole(user, 'inventory');
const canSeeResources = user => canManageResources(user) || hasRole(user, 'technician');
app.get('/api/stock', async (req, res) => { permission(req, canSeeResources(req.user)); res.json(await db.all('SELECT * FROM stock ORDER BY name')); });
app.post('/api/stock', async (req, res) => {
  permission(req, canManageResources(req.user)); const b = req.body;
  requireValue(cleanText(b.name).length >= 2 && cleanText(b.unit), 'Nomi va o‘lchov birligini kiriting');
  const minimum = Number(b.minimum || 0); requireValue(Number.isInteger(minimum) && minimum >= 0, 'Minimal zaxira noto‘g‘ri');
  const item = await transaction(async tx => { const item = await tx.get('INSERT INTO stock (name, unit, minimum, location) VALUES (?, ?, ?, ?) RETURNING *', [cleanText(b.name), cleanText(b.unit, 20), minimum, cleanText(b.location)]); await log(tx, req, 'create', 'stock', item.id, item.name); return item; }); res.status(201).json(item);
});
app.get('/api/stock/:id/moves', async (req, res) => { permission(req, canSeeResources(req.user)); res.json(await db.all('SELECT m.*, u.name AS actor FROM stock_moves m JOIN users u ON u.id=m.actor_id WHERE stock_id=? ORDER BY m.id DESC LIMIT 300', [positiveId(req.params.id) || 0])); });
app.post('/api/stock/:id/move', async (req, res) => {
  permission(req, canManageResources(req.user)); const delta = Number(req.body.delta), reason = cleanText(req.body.reason, 1000);
  requireValue(Number.isInteger(delta) && delta !== 0 && Math.abs(delta) <= 1000000 && reason.length >= 5, 'Miqdor va harakat asosini to‘g‘ri kiriting');
  const result = await transaction(async tx => {
    const item = await tx.get('UPDATE stock SET quantity=quantity+? WHERE id=? AND quantity+?>=0 RETURNING *', [delta, positiveId(req.params.id) || 0, delta]); requireValue(item, 'Qoldiq yetarli emas yoki mahsulot topilmadi', 409);
    await tx.run('INSERT INTO stock_moves (stock_id, delta, reason, actor_id, created_at) VALUES (?, ?, ?, ?, ?)', [item.id, delta, reason, req.user.id, now()]);
    await log(tx, req, 'move', 'stock', item.id, `${delta}: ${reason}`); return item;
  }); res.json(result);
});
function validSubnet(subnet, ip) {
  const [network, maskText] = String(subnet).split('/'), mask = Number(maskText);
  if (isIP(network) !== 4 || String(mask) !== maskText || mask < 8 || mask > 32 || isIP(ip) !== 4) return false;
  const integer = address => address.split('.').reduce((total, octet) => (total * 256 + Number(octet)) >>> 0, 0);
  const bits = mask === 32 ? 0xffffffff : (0xffffffff << (32 - mask)) >>> 0;
  return (integer(network) & bits) === (integer(ip) & bits) && ((integer(network) & bits) >>> 0) === integer(network);
}
app.get('/api/networks', async (req, res) => { permission(req, manager(req.user) || hasRole(req.user, 'technician')); const scope = deviceScope(req.user); res.json(await db.all(`SELECT n.*, v.inventory_no FROM networks n LEFT JOIN devices v ON v.id=n.device_id WHERE ${scope.sql} ORDER BY n.vlan, n.ip`, scope.args)); });
app.post('/api/networks', async (req, res) => {
  permission(req, manager(req.user) || hasRole(req.user, 'technician')); const b = req.body, vlan = Number(b.vlan);
  requireValue(cleanText(b.name).length >= 3 && validSubnet(b.subnet, b.ip), 'Subnet CIDR va shu tarmoqqa tegishli IPv4 manzilni kiriting');
  requireValue(Number.isInteger(vlan) && vlan >= 1 && vlan <= 4094, 'VLAN 1–4094 oralig‘ida bo‘lsin');
  requireValue(!b.mac || /^([\da-f]{2}:){5}[\da-f]{2}$/i.test(b.mac), 'MAC manzil noto‘g‘ri');
  const deviceId = positiveId(b.device_id); if (deviceId) await getDevice(req, deviceId);
  const item = await transaction(async tx => { const item = await tx.get('INSERT INTO networks (name, subnet, vlan, ip, mac, port, device_id, provider, building) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *', [cleanText(b.name), b.subnet, vlan, b.ip, cleanText(b.mac), cleanText(b.port), deviceId, cleanText(b.provider), cleanText(b.building)]); await log(tx, req, 'create', 'networks', item.id, `${b.subnet}: ${b.ip}`); return item; }); res.status(201).json(item);
});
app.get('/api/licenses', async (req, res) => { permission(req, canSeeResources(req.user)); res.json(await db.all('SELECT l.*, (SELECT COUNT(*) FROM license_installs i WHERE i.license_id=l.id) AS installed FROM licenses l ORDER BY l.expires_at')); });
app.post('/api/licenses', async (req, res) => {
  permission(req, canManageResources(req.user)); const b = req.body, seats = Number(b.seats);
  requireValue(cleanText(b.name).length >= 2 && cleanText(b.owner) && Number.isInteger(seats) && seats > 0 && validDate(b.expires_at), 'Litsenziya nomi, egasi, soni va muddatini kiriting');
  requireValue(!Object.keys(b).some(key => /password|token|secret|key/i.test(key)), 'Maxfiy kalitlarni bu reyestrda saqlamang');
  const item = await transaction(async tx => { const item = await tx.get('INSERT INTO licenses (name, owner, seats, expires_at, notes) VALUES (?, ?, ?, ?, ?) RETURNING *', [cleanText(b.name), cleanText(b.owner), seats, b.expires_at, cleanText(b.notes, 1000)]); await log(tx, req, 'create', 'licenses', item.id, item.name); return item; }); res.status(201).json(item);
});
app.post('/api/licenses/:id/install', async (req, res) => {
  permission(req, manager(req.user) || hasRole(req.user, 'technician')); await getDevice(req, req.body.device_id);
  await transaction(async tx => {
    const id = positiveId(req.params.id) || 0;
    const license = await tx.get('SELECT * FROM licenses WHERE id=?' + (isPostgres ? ' FOR UPDATE' : ''), [id]); requireValue(license, 'Litsenziya topilmadi', 404);
    const count = await tx.get('SELECT COUNT(*) AS n FROM license_installs WHERE license_id=?', [id]); requireValue(Number(count.n) < license.seats, 'Bo‘sh litsenziya qolmagan', 409);
    requireValue(license.expires_at >= now().slice(0, 10), 'Litsenziya muddati tugagan');
    await tx.run('INSERT INTO license_installs (license_id, device_id, installed_at) VALUES (?, ?, ?)', [id, Number(req.body.device_id), now()]); await log(tx, req, 'install', 'licenses', id, `Qurilma #${req.body.device_id}`);
  }); res.json({ ok: true });
});
app.get('/api/users', async (req, res) => {
  permission(req, manager(req.user));
  const where = [], args = [];
  if (req.query.q) { where.push('(LOWER(u.name) LIKE ? OR LOWER(u.username) LIKE ? OR u.phone LIKE ? OR LOWER(d.name) LIKE ?)'); const q = `%${cleanText(req.query.q).toLowerCase()}%`; args.push(q,q,q,q); }
  if (req.query.role) { requireValue(roles.includes(req.query.role), 'Rol filtri noto‘g‘ri'); where.push('EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id=u.id AND ur.role=?)'); args.push(req.query.role); }
  if (req.query.department_id) { requireValue(positiveId(req.query.department_id), 'Bo‘lim filtri noto‘g‘ri'); where.push('u.department_id=?'); args.push(Number(req.query.department_id)); }
  if (req.query.active !== undefined && req.query.active !== '') { requireValue(['0','1'].includes(req.query.active), 'Faollik filtri noto‘g‘ri'); where.push('u.active=?'); args.push(Number(req.query.active)); }
  if (req.query.employment_status) { requireValue(['employed','dismissed'].includes(req.query.employment_status), 'Xodim holati noto‘g‘ri'); where.push('u.employment_status=?'); args.push(req.query.employment_status); }
  res.json(await attachManyRoles(await db.all(`SELECT u.id, u.name, u.username, u.role, u.department_id, u.phone, u.active, u.employment_status, u.revision, d.name AS department, (SELECT COUNT(*) FROM devices v WHERE v.employee_id=u.id) AS device_count FROM users u JOIN departments d ON d.id=u.department_id ${where.length ? 'WHERE '+where.join(' AND ') : ''} ORDER BY u.name`, args)));
});
function requestedRoles(body, fallback = []) {
  const selected = Object.hasOwn(body, 'roles') ? body.roles : Object.hasOwn(body, 'role') ? [body.role] : fallback;
  requireValue(Array.isArray(selected) && selected.length > 0 && selected.length <= roles.length && new Set(selected).size === selected.length && selected.every(role=>roles.includes(role)), 'Kamida bitta haqiqiy rol tanlang. “Bo‘shagan” rol emas, xodim holatidir.');
  return roles.filter(role => selected.includes(role));
}
async function saveRoles(tx, id, selected) { await tx.run('DELETE FROM user_roles WHERE user_id=?', [id]); for (const role of selected) await tx.run('INSERT INTO user_roles (user_id, role) VALUES (?, ?)', [id, role]); }
async function checkOffboarding(tx, id) {
  requireValue(!await tx.get('SELECT id FROM devices WHERE employee_id=? LIMIT 1', [id]), 'Avval xodimga biriktirilgan qurilmalarni qaytaring', 409);
  requireValue(!await tx.get("SELECT id FROM tickets WHERE assigned_to=? AND status NOT IN ('closed','rejected','confirmed') LIMIT 1", [id]), 'Avval ijrodagi murojaatlarni boshqa mutaxassisga o‘tkazing', 409);
  requireValue(!await tx.get("SELECT id FROM maintenance WHERE assigned_to=? AND status='planned' LIMIT 1", [id]), 'Avval rejalashtirilgan texnik xizmat ishlarini yakunlang yoki taqsimlang', 409);
}
app.post('/api/users', async (req, res) => {
  permission(req, hasRole(req.user, 'superadmin')); const b = req.body;
  const selected = requestedRoles(b);
  requireValue(cleanText(b.name).length >= 3 && /^[a-z0-9._-]{3,40}$/.test(b.username || ''), 'F.I.Sh. va loginni tekshiring');
  requireValue(!selected.includes('superadmin'), 'Qo‘shimcha superadministrator hisobini alohida MFA jarayonisiz yaratib bo‘lmaydi');
  requireValue(typeof b.password === 'string' && b.password.length >= 14 && b.password.length <= 128, 'Parol 14–128 belgidan iborat bo‘lsin');
  requireValue(await db.get('SELECT id FROM departments WHERE id=?', [positiveId(b.department_id) || 0]), 'Bo‘limni tanlang');
  requireValue(!b.employment_status || b.employment_status === 'employed', 'Yangi hisob dastlab ishlayotgan xodim uchun yaratiladi');
  const item = await transaction(async tx => {
    const item = await tx.get('INSERT INTO users (name, username, password_hash, role, department_id, phone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id', [cleanText(b.name), b.username, hashPassword(b.password), selected[0], Number(b.department_id), cleanText(b.phone, 40), now()]);
    await saveRoles(tx, item.id, selected); const result = safeUser(await userRecord(tx, item.id));
    await log(tx, req, 'create', 'users', item.id, `${result.name}: ${selected.map(role=>roleLabels[role]).join(', ')}`, {after:result}); return result;
  }); res.status(201).json(item);
});
app.get('/api/users/:id/checklist', async (req, res) => {
  permission(req, manager(req.user) || Number(req.params.id) === req.user.id);
  res.json(await db.all(deviceSelect + ' WHERE v.employee_id=?', [positiveId(req.params.id) || 0]));
});
app.patch('/api/users/:id', async (req, res) => {
  permission(req, hasRole(req.user, 'superadmin')); requireValue(req.body.confirm === true, 'Amalni tasdiqlang');
  const id = positiveId(req.params.id); requireValue(id, 'Xodim ID noto‘g‘ri');
  const result = await transaction(async tx => {
    if (isPostgres) await tx.get('SELECT id FROM users WHERE id=? FOR UPDATE', [id]);
    const item = await userRecord(tx, id); requireValue(item, 'Xodim topilmadi', 404); const b = req.body;
    if (b.revision !== undefined) requireValue(positiveId(b.revision) === item.revision, 'Ma’lumot boshqa sessiyada o‘zgargan. Ro‘yxatni yangilang.', 409);
    const selected = requestedRoles(b, rolesOf(item));
    requireValue(!selected.includes('superadmin') || hasRole(item, 'superadmin'), 'Qo‘shimcha superadmin roli uchun alohida MFA sozlash jarayoni kerak');
    requireValue(b.active === undefined || typeof b.active === 'boolean', 'Faollik true yoki false bo‘lsin');
    const active = b.active === undefined ? item.active : b.active ? 1 : 0;
    const status = b.employment_status ?? item.employment_status;
    requireValue(['employed','dismissed'].includes(status), 'Xodim holati noto‘g‘ri');
    if (status === 'dismissed' && item.employment_status !== 'dismissed') requireValue(item.active === 0, 'Avval xodimni faolsizlantiring, keyin “Bo‘shagan” holatini tanlang', 409);
    requireValue(status !== 'dismissed' || active === 0, 'Bo‘shagan xodimni faollashtirishdan oldin holatini “Ishlayapti”ga qaytaring', 409);
    if (id === req.user.id) requireValue(active === 1 && selected.includes('superadmin') && status === 'employed', 'O‘z superadmin huquqingiz yoki faolligingizni bekor qila olmaysiz', 409);
    if (hasRole(item, 'superadmin') && (!active || !selected.includes('superadmin'))) requireValue(await tx.get("SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id WHERE ur.role='superadmin' AND u.active=1 AND u.id<>? LIMIT 1", [id]), 'Oxirgi faol superadministratorni o‘chirib bo‘lmaydi', 409);
    if (!active || status === 'dismissed') await checkOffboarding(tx, id);
    if (hasRole(item, 'technician') && !selected.includes('technician')) {
      requireValue(!await tx.get("SELECT id FROM tickets WHERE assigned_to=? AND status NOT IN ('closed','rejected','confirmed') LIMIT 1", [id]) && !await tx.get("SELECT id FROM maintenance WHERE assigned_to=? AND status='planned' LIMIT 1", [id]), 'IT rolini olib tashlashdan oldin ijrodagi ishlarni yakunlang yoki taqsimlang', 409);
    }
    const departmentId = b.department_id === undefined ? item.department_id : positiveId(b.department_id);
    requireValue(await tx.get('SELECT id FROM departments WHERE id=?', [departmentId || 0]), 'Bo‘lim topilmadi');
    const name = b.name === undefined ? item.name : cleanText(b.name); requireValue(name.length >= 3, 'F.I.Sh. kamida 3 belgidan iborat bo‘lsin');
    await tx.run('UPDATE users SET name=?, phone=?, active=?, employment_status=?, role=?, department_id=?, revision=revision+1 WHERE id=?', [name, b.phone === undefined ? item.phone : cleanText(b.phone,40), active, status, selected[0], departmentId, id]);
    await saveRoles(tx, id, selected); await tx.run('DELETE FROM sessions WHERE user_id=?', [id]);
    const updated = safeUser(await userRecord(tx, id));
    await log(tx, req, 'update', 'users', id, `${updated.name}: rollar, bo‘lim yoki hisob holati yangilandi`, {before:safeUser(item),after:updated}); return updated;
  }); res.json(result);
});
app.get('/api/departments', async (req, res) => {
  permission(req, manager(req.user)); const args=[],where=[];
  if(req.query.q){where.push('(LOWER(d.name) LIKE ? OR LOWER(d.building) LIKE ?)');const q=`%${cleanText(req.query.q).toLowerCase()}%`;args.push(q,q);}
  if(req.query.building){where.push('d.building=?');args.push(cleanText(req.query.building));}
  res.json(await db.all(`SELECT d.*, (SELECT COUNT(*) FROM users u WHERE u.department_id=d.id) AS employee_count FROM departments d ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY d.name`,args));
});
app.post('/api/departments', async (req, res) => {
  permission(req, hasRole(req.user, 'superadmin')); requireValue(cleanText(req.body.name).length >= 3 && cleanText(req.body.building), 'Bo‘lim va bino nomini kiriting');
  const item = await transaction(async tx => { const item = await tx.get('INSERT INTO departments (name, building) VALUES (?, ?) RETURNING *', [cleanText(req.body.name), cleanText(req.body.building)]); await log(tx, req, 'create', 'departments', item.id, item.name, {after:item}); return item; }); res.status(201).json(item);
});
app.patch('/api/departments/:id', async (req,res)=>{
  permission(req,hasRole(req.user,'superadmin'));requireValue(req.body.confirm===true,'Amalni tasdiqlang');
  const result=await transaction(async tx=>{
    const item=await tx.get('SELECT * FROM departments WHERE id=?'+(isPostgres?' FOR UPDATE':''),[positiveId(req.params.id)||0]);requireValue(item,'Bo‘lim topilmadi',404);
    requireValue(positiveId(req.body.revision)===item.revision,'Bo‘lim boshqa sessiyada o‘zgargan. Yangilang.',409);
    const name=cleanText(req.body.name),building=cleanText(req.body.building);requireValue(name.length>=3&&building,'Bo‘lim va bino nomini kiriting');
    const updated=await tx.get('UPDATE departments SET name=?,building=?,revision=revision+1 WHERE id=? RETURNING *',[name,building,item.id]);
    await log(tx,req,'update','departments',item.id,`${item.name} → ${name}`,{before:item,after:updated});return updated;
  });res.json(result);
});
async function listDocuments(req) {
  const scope = documentScope(req.user);
  return db.all(documentSelect + ` WHERE ${scope.sql} ORDER BY x.id DESC LIMIT 1000`, scope.args);
}
const documentSelect = `SELECT x.*, u.name AS creator, a.name AS approver, v.inventory_no, mv.from_employee_id, mv.to_employee_id, (SELECT COUNT(*) FROM signed_document_files sf WHERE sf.document_id=x.id) AS signed_count FROM documents x JOIN users u ON u.id=x.created_by LEFT JOIN users a ON a.id=x.approved_by LEFT JOIN devices v ON v.id=x.device_id LEFT JOIN assignments mv ON mv.id=x.assignment_id`;
function documentScope(user) {
  return manager(user) ? { sql: '1=1', args: [] } : { sql: '((x.assignment_id IS NULL AND v.employee_id=?) OR (x.assignment_id IS NOT NULL AND (mv.from_employee_id=? OR mv.to_employee_id=?)))', args: [user.id, user.id, user.id] };
}
async function getDocument(req, id = req.params.id, tx = db) {
  const scope = documentScope(req.user);
  const item = await tx.get(documentSelect + ` WHERE x.id=? AND ${scope.sql}`, [positiveId(id) || 0, ...scope.args]);
  requireValue(item, 'Hujjat topilmadi', 404); return item;
}
const signedFiles = (id, tx = db) => tx.all('SELECT f.id, f.document_id, f.filename, f.mime, f.size, f.sha256, f.uploaded_by, f.uploaded_at, f.status, f.reviewed_by, f.reviewed_at, f.review_note, u.name AS uploader, r.name AS reviewer FROM signed_document_files f JOIN users u ON u.id=f.uploaded_by LEFT JOIN users r ON r.id=f.reviewed_by WHERE f.document_id=? ORDER BY f.id DESC', [id]);
app.get('/api/documents', async (req, res) => res.json(await listDocuments(req)));
app.get('/api/documents/:id', async (req, res) => {
  const item = await getDocument(req);
  const movement = item.assignment_id ? await db.get('SELECT * FROM assignments WHERE id=?', [item.assignment_id]) : null;
  res.json({ ...item, movement: movement ? { id: movement.id, basis: movement.basis, created_at: movement.created_at, snapshot: movement.snapshot_json ? JSON.parse(movement.snapshot_json) : null } : null, signed_files: await signedFiles(item.id) });
});
app.get('/api/documents/:id/signed-files', async (req, res) => { const item = await getDocument(req); res.json(await signedFiles(item.id)); });
app.post('/api/documents/:id/signed-files', upload.single('file'), async (req, res) => {
  const item = await getDocument(req);
  requireValue(item.kind === 'transfer' && item.assignment_id, 'Imzolangan fayl biriktirish yoki qaytarish harakatiga bog‘lanishi kerak');
  requireValue(req.body.confirm === 'true', 'Fayl shu dalolatnomaning qo‘lda tasdiqlangan nusxasi ekanini tasdiqlang');
  const info = checkedUpload(req.file), storage = token(), path = join(dataDir, 'uploads', storage);
  writeFileSync(path, req.file.buffer, { mode: 0o600 });
  try {
    const result = await transaction(async tx => {
      if (isPostgres) await tx.get('SELECT id FROM documents WHERE id=? FOR UPDATE', [item.id]);
      await getDocument(req, item.id, tx);
      const count = await tx.get('SELECT COUNT(*) AS n FROM signed_document_files WHERE document_id=?', [item.id]);
      requireValue(Number(count.n) < 10, 'Bitta dalolatnomaga ko‘pi bilan 10 ta nusxa yuklanadi');
      const file = await tx.get('INSERT INTO signed_document_files (document_id, filename, storage_name, mime, size, sha256, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, document_id, filename, sha256, status', [item.id, info.filename, storage, info.mime, req.file.size, info.sha256, req.user.id, now()]);
      await log(tx, req, 'signed_upload', 'documents', item.id, `${info.filename}; SHA-256 ${info.sha256}`);
      await notify(tx, await leads(tx), `RTM-DOC-${item.id}: imzolangan nusxa tekshiruvni kutmoqda`, 'documents', item.id);
      return file;
    }); res.status(201).json(result);
  } catch (error) { unlinkSync(path); throw error; }
});
app.get('/api/signed-files/:id/download', async (req, res) => {
  const file = await db.get('SELECT * FROM signed_document_files WHERE id=?', [positiveId(req.params.id) || 0]);
  requireValue(file, 'Fayl topilmadi', 404); await getDocument(req, file.document_id);
  await log(db, req, 'signed_download', 'documents', file.document_id, `Nusxa #${file.id}`);
  res.set('Content-Type', file.mime).attachment(file.filename).sendFile(join(dataDir, 'uploads', file.storage_name));
});
app.post('/api/signed-files/:id/review', async (req, res) => {
  permission(req, manager(req.user));
  requireValue(req.body.confirm === true && ['accepted', 'rejected'].includes(req.body.status), 'Tekshiruv qarori va tasdiqni kiriting');
  const note = cleanText(req.body.note, 2000);
  requireValue(req.body.status !== 'rejected' || note.length >= 5, 'Rad etish sababini yozing');
  await transaction(async tx => {
    const file = await tx.get('SELECT * FROM signed_document_files WHERE id=?' + (isPostgres ? ' FOR UPDATE' : ''), [positiveId(req.params.id) || 0]);
    requireValue(file, 'Fayl topilmadi', 404);
    permission(req, file.uploaded_by !== req.user.id);
    const changed = await tx.get("UPDATE signed_document_files SET status=?, reviewed_by=?, reviewed_at=?, review_note=? WHERE id=? AND status='pending' RETURNING id", [req.body.status, req.user.id, now(), note, file.id]);
    requireValue(changed, 'Bu nusxa allaqachon tekshirilgan', 409);
    if (req.body.status === 'accepted') {
      await tx.run("UPDATE documents SET status='approved', approved_by=? WHERE id=?", [req.user.id, file.document_id]);
      await log(tx, req, 'approve', 'documents', file.document_id, `Imzolangan nusxa #${file.id} qabul qilindi`);
    }
    await log(tx, req, 'signed_review', 'documents', file.document_id, `Nusxa #${file.id}: ${req.body.status}; ${note}`);
    await notify(tx, [file.uploaded_by], `RTM-DOC-${file.document_id}: nusxa ${req.body.status === 'accepted' ? 'qabul qilindi' : 'rad etildi'}`, 'documents', file.document_id);
  }); res.json({ ok: true });
});
app.post('/api/documents', async (req, res) => {
  permission(req, inventoryManager(req.user) || (hasRole(req.user, 'technician') || hasRole(req.user, 'inventory'))); const b = req.body;
  requireValue(['fault', 'repair', 'inventory', 'writeoff'].includes(b.kind) && cleanText(b.title).length >= 5, 'Hujjat turi va nomini kiriting. Biriktirish/qaytarish dalolatnomasi qurilma harakatidan yaratiladi.');
  const deviceId = positiveId(b.device_id); requireValue(deviceId, 'Qurilmani tanlang'); await getDevice(req, deviceId);
  const item = await transaction(async tx => { const item = await tx.get('INSERT INTO documents (kind, title, device_id, created_by, created_at) VALUES (?, ?, ?, ?, ?) RETURNING *', [b.kind, cleanText(b.title), deviceId, req.user.id, now()]); await log(tx, req, 'create', 'documents', item.id, item.title); return item; }); res.status(201).json(item);
});
app.post('/api/documents/:id/approve', async (req, res) => {
  permission(req, manager(req.user)); requireValue(req.body.confirm === true, 'Tasdiqlashni tasdiqlang');
  const item = await db.get('SELECT * FROM documents WHERE id=?', [positiveId(req.params.id) || 0]); requireValue(item, 'Hujjat topilmadi', 404);
  if (item.kind === 'transfer') requireValue(await db.get("SELECT id FROM signed_document_files WHERE document_id=? AND status='accepted'", [item.id]), 'Avval imzolangan nusxani yuklab, boshqa rahbar tekshiruvidan o‘tkazing', 409);
  await transaction(async tx => { const changed = await tx.get("UPDATE documents SET status='approved', approved_by=? WHERE id=? AND status='draft' RETURNING id", [req.user.id, item.id]); requireValue(changed, 'Hujjat allaqachon tasdiqlangan', 409); await log(tx, req, 'approve', 'documents', item.id); }); res.json({ ok: true });
});
app.get('/api/documents/:id/download', async (req, res) => {
  const item = await getDocument(req);
  const device = item.device_id ? await db.get(deviceSelect + ' WHERE v.id=?', [item.device_id]) : null;
  const lines = [`Hujjat raqami: RTM-DOC-${item.id}`, `Holati: ${labels[item.status]}`, `Tuzuvchi: ${item.creator}`, `Tasdiqlovchi: ${item.approver || 'Hali tasdiqlanmagan'}`];
  let template = null;
  if (device && !item.assignment_id) lines.push(`Qurilma: ${device.inventory_no} — ${device.model}`, `Seriya raqami: ${device.serial_no}`, `Bo‘lim: ${device.department}`, `Xona: ${device.building}, ${device.room}`, `Joriy biriktirilgan xodim: ${device.employee || 'Biriktirilmagan'}`);
  if (item.assignment_id) {
    const a = await db.get('SELECT x.*, f.name AS sender, t.name AS recipient FROM assignments x LEFT JOIN users f ON f.id=x.from_employee_id LEFT JOIN users t ON t.id=x.to_employee_id WHERE x.id=?', [item.assignment_id]);
    template = assignmentTemplate(item, a, device);
  }
  if (['repair', 'fault'].includes(item.kind) && device) {
    const work = await db.all('SELECT * FROM maintenance WHERE device_id=? ORDER BY id DESC LIMIT 10', [device.id]);
    for (const w of work) lines.push(`${w.title}: ${w.diagnosis || 'Diagnostika kutilmoqda'}; ${w.work_done || 'Ish yakunlanmagan'}; ${w.minutes} daqiqa.`);
  }
  lines.push('Topshiruvchi imzosi: __________________', 'Qabul qiluvchi imzosi: __________________');
  await log(db, req, 'download', 'documents', item.id);
  if (req.query.format === 'docx') res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document').attachment(`RTM-DOC-${item.id}.docx`).send(await docxBuffer(template?.title || item.title, template?.lines || lines));
  else res.type('pdf').attachment(`RTM-DOC-${item.id}.pdf`).send(await pdfBuffer(template?.title || item.title, template?.lines || lines));
});
app.get('/api/tickets/:id/pdf', async (req, res) => {
  const t = await getTicket(req); const events = await db.all('SELECT e.*, u.name AS actor FROM ticket_events e JOIN users u ON u.id=e.user_id WHERE ticket_id=? ORDER BY e.id', [t.id]);
  const lines = [`Ariza raqami: RTM-${t.id}`, `Murojaatchi: ${t.creator}`, `Bo‘lim: ${t.department}`, `Joylashuv: ${t.building}, ${t.room}`, `Toifa: ${t.category}`, `Ustuvorlik: ${labels[t.priority]}`, `Holat: ${labels[t.status]}`, `Ijrochi: ${t.assignee || 'Biriktirilmagan'}`, `SLA muddati: ${t.due_at}`, `Mavzu: ${t.title}`, t.description, 'Amallar tarixi:', ...events.map(e => `${e.created_at} · ${e.actor}: ${e.message}`)];
  res.type('pdf').attachment(`RTM-${t.id}.pdf`).send(await pdfBuffer('Texnik xizmat uchun ariza', lines));
});
app.get('/api/exports/:entity', async (req, res) => {
  const entity = req.params.entity, columns = exportColumns[entity]; requireValue(columns, 'Hisobot turi topilmadi', 404);
  let records;
  if (entity === 'tickets') records = await listTickets(req);
  if (entity === 'devices') records = await listDevices(req);
  if (entity === 'maintenance') records = await listMaintenance(req);
  if (entity === 'stock') { permission(req, canSeeResources(req.user)); records = await db.all('SELECT * FROM stock'); }
  const format = req.query.format || 'xlsx'; requireValue(['xlsx', 'csv', 'pdf'].includes(format), 'Format noto‘g‘ri');
  await log(db, req, 'export', entity, null, `${records.length} qator; ${format}`);
  res.attachment(`RTM-${entity}-${now().slice(0, 10)}.${format}`);
  if (format === 'csv') res.type('text/csv; charset=utf-8').send(csvBuffer(columns, records));
  else if (format === 'pdf') res.type('pdf').send(await pdfBuffer('RTM — ' + entity + ' hisoboti', records.map(record => columns.map(([key, label]) => `${label}: ${labels[record[key]] || record[key] || '—'}`).join(' | '))));
  else res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(await excelBuffer('RTM hisobot', columns, records));
});
async function alertsFor(req) {
  const tickets = await listTickets({ ...req, query: {} }), devices = await listDevices({ ...req, query: {} }); const time = Date.now(), alerts = [];
  const open = tickets.filter(t => !['completed', 'confirmed', 'closed', 'rejected'].includes(t.status));
  for (const t of open) if (Date.parse(t.due_at) < time + 3600000) alerts.push({ title: `RTM-${t.id}: ${Date.parse(t.due_at) < time ? 'SLA muddati o‘tgan' : 'SLA muddati yaqin'}`, detail: t.title, severity: Date.parse(t.due_at) < time ? 'danger' : 'warning', entity_type: 'tickets', entity_id: t.id });
  for (const d of devices) if (d.warranty_until && Date.parse(d.warranty_until) <= time + 30 * 86400000) alerts.push({ title: `${d.inventory_no}: kafolat muddati`, detail: `${d.model} · ${d.warranty_until}`, severity: 'warning', entity_type: 'devices', entity_id: d.id });
  if (canSeeResources(req.user)) {
    for (const s of await db.all('SELECT * FROM stock WHERE quantity<=minimum')) alerts.push({ title: `${s.name}: zaxira kamaygan`, detail: `${s.quantity} ${s.unit}, minimum ${s.minimum}`, severity: 'warning', entity_type: 'stock', entity_id: s.id });
    for (const l of await db.all('SELECT * FROM licenses WHERE expires_at<=?', [new Date(time + 30 * 86400000).toISOString().slice(0, 10)])) alerts.push({ title: `${l.name}: litsenziya muddati`, detail: l.expires_at, severity: 'warning', entity_type: 'licenses', entity_id: l.id });
  }
  for (const m of await listMaintenance(req)) if (m.status === 'planned' && Date.parse(m.planned_at) <= time + 86400000) alerts.push({ title: `Texnik xizmat: ${m.title}`, detail: `${m.inventory_no || 'Xizmat topshirig‘i'} · ${m.planned_at}`, severity: 'warning', entity_type: 'maintenance', entity_id: m.id });
  return alerts;
}
app.get('/api/notifications', async (req, res) => res.json({ messages: await db.all('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 100', [req.user.id]), alerts: await alertsFor(req) }));
app.post('/api/notifications/read', async (req, res) => { await db.run('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL', [now(), req.user.id]); res.json({ ok: true }); });
app.get('/api/dashboard', async (req, res) => {
  const tickets = await listTickets({ ...req, query: {} }), devices = await listDevices({ ...req, query: {} }), time = Date.now();
  const terminal = ['completed', 'confirmed', 'closed', 'rejected'];
  const counts = items => items.reduce((result, value) => { result[value] = (result[value] || 0) + 1; return result; }, {});
  const resolved = tickets.filter(t => t.completed_at), responses = tickets.filter(t => t.first_response_at);
  const avg = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length / 3600000 : 0;
  const trend = Array.from({ length: 7 }, (_, i) => { const day = new Date(time - (6 - i) * 86400000).toISOString().slice(0, 10); return { day, created: tickets.filter(t => t.created_at.startsWith(day)).length, completed: tickets.filter(t => t.completed_at?.startsWith(day)).length }; });
  const workloads = manager(req.user) ? await db.all("SELECT u.id, u.name, (SELECT COUNT(*) FROM tickets t WHERE t.assigned_to=u.id AND t.status NOT IN ('completed','confirmed','closed','rejected')) AS open_count FROM users u WHERE EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id=u.id AND ur.role='technician') AND active=1") : [];
  res.json({ total: tickets.length, new: tickets.filter(t => t.status === 'new').length, active: tickets.filter(t => !terminal.includes(t.status)).length, closed: tickets.filter(t => ['closed', 'confirmed'].includes(t.status)).length, overdue: tickets.filter(t => !terminal.includes(t.status) && Date.parse(t.due_at) < time).length, devices: devices.length, unassigned: devices.filter(d => !d.employee_id).length, avg_response: avg(responses.map(t => Date.parse(t.first_response_at) - Date.parse(t.created_at))), avg_resolution: avg(resolved.map(t => Date.parse(t.completed_at) - Date.parse(t.created_at))), statuses: counts(tickets.map(t => t.status)), categories: counts(tickets.map(t => t.category)), departments: counts(tickets.map(t => t.department)), device_statuses: counts(devices.map(d => d.status)), trend, workloads, recent: tickets.slice(0, 5), alerts: (await alertsFor(req)).slice(0, 6) });
});
app.get('/api/audit', async (req, res) => {
  permission(req, hasRole(req.user, 'superadmin')); const where=[],args=[];
  if(req.query.q){const q=`%${cleanText(req.query.q).toLowerCase()}%`;where.push('(LOWER(a.action) LIKE ? OR LOWER(a.detail) LIKE ? OR LOWER(a.entity) LIKE ? OR LOWER(u.name) LIKE ? OR LOWER(u.username) LIKE ?)');args.push(q,q,q,q,q);}
  for(const key of ['action','entity'])if(req.query[key]){where.push(`a.${key}=?`);args.push(cleanText(req.query[key],80));}
  if(req.query.entity_id){requireValue(positiveId(req.query.entity_id),'Yozuv raqami noto‘g‘ri');where.push('a.entity_id=?');args.push(Number(req.query.entity_id));}
  if(req.query.user_id){requireValue(positiveId(req.query.user_id),'Foydalanuvchi filtri noto‘g‘ri');where.push('a.user_id=?');args.push(Number(req.query.user_id));}
  if(req.query.from){requireValue(validDate(req.query.from),'Boshlanish sanasi noto‘g‘ri');where.push('a.created_at>=?');args.push(new Date(req.query.from+'T00:00:00+05:00').toISOString());}
  if(req.query.to){requireValue(validDate(req.query.to),'Tugash sanasi noto‘g‘ri');where.push('a.created_at<=?');args.push(new Date(req.query.to+'T23:59:59.999+05:00').toISOString());}
  requireValue(!req.query.from||!req.query.to||req.query.from<=req.query.to,'Sana oralig‘i noto‘g‘ri');
  const limit=req.query.limit===undefined?500:Number(req.query.limit),page=req.query.page===undefined?1:Number(req.query.page);
  requireValue(Number.isInteger(limit)&&limit>=1&&limit<=500&&Number.isInteger(page)&&page>=1&&page<=1000000,'Sahifa yoki limit noto‘g‘ri');
  const rows=await db.all(`SELECT a.*,u.name AS actor FROM audit a LEFT JOIN users u ON u.id=a.user_id ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY a.id DESC LIMIT ? OFFSET ?`,[...args,limit,(page-1)*limit]);
  res.json(rows.map(({before_json,after_json,...row})=>({...row,before:before_json?JSON.parse(before_json):null,after:after_json?JSON.parse(after_json):null})));
});
app.use('/api', (req, res) => res.status(404).json({ error: 'API manzili topilmadi' }));
app.use(express.static(join(root, 'public'), { etag: true, maxAge: production ? '1h' : 0 }));
app.get('/', (req, res) => res.sendFile(join(root, 'public', 'index.html')));
app.use(async (error, req, res, next) => {
  if (res.headersSent) return next(error);
  let status = error.status || 500, message = error.message;
  if (['23505', 'SQLITE_CONSTRAINT_UNIQUE'].includes(error.code) || /UNIQUE constraint failed/.test(message)) { status = 409; message = 'Bu ma’lumot allaqachon mavjud (inventar, seriya, login yoki IP takrorlandi)'; }
  if (['23503'].includes(error.code) || /FOREIGN KEY constraint/.test(message)) { status = 400; message = 'Bog‘liq yozuv topilmadi'; }
  if (error.code === 'LIMIT_FILE_SIZE') { status = 413; message = 'Fayl hajmi 5 MB dan oshmasin'; }
  if (status >= 500) {
    console.error(now(), error.stack);
    try { await log(db, req, 'server_error', 'system', null, `${req.method} ${req.path}: ${error.code || 'internal'}`); } catch { /* Original error remains visible to the operator. */ }
    message = 'Server xatosi. Administratorga murojaat qiling.';
  }
  res.status(status).json({ error: message });
});
const port = Number(process.env.PORT || 3000), host = process.env.HOST || '127.0.0.1';
const server = app.listen(port, host, () => console.log(`RTM IT ${production ? 'production' : 'TEST'}: http://${host}:${port} (${isPostgres ? 'PostgreSQL' : 'SQLite'})`));
const housekeeping = setInterval(() => { db.run('DELETE FROM sessions WHERE expires_at<?', [now()]).catch(console.error); const time = Date.now(); for (const [key, value] of attempts) if (value.until < time) attempts.delete(key); }, 60000).unref();
async function shutdown() { clearInterval(housekeeping); server.close(async () => { await closeDb(); process.exit(0); }); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
