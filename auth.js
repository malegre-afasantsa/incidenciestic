const crypto = require('crypto');

const secret = () => {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error('Falta AUTH_SECRET (mínim 16 caràcters)');
  return s;
};
const b64 = (s) => Buffer.from(s).toString('base64url');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${h.toString('base64')}`;
}
function verifyPassword(pw, stored) {
  try {
    const [, s, h] = String(stored).split('$');
    const hh = crypto.scryptSync(pw, Buffer.from(s, 'base64'), 64);
    return crypto.timingSafeEqual(hh, Buffer.from(h, 'base64'));
  } catch (e) { return false; }
}
// Versió de la contrasenya: si es canvia, les sessions antigues deixen de ser vàlides
const pv = (u) => crypto.createHash('sha256').update(u.hash).digest('hex').slice(0, 12);

function sign(u) {
  const p = b64(JSON.stringify({ u: u._id, pv: pv(u), exp: Date.now() + 8 * 3600 * 1000 }));
  return p + '.' + crypto.createHmac('sha256', secret()).update(p).digest('base64url');
}
function parseCookies(req) {
  const o = {};
  String(req.headers.cookie || '').split(';').forEach((c) => {
    const i = c.indexOf('=');
    if (i > 0) o[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return o;
}
async function session(req, d) {
  const t = parseCookies(req).tic_session;
  if (!t) return null;
  const [p, sig] = t.split('.');
  if (!p || !sig) return null;
  const ex = crypto.createHmac('sha256', secret()).update(p).digest('base64url');
  if (sig.length !== ex.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(ex))) return null;
  let x;
  try { x = JSON.parse(Buffer.from(p, 'base64url').toString()); } catch (e) { return null; }
  if (!x.exp || x.exp < Date.now()) return null;
  const u = await d.collection('users').findOne({ _id: x.u });
  if (!u || pv(u) !== x.pv) return null;
  return { username: u._id, name: u.name || u._id, role: u.role };
}
function cookie(req, val, maxAge) {
  const local = /^(localhost|127\.)/.test(req.headers.host || '');
  return `tic_session=${val}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${local ? '' : '; Secure'}`;
}
const sameOrigin = (req) => {
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === req.headers.host; } catch (e) { return false; }
};
const ip = (req) => (String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x');

module.exports = { hashPassword, verifyPassword, sign, session, cookie, sameOrigin, ip };
