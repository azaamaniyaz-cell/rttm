import { mkdir, readdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dataDir, isPostgres, backupSqlite, closeDb } from '../server/db.js';

const destination = resolve(process.argv[2] || join('backups', new Date().toISOString().replace(/[:.]/g, '-')));
await mkdir(destination, { recursive: true });
if ((await readdir(destination)).length) throw new Error('Zaxira uchun bo‘sh papka tanlang');
const files = [];
async function record(path) { const data = await readFile(path); files.push({ path: relative(destination, path).replaceAll('\\', '/'), size: data.length, sha256: createHash('sha256').update(data).digest('hex') }); }
function postgresEnv() {
  const url = new URL(process.env.DATABASE_URL);
  return { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: url.pathname.slice(1), PGSSLMODE: url.searchParams.get('sslmode') || 'prefer' };
}
try {
  if (isPostgres) { const path = join(destination, 'database.dump'); await promisify(execFile)('pg_dump', ['--format=custom', '--file', path], { env: postgresEnv(), windowsHide: true }); await record(path); }
  else { const path = join(destination, 'rtm.sqlite'); await backupSqlite(path); await record(path); }
  const uploads = join(dataDir, 'uploads');
  await mkdir(join(destination, 'uploads'));
  for (const file of await readdir(uploads).catch(() => [])) {
    if (!/^[a-f0-9]{64}$/.test(file)) continue;
    const path = join(destination, 'uploads', file); await copyFile(join(uploads, file), path); await record(path);
  }
  await writeFile(join(destination, 'manifest.json'), JSON.stringify({ version: 1, created_at: new Date().toISOString(), database: isPostgres ? 'postgres' : 'sqlite', files }, null, 2));
  console.log(`Zaxira yaratildi: ${destination}\n${files.length} ta fayl; SHA-256 tekshiruvlari manifest.json da.`);
} finally { await closeDb(); }
