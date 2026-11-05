import { randomBytes, scryptSync, timingSafeEqual, createHash, createHmac } from 'node:crypto';

export const roles = ['superadmin', 'manager', 'technician', 'department_head', 'employee', 'inventory'];
export const roleLabels = { superadmin: 'Superadministrator', manager: 'Markaz rahbari', technician: 'IT mutaxassisi', department_head: 'Bo‘lim rahbari', employee: 'Xodim', inventory: 'Moddiy javobgar' };
export const token = () => randomBytes(32).toString('hex');
export const digest = value => createHash('sha256').update(value).digest('hex');
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password, encoded) {
  try {
    const [, salt, hash] = encoded.split(':');
    const actual = scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, 'hex');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch { return false; }
}
function base32(secret) {
  let bits = '';
  for (const char of secret.toUpperCase().replace(/=|\s/g, '')) {
    const index = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char);
    if (index < 0) throw new Error('TOTP siri noto‘g‘ri');
    bits += index.toString(2).padStart(5, '0');
  }
  return Buffer.from(bits.match(/.{8}/g).map(bit => parseInt(bit, 2)));
}
export function totp(secret, time = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 30000)));
  const hmac = createHmac('sha1', base32(secret)).update(counter).digest();
  const offset = hmac.at(-1) & 15;
  return ((hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
}
export function verifyTotp(secret, code) {
  return /^\d{6}$/.test(String(code)) && [-1, 0, 1].some(n => totp(secret, Date.now() + n * 30000) === code);
}
export const rolesOf = user => Array.isArray(user?.roles) ? roles.filter(role => user.roles.includes(role)) : roles.includes(user?.role) ? [user.role] : [];
export const hasRole = (user, role) => rolesOf(user).includes(role);
export const manager = user => hasRole(user, 'superadmin') || hasRole(user, 'manager');
// Only the two central management roles administer the shared device register.
export const inventoryManager = user => manager(user);
export function canSeeDevice(user, device) {
  return manager(user) || device.employee_id === user.id;
}
export function canSeeTicket(user, ticket) {
  return manager(user) || ticket.created_by === user.id ||
    (hasRole(user, 'technician') && ticket.assigned_to === user.id) ||
    (hasRole(user, 'department_head') && ticket.department_id === user.department_id);
}
export const transitions = {
  new: ['reviewing', 'rejected'], reviewing: ['assigned', 'waiting', 'rejected'],
  assigned: ['in_progress', 'waiting'], in_progress: ['completed', 'waiting'],
  waiting: ['assigned', 'in_progress', 'rejected'], completed: ['confirmed', 'reopened'],
  confirmed: ['closed'], closed: ['reopened'], rejected: ['reopened'], reopened: ['reviewing', 'assigned', 'in_progress']
};
export const slaHours = { critical: 4, high: 8, medium: 24, low: 72 };
export function cleanText(value, max = 500) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, max);
}
export function positiveId(value) { return Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null; }
