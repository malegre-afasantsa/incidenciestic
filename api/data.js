const { db, tooMany, record } = require('./_lib/db');
const A = require('./_lib/auth');

const KEYS = { carts: 'id', devices: 'code', incidents: 'id' };
const ID = /^[A-Za-z0-9._-]{1,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const strip = ({ _id, ...r }) => r;
const fail = (code, msg) => Object.assign(new Error(msg), { code });

function cleanIncident(x) {
  const o = {
    id: str(x.id, 64), code: str(x.code, 80), desc: str(x.desc, 1200), motiu: str(x.motiu, 120),
    prio: ['alta', 'mitjana', 'baixa'].includes(x.prio) ? x.prio : 'mitjana', st: 'oberta',
    date: DATE.test(x.date) ? x.date : new Date().toISOString().slice(0, 10),
    who: str(x.who, 80), room: str(x.room, 80), cm: [],
  };
  if (['mail', 'aula', 'nodev'].includes(x.kind)) o.kind = x.kind;
  if (x.tagTxt) o.tagTxt = str(x.tagTxt, 60);
  if (['presencial', 'remot', 'compte'].includes(x.circuit)) o.circuit = x.circuit;
  if (x.visit && DATE.test(x.visit.d) && Number.isFinite(x.visit.m)) o.visit = { d: x.visit.d, m: Math.max(0, Math.min(1440, x.visit.m | 0)), room: str(x.visit.room, 80) };
  if (Array.isArray(x.det)) o.det = x.det.slice(0, 30).map((p) => [str(p && p[0], 60), str(p && p[1], 300)]);
  if (x.mail && typeof x.mail === 'object') o.mail = { nom: str(x.mail.nom, 60), cog: str(x.mail.cog, 80), email: str(x.mail.email, 120), pass: '' };
  if (Array.isArray(x.cm)) o.cm = x.cm.slice(0, 20).map((c) => cleanComment(c, true));
  return o;
}
function cleanComment(c, allowSys) {
  return { who: str(c && c.who, 60) || 'Docent', text: str(c && c.text, 400), ts: Number.isFinite(c && c.ts) ? c.ts : Date.now(), sys: allowSys ? !!(c && c.sys) : false };
}

module.exports = async (req, res) => {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Mètode no permès' });
  try {
    const d = await db();
    const me = await A.session(req, d);
    if (req.method === 'GET') {
      const [carts, devices, incidents, cfg] = await Promise.all([
        d.collection('carts').find({}).toArray(),
        d.collection('devices').find({}).toArray(),
        d.collection('incidents').find({}).limit(5000).toArray(),
        d.collection('config').findOne({ _id: 'main' }),
      ]);
      const inc = incidents.map((i) => { const r = strip(i); if (!me) delete r.mail; return r; });
      return res.status(200).json({ carts: carts.map(strip), devices: devices.map(strip), incidents: inc, config: cfg ? { logo: cfg.logo || '', theme: cfg.theme || null } : {}, me });
    }
    if (!A.sameOrigin(req)) return res.status(403).json({ error: 'Origen no permès' });
    const ops = Array.isArray(req.body && req.body.ops) ? req.body.ops.slice(0, 200) : [];
    let rejected = 0;
    for (const op of ops) {
      const col = op && op.col;
      if (me) {
        if (col === 'config' && op.op === 'set') {
          const doc = op.doc || {};
          if (doc.logo && !(String(doc.logo).startsWith('data:image/') && doc.logo.length < 700000)) { rejected++; continue; }
          await d.collection('config').replaceOne({ _id: 'main' }, { _id: 'main', logo: doc.logo || '', theme: doc.theme && typeof doc.theme.h1 === 'number' ? { h1: doc.theme.h1, h2: typeof doc.theme.h2 === 'number' ? doc.theme.h2 : null } : null }, { upsert: true });
        } else if (KEYS[col]) {
          const id = op.op === 'delete' ? op.id : op.doc && op.doc[KEYS[col]];
          if (!ID.test(String(id))) { rejected++; continue; }
          if (op.op === 'delete') await d.collection(col).deleteOne({ _id: id });
          else if (op.op === 'upsert' && JSON.stringify(op.doc).length < 150000) await d.collection(col).replaceOne({ _id: id }, { ...op.doc, _id: id }, { upsert: true });
          else rejected++;
        } else rejected++;
        continue;
      }
      if (col !== 'incidents' || op.op !== 'upsert' || !op.doc || !ID.test(String(op.doc.id))) { rejected++; continue; }
      const ex = await d.collection('incidents').findOne({ _id: op.doc.id });
      if (!ex) {
        const key = 'inc:' + A.ip(req);
        if (await tooMany(d, key, 30, 900)) throw fail(429, 'Massa avisos seguits.');
        await record(d, key);
        const doc = cleanIncident(op.doc);
        if (!doc.desc || !doc.code) { rejected++; continue; }
        await d.collection('incidents').insertOne({ ...doc, _id: doc.id });
      } else {
        const have = (ex.cm || []).length;
        const add = Array.isArray(op.doc.cm) ? op.doc.cm.slice(have, have + 5).filter((c) => c && !c.sys && str(c.text, 400)).map((c) => cleanComment(c, false)) : [];
        if (add.length && have < 200) await d.collection('incidents').updateOne({ _id: ex._id }, { $push: { cm: { $each: add } } });
      }
    }
    return res.status(200).json({ ok: true, rejected });
  } catch (e) {
    if (!e.code) console.error(e);
    return res.status(e.code || 500).json({ error: e.code ? e.message : 'Error del servidor. Revisa la configuració (MONGODB_URI).' });
  }
};
