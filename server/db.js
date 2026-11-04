import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { hashPassword } from './security.js';

export const dataDir = resolve(process.env.DATA_DIR || './data');
mkdirSync(dataDir, { recursive: true });
export const isPostgres = Boolean(process.env.DATABASE_URL);
let sqlite, pool;
if (isPostgres) {
  const { default: pg } = await import('pg');
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10, connectionTimeoutMillis: 5000 });
} else {
  sqlite = new DatabaseSync(join(dataDir, 'rtm.sqlite'));
  sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
}
const sqlForPg = sql => { let n = 0; return sql.replace(/\?/g, () => `$${++n}`); };
function connection(client) {
  return {
    async all(sql, params = []) { return isPostgres ? (await client.query(sqlForPg(sql), params)).rows : sqlite.prepare(sql).all(...params); },
    async get(sql, params = []) { return (await this.all(sql, params))[0]; },
    async run(sql, params = []) { return isPostgres ? client.query(sqlForPg(sql), params) : sqlite.prepare(sql).run(...params); }
  };
}
// Serialize SQLite async transactions; PostgreSQL uses a dedicated pooled connection.
let queue = Promise.resolve();
const direct = connection(pool);
export const db = isPostgres ? direct : {
  async all(sql, params = []) { await queue; return direct.all(sql, params); },
  async get(sql, params = []) { return (await this.all(sql, params))[0]; },
  async run(sql, params = []) { await queue; return direct.run(sql, params); }
};
export async function transaction(work) {
  if (isPostgres) {
    const client = await pool.connect();
    try { await client.query('BEGIN'); const result = await work(connection(client)); await client.query('COMMIT'); return result; }
    catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
  const previous = queue;
  let release;
  queue = new Promise(r => { release = r; });
  await previous;
  try { sqlite.exec('BEGIN IMMEDIATE'); const result = await work(direct); sqlite.exec('COMMIT'); return result; }
  catch (e) { sqlite.exec('ROLLBACK'); throw e; } finally { release(); }
}
export async function closeDb() { if (pool) await pool.end(); else sqlite.close(); }
export async function backupSqlite(path) {
  if (isPostgres) throw new Error('PostgreSQL uchun pg_dump ishlating.');
  const { backup } = await import('node:sqlite');
  await backup(sqlite, path);
}

export async function initDb() {
  const id = isPostgres ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
  const schemas = [
    `CREATE TABLE IF NOT EXISTS schema_versions (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS departments (id ${id}, name TEXT NOT NULL UNIQUE, building TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS users (id ${id}, name TEXT NOT NULL, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL, department_id INTEGER NOT NULL REFERENCES departments(id), phone TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS devices (id ${id}, inventory_no TEXT NOT NULL UNIQUE, category TEXT NOT NULL, model TEXT NOT NULL, serial_no TEXT NOT NULL UNIQUE, specs TEXT NOT NULL DEFAULT '', building TEXT NOT NULL, floor TEXT NOT NULL DEFAULT '', room TEXT NOT NULL, department_id INTEGER NOT NULL REFERENCES departments(id), employee_id INTEGER REFERENCES users(id), responsible_id INTEGER NOT NULL REFERENCES users(id), status TEXT NOT NULL, commissioned_at TEXT NOT NULL, purchased_at TEXT, purchase_value REAL NOT NULL DEFAULT 0, warranty_until TEXT, ip TEXT NOT NULL DEFAULT '', mac TEXT NOT NULL DEFAULT '', os TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS tickets (id ${id}, title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL, priority TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', created_by INTEGER NOT NULL REFERENCES users(id), department_id INTEGER NOT NULL REFERENCES departments(id), assigned_to INTEGER REFERENCES users(id), device_id INTEGER REFERENCES devices(id), building TEXT NOT NULL, room TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', group_key TEXT NOT NULL DEFAULT '', client_request_id TEXT UNIQUE, due_at TEXT NOT NULL, first_response_at TEXT, completed_at TEXT, rating INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS ticket_events (id ${id}, ticket_id INTEGER NOT NULL REFERENCES tickets(id), user_id INTEGER NOT NULL REFERENCES users(id), kind TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS assignments (id ${id}, device_id INTEGER NOT NULL REFERENCES devices(id), from_employee_id INTEGER REFERENCES users(id), to_employee_id INTEGER REFERENCES users(id), from_department_id INTEGER NOT NULL REFERENCES departments(id), to_department_id INTEGER NOT NULL REFERENCES departments(id), basis TEXT NOT NULL, actor_id INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS stock (id ${id}, name TEXT NOT NULL, unit TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0), minimum INTEGER NOT NULL DEFAULT 0 CHECK(minimum >= 0), location TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS maintenance (id ${id}, device_id INTEGER NOT NULL REFERENCES devices(id), ticket_id INTEGER REFERENCES tickets(id), title TEXT NOT NULL, diagnosis TEXT NOT NULL DEFAULT '', work_done TEXT NOT NULL DEFAULT '', assigned_to INTEGER NOT NULL REFERENCES users(id), planned_at TEXT NOT NULL, completed_at TEXT, minutes INTEGER NOT NULL DEFAULT 0, repeat_days INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'planned', created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS stock_moves (id ${id}, stock_id INTEGER NOT NULL REFERENCES stock(id), delta INTEGER NOT NULL, reason TEXT NOT NULL, maintenance_id INTEGER REFERENCES maintenance(id), actor_id INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS networks (id ${id}, name TEXT NOT NULL, subnet TEXT NOT NULL, vlan INTEGER NOT NULL, ip TEXT NOT NULL, mac TEXT NOT NULL DEFAULT '', port TEXT NOT NULL DEFAULT '', device_id INTEGER REFERENCES devices(id), provider TEXT NOT NULL DEFAULT '', building TEXT NOT NULL, UNIQUE(subnet, ip))`,
    `CREATE TABLE IF NOT EXISTS licenses (id ${id}, name TEXT NOT NULL, owner TEXT NOT NULL, seats INTEGER NOT NULL CHECK(seats > 0), expires_at TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '')`,
    `CREATE TABLE IF NOT EXISTS license_installs (id ${id}, license_id INTEGER NOT NULL REFERENCES licenses(id), device_id INTEGER NOT NULL REFERENCES devices(id), installed_at TEXT NOT NULL, UNIQUE(license_id, device_id))`,
    `CREATE TABLE IF NOT EXISTS documents (id ${id}, kind TEXT NOT NULL, title TEXT NOT NULL, device_id INTEGER REFERENCES devices(id), assignment_id INTEGER REFERENCES assignments(id), created_by INTEGER NOT NULL REFERENCES users(id), status TEXT NOT NULL DEFAULT 'draft', approved_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS inventory_checks (id ${id}, device_id INTEGER NOT NULL REFERENCES devices(id), actor_id INTEGER NOT NULL REFERENCES users(id), note TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS attachments (id ${id}, ticket_id INTEGER NOT NULL REFERENCES tickets(id), filename TEXT NOT NULL, storage_name TEXT NOT NULL UNIQUE, mime TEXT NOT NULL, size INTEGER NOT NULL, created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS notifications (id ${id}, user_id INTEGER NOT NULL REFERENCES users(id), title TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id INTEGER, read_at TEXT, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS audit (id ${id}, user_id INTEGER REFERENCES users(id), action TEXT NOT NULL, entity TEXT NOT NULL, entity_id INTEGER, detail TEXT NOT NULL, ip TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_tickets_scope ON tickets(department_id, created_by, assigned_to, status)`,
    `CREATE INDEX IF NOT EXISTS idx_tickets_due ON tickets(due_at, status)`,
    `CREATE INDEX IF NOT EXISTS idx_devices_scope ON devices(department_id, employee_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_events_ticket ON ticket_events(ticket_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_time ON audit(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at)`
  ];
  for (const schema of schemas) await db.run(schema);
  await db.run('INSERT INTO schema_versions (version, applied_at) VALUES (1, ?) ON CONFLICT(version) DO NOTHING', [new Date().toISOString()]);
  if (!await db.get('SELECT version FROM schema_versions WHERE version=2')) {
    await transaction(async tx => {
      await tx.run('ALTER TABLE users ADD COLUMN mfa_last_step INTEGER NOT NULL DEFAULT 0');
      await tx.run('INSERT INTO schema_versions (version, applied_at) VALUES (2, ?)', [new Date().toISOString()]);
    });
  }
  if (await db.get('SELECT id FROM users LIMIT 1')) return;
  await transaction(async tx => {
    const now = new Date().toISOString();
    const date = offset => new Date(Date.now() + offset * 86400000).toISOString();
    const departments = [['Raqamli ta’lim texnologiyalari markazi', 'Asosiy bino'], ['O‘quv-uslubiy bo‘lim', 'Asosiy bino'], ['Sport fakulteti', 'O‘quv binosi'], ['Moliya va hisob bo‘limi', 'Asosiy bino'], ['Kutubxona', 'Axborot resurs markazi']];
    for (const row of departments) await tx.run('INSERT INTO departments (name, building) VALUES (?, ?)', row);
    const demo = process.env.APP_MODE !== 'production';
    const password = process.env.BOOTSTRAP_PASSWORD;
    if (!password || password.length < 14) throw new Error('BOOTSTRAP_PASSWORD kamida 14 belgidan iborat bo‘lsin. Test muhiti: npm run setup:test');
    const users = demo ? [
      ['Azamat Allambergenov', 'admin', 'superadmin', 1], ['Jasur Orazbayev', 'rahbar', 'manager', 1],
      ['Diyor Bekmuratov', 'diyor', 'technician', 1], ['Madina Jollibekova', 'madina', 'technician', 1],
      ['Nodira Karimova', 'bolim', 'department_head', 2], ['Dilnoza Yusupova', 'xodim', 'employee', 2],
      ['Rustam Saparov', 'sport', 'employee', 3], ['Sardor Qurbanov', 'ombor', 'inventory', 1],
      ['Gulnora Beknazarova', 'moliya', 'employee', 4]
    ] : [['Administrator', 'admin', 'superadmin', 1]];
    for (const row of users) await tx.run('INSERT INTO users (name, username, role, department_id, password_hash, phone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [...row, hashPassword(password), '+998 61 222 01 01', now]);
    if (!demo) return;
    const models = [['Kompyuter', 'Lenovo ThinkCentre M70s', 'Core i5-12400 · 16 GB RAM · 512 GB SSD'], ['Noutbuk', 'HP ProBook 450 G9', 'Core i5-1235U · 16 GB RAM · 512 GB SSD'], ['Printer', 'Canon i-SENSYS MF3010', 'Lazerli · A4 · USB'], ['Monitor', 'Dell P2422H', '24 dyuym · IPS · Full HD'], ['Switch', 'TP-Link TL-SG2428P', '24 port · PoE+ · Gigabit'], ['Access point', 'Ubiquiti UniFi U6 Lite', 'Wi-Fi 6 · 2×2 MIMO'], ['UPS', 'APC Back-UPS 1100', '1100 VA · 660 W'], ['Proyektor', 'Epson EB-X49', '3600 lm · XGA']];
    for (let i = 0; i < 24; i++) {
      const [category, model, specs] = models[i % models.length];
      const dept = i % 5 + 1, employee = { 1: 3, 2: 6, 3: 7, 4: 9, 5: null }[dept];
      await tx.run('INSERT INTO devices (inventory_no, category, model, serial_no, specs, building, floor, room, department_id, employee_id, responsible_id, status, commissioned_at, purchased_at, purchase_value, warranty_until, ip, mac, os, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        `RTM-2026-${String(i + 1).padStart(4, '0')}`, category, model, `UZRTM26${10000 + i}`, specs, departments[dept - 1][1], String(i % 3 + 1), String(100 + i * 3), dept, i >= 20 ? null : employee, 8,
        i >= 22 ? 'warehouse' : i === 4 ? 'repair' : i === 9 ? 'faulty' : i >= 20 ? 'reserve' : 'in_use', '2025-09-01', '2025-08-20', 4500000 + i * 300000, date(i < 3 ? 15 + i * 5 : 180 + i).slice(0, 10), `192.168.${dept}.${10 + i}`, `02:26:AA:BB:CC:${i.toString(16).padStart(2, '0')}`, category === 'Kompyuter' || category === 'Noutbuk' ? 'Windows 11 Pro' : '', now, now
      ]);
    }
    const titles = ['203-xonada internet aloqasi uzilib qolmoqda', 'Printer qog‘ozni tortmayapti', 'HEMIS tizimiga kirishda xatolik', 'Noutbuk ishga tushmayapti', 'Wi-Fi signalini kuchaytirish kerak', 'Office dasturini sozlash', 'Proyektor tasviri xira ko‘rinmoqda', 'Elektron pochta parolini tiklash', 'Kompyuter sekin ishlayapti', 'Tarmoq printerini ulash', 'Videokuzatuv yozuvi ko‘rinmayapti', 'UPS batareyasini tekshirish', 'O‘quv xonasida yangi kompyuter o‘rnatish', 'Skaner drayverini yangilash', 'Server zaxira nusxasini tekshirish'];
    const categories = ['Internet', 'Printer/skaner', 'HEMIS va boshqa tizimlar', 'Kompyuter/noutbuk', 'Wi-Fi', 'Operatsion tizim/dastur', 'Multimedia', 'Akkaunt/elektron pochta'];
    const statuses = ['new', 'in_progress', 'assigned', 'reviewing', 'waiting', 'completed', 'closed', 'confirmed', 'in_progress', 'new', 'assigned', 'closed', 'completed', 'reopened', 'reviewing'];
    for (let i = 0; i < titles.length; i++) {
      const owner = [6, 7, 9][i % 3], dept = { 6: 2, 7: 3, 9: 4 }[owner];
      await tx.run('INSERT INTO tickets (title, description, category, priority, status, created_by, department_id, assigned_to, device_id, building, room, phone, group_key, due_at, first_response_at, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [titles[i], 'Ish jarayoniga ta’sir qilayotgan nosozlikni tekshirish va bartaraf etishda amaliy yordam berishingizni so‘rayman.', categories[i % 8], ['high', 'medium', 'low', 'critical'][i % 4], statuses[i], owner, dept, i % 3 === 0 ? null : (i % 2 ? 3 : 4), null, departments[dept - 1][1], `${201 + i}`, '+998 90 123 45 67', i === 0 || i === 4 ? 'NET-2026-01' : '', date(i === 1 || i === 8 ? -0.2 : i + 0.2), i > 0 ? date(-2) : null, ['completed', 'closed', 'confirmed'].includes(statuses[i]) ? date(-1) : null, date(-3 + i / 10), now]);
      await tx.run('INSERT INTO ticket_events (ticket_id, user_id, kind, message, created_at) VALUES (?, ?, ?, ?, ?)', [i + 1, owner, 'created', 'Murojaat ro‘yxatga olindi', date(-3 + i / 10)]);
    }
    for (const row of [['SSD 512 GB', 'dona', 8, 3, 'A-01'], ['DDR4 8 GB RAM', 'dona', 12, 4, 'A-02'], ['Canon 725 kartrij', 'dona', 2, 5, 'B-01'], ['UTP Cat6 kabel', 'metr', 180, 50, 'C-01'], ['HDMI adapter', 'dona', 3, 3, 'C-02']]) await tx.run('INSERT INTO stock (name, unit, quantity, minimum, location) VALUES (?, ?, ?, ?, ?)', row);
    for (const row of [[1, 'Kompyuterlarni profilaktik tozalash', 3, date(2).slice(0, 10), 90], [5, 'Switch portlarini diagnostika qilish', 4, date(-1).slice(0, 10), 30], [3, 'Printer kartrijini almashtirish', 3, date(1).slice(0, 10), 0], [7, 'UPS batareyasini tekshirish', 4, date(7).slice(0, 10), 180]]) await tx.run('INSERT INTO maintenance (device_id, title, assigned_to, planned_at, repeat_days, created_at) VALUES (?, ?, ?, ?, ?, ?)', [...row, now]);
    for (const row of [['Asosiy bino — LAN', '192.168.1.0/24', 10, '192.168.1.10', '02:26:AA:BB:CC:00', 'SW-01 / Gi1/0/3', 1, 'Uztelecom', 'Asosiy bino'], ['O‘quv binosi — Wi-Fi', '192.168.3.0/24', 30, '192.168.3.15', '02:26:AA:BB:CC:05', 'SW-02 / Gi1/0/8', 6, 'Ichki tarmoq', 'O‘quv binosi']]) await tx.run('INSERT INTO networks (name, subnet, vlan, ip, mac, port, device_id, provider, building) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', row);
    for (const row of [['Windows 11 Pro', 'Nukus filiali', 30, date(365).slice(0, 10)], ['Microsoft Office LTSC', 'Nukus filiali', 20, date(20).slice(0, 10)], ['ESET Endpoint Security', 'RTM', 50, date(90).slice(0, 10)]]) await tx.run('INSERT INTO licenses (name, owner, seats, expires_at) VALUES (?, ?, ?, ?)', row);
    await tx.run('INSERT INTO license_installs (license_id, device_id, installed_at) VALUES (1, 1, ?)', [now]);
    await tx.run('INSERT INTO documents (kind, title, device_id, created_by, created_at) VALUES (?, ?, ?, ?, ?)', ['inventory', 'AKT vositalari inventarizatsiyasi', 1, 8, now]);
    await tx.run('INSERT INTO notifications (user_id, title, entity_type, entity_id, created_at) VALUES (?, ?, ?, ?, ?)', [2, '2 ta murojaatning SLA muddati o‘tgan', 'tickets', 2, now]);
    await tx.run('INSERT INTO audit (user_id, action, entity, detail, ip, created_at) VALUES (?, ?, ?, ?, ?, ?)', [1, 'seed', 'system', 'Sun’iy test ma’lumotlari yaratildi', '127.0.0.1', now]);
  });
}
