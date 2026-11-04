import { mkdir, readdir, copyFile, readFile } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const args = process.argv.slice(2), sourceArg = args[0], targetArg = args[args.indexOf('--target') + 1];
if (!sourceArg || !args.includes('--target') || !targetArg) throw new Error('Foydalanish: npm run restore -- BACKUP_PAPKA --target YANGI_BOSH_PAPKA');
const source = resolve(sourceArg), target = resolve(targetArg);
if (source === target || target.startsWith(source + sep) || source.startsWith(target + sep)) throw new Error('Zaxira va tiklash papkalari alohida bo‘lsin');
const manifest = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8'));
if (manifest.version !== 1 || !Array.isArray(manifest.files)) throw new Error('Zaxira formati noto‘g‘ri');
for (const file of manifest.files) {
  if (!/^(rtm\.sqlite|database\.dump|uploads\/[a-f0-9]{64})$/.test(file.path)) throw new Error('Zaxirada kutilmagan fayl yo‘li');
  const data = await readFile(join(source, file.path));
  if (data.length !== file.size || createHash('sha256').update(data).digest('hex') !== file.sha256) throw new Error(`Zaxira yaxlitligi buzilgan: ${file.path}`);
}
await mkdir(target, { recursive: true });
if ((await readdir(target)).length) throw new Error('Tiklash faqat yangi, bo‘sh papkaga ruxsat etiladi. Joriy ma’lumotlar ustiga yozilmaydi.');
if (manifest.database === 'sqlite') {
  if (!manifest.files.some(f => f.path === 'rtm.sqlite')) throw new Error('Zaxirada baza yo‘q');
  const check = new DatabaseSync(join(source, 'rtm.sqlite'), { readOnly: true });
  try {
    if (check.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' || check.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Baza yaxlitlik tekshiruvidan o‘tmadi');
  } finally { check.close(); }
} else if (manifest.database === 'postgres') {
  if (!process.env.DATABASE_URL || !manifest.files.some(f=>f.path==='database.dump')) throw new Error('Yangi bo‘sh PostgreSQL bazasi uchun DATABASE_URL kerak');
  const { default: pg } = await import('pg'); const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try { const result = await client.query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"); if (Number(result.rows[0].n)) throw new Error('PostgreSQL bazasi bo‘sh bo‘lishi kerak'); } finally { await client.end(); }
  const url = new URL(process.env.DATABASE_URL);
  await promisify(execFile)('pg_restore', ['--exit-on-error', '--no-owner', '--dbname', url.pathname.slice(1), join(source,'database.dump')], { windowsHide: true, env: { ...process.env, PGHOST:url.hostname, PGPORT:url.port||'5432', PGUSER:decodeURIComponent(url.username), PGPASSWORD:decodeURIComponent(url.password), PGSSLMODE:url.searchParams.get('sslmode')||'prefer' } });
} else throw new Error('Baza turi qo‘llanmaydi');
await mkdir(join(target, 'uploads'));
for (const file of manifest.files) if (file.path !== 'database.dump') await copyFile(join(source,file.path),join(target,file.path));
if (manifest.database === 'sqlite') { const restored = new DatabaseSync(join(target,'rtm.sqlite')); restored.exec('DELETE FROM sessions'); restored.close(); }
else { const {default:pg}=await import('pg');const client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();await client.query('DELETE FROM sessions');await client.end(); }
console.log(`Zaxira tekshirildi va tiklandi: ${target}\nServerni to‘xtatib, DATA_DIR ni shu papkaga yo‘naltiring. Eski sessiyalar bekor qilindi.`);
