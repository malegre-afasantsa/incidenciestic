// Ús: MONGODB_URI=... node scripts/create-admin.js usuari "Nom visible" contrasenya
const { db } = require('../api/_lib/db');
const { hashPassword } = require('../api/_lib/auth');
(async () => {
  const [u, name, pw] = process.argv.slice(2);
  if (!u || !pw || pw.length < 8) { console.error('Ús: node scripts/create-admin.js usuari "Nom" contrasenya(≥8)'); process.exit(1); }
  const d = await db();
  await d.collection('users').replaceOne({ _id: u.toLowerCase() }, { _id: u.toLowerCase(), name: name || u, role: 'admin', hash: hashPassword(pw), created: new Date() }, { upsert: true });
  console.log('Administrador creat/actualitzat:', u.toLowerCase());
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
