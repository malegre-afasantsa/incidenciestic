const { MongoClient } = require('mongodb');
const g = global;
g._mongoCache = g._mongoCache || { promise: null, indexed: false };

async function db() {
  if (!process.env.MONGODB_URI) throw new Error('Falta la variable MONGODB_URI');
  const c = g._mongoCache;
  if (!c.promise) c.promise = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 5 }).connect();
  let client;
  try { client = await c.promise; } catch (e) { c.promise = null; throw e; }
  const d = client.db(process.env.MONGODB_DB || 'gestor_tic');
  if (!c.indexed) {
    c.indexed = true;
    d.collection('attempts').createIndex({ t: 1 }, { expireAfterSeconds: 3600 }).catch(() => {});
  }
  return d;
}

async function tooMany(d, key, limit, windowSec) {
  const since = new Date(Date.now() - windowSec * 1000);
  return (await d.collection('attempts').countDocuments({ k: key, t: { $gt: since } })) >= limit;
}
async function record(d, key) { await d.collection('attempts').insertOne({ k: key, t: new Date() }); }

module.exports = { db, tooMany, record };
