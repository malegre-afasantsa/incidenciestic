const { db, tooMany, record } = require('./_lib/db');
const A = require('./_lib/auth');

const send = (res, code, obj) => res.status(code).json(obj);
const fail = (code, msg) => Object.assign(new Error(msg), { code });
const USER = /^[a-z0-9._-]{3,32}$/;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'Mètode no permès' });
  if (!A.sameOrigin(req)) return send(res, 403, { error: 'Origen no permès' });
  try {
    const d = await db(), b = req.body || {}, users = d.collection('users');
    const me = await A.session(req, d);
    switch (b.action) {
      case 'me':
        return send(res, 200, { me });
      case 'login': {
        const key = 'login:' + A.ip(req);
        if (await tooMany(d, key, 8, 900)) throw fail(429, 'Massa intents. Torna-ho a provar d’aquí uns minuts.');
        if (!(await users.countDocuments({}))) {
          const username = String(process.env.ADMIN_USER || 'tic').toLowerCase();
          const password = String(process.env.ADMIN_PASSWORD || '1234');
          await users.updateOne({ _id: username }, { $setOnInsert: { _id: username, name: process.env.ADMIN_USER ? 'Administrador' : 'TIC', role: 'admin', hash: A.hashPassword(password), created: new Date() } }, { upsert: true });
        }
        const u = await users.findOne({ _id: String(b.username || '').trim().toLowerCase() });
        if (!u || !A.verifyPassword(String(b.password || ''), u.hash)) {
          await record(d, key);
          throw fail(401, 'Usuari o contrasenya incorrectes.');
        }
        res.setHeader('Set-Cookie', A.cookie(req, A.sign(u), 8 * 3600));
        return send(res, 200, { me: { username: u._id, name: u.name || u._id, role: u.role } });
      }
      case 'logout':
        res.setHeader('Set-Cookie', A.cookie(req, '', 0));
        return send(res, 200, { ok: true });
      case 'list':
        if (!me || me.role !== 'admin') throw fail(403, 'Només els administradors.');
        return send(res, 200, { users: (await users.find({}).sort({ _id: 1 }).toArray()).map((u) => ({ username: u._id, name: u.name, role: u.role })) });
      case 'create': {
        if (!me || me.role !== 'admin') throw fail(403, 'Només els administradors.');
        const username = String(b.username || '').trim().toLowerCase(), pw = String(b.password || '');
        if (!USER.test(username)) throw fail(400, 'Usuari: 3–32 caràcters (lletres minúscules, números, . _ -).');
        if (pw.length < 8) throw fail(400, 'La contrasenya ha de tenir almenys 8 caràcters.');
        if (await users.findOne({ _id: username })) throw fail(409, 'Aquest usuari ja existeix.');
        await users.insertOne({ _id: username, name: String(b.name || '').trim().slice(0, 60) || username, role: b.role === 'admin' ? 'admin' : 'tic', hash: A.hashPassword(pw), created: new Date() });
        return send(res, 200, { ok: true });
      }
      case 'delete': {
        if (!me || me.role !== 'admin') throw fail(403, 'Només els administradors.');
        const username = String(b.username || '').toLowerCase();
        if (username === me.username) throw fail(400, 'No pots eliminar el teu propi compte.');
        const u = await users.findOne({ _id: username });
        if (!u) throw fail(404, 'No existeix.');
        if (u.role === 'admin' && (await users.countDocuments({ role: 'admin' })) <= 1) throw fail(400, 'Ha de quedar almenys un administrador.');
        await users.deleteOne({ _id: username });
        return send(res, 200, { ok: true });
      }
      case 'password': {
        if (!me) throw fail(401, 'Cal iniciar sessió.');
        const pw = String(b.password || '');
        if (pw.length < 8) throw fail(400, 'La contrasenya ha de tenir almenys 8 caràcters.');
        const target = String(b.username || me.username).toLowerCase();
        if (target === me.username) {
          const u = await users.findOne({ _id: me.username });
          if (!A.verifyPassword(String(b.current || ''), u.hash)) throw fail(403, 'La contrasenya actual no és correcta.');
          const hash = A.hashPassword(pw);
          await users.updateOne({ _id: u._id }, { $set: { hash } });
          res.setHeader('Set-Cookie', A.cookie(req, A.sign({ ...u, hash }), 8 * 3600));
        } else {
          if (me.role !== 'admin') throw fail(403, 'Només els administradors.');
          const r = await users.updateOne({ _id: target }, { $set: { hash: A.hashPassword(pw) } });
          if (!r.matchedCount) throw fail(404, 'No existeix.');
        }
        return send(res, 200, { ok: true });
      }
      default:
        throw fail(400, 'Acció desconeguda');
    }
  } catch (e) {
    if (!e.code) console.error(e);
    return send(res, e.code || 500, { error: e.code ? e.message : 'Error del servidor. Revisa la configuració (MONGODB_URI, AUTH_SECRET).' });
  }
};
