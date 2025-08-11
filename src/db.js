// src/db.js
import pg from 'pg';
const { Pool } = pg;

const internalUrl = process.env.DATABASE_URL_INTERNAL;
const externalUrl = process.env.DATABASE_URL_EXTERNAL;
const preferInternal = (process.env.DB_PREFERRED || 'internal') === 'internal';

function makePool(url, ssl) {
  return new Pool({ connectionString: url, ssl });
}

async function tryPool(url, ssl) {
  const pool = makePool(url, ssl);
  await pool.query('select 1'); // sanity
  return pool;
}

async function connectDb() {
  const attempts = [];

  const tryInternal = async () => {
    if (!internalUrl) return null;
    try {
      const p = await tryPool(internalUrl, false); // internal = no SSL
      console.log('DB connected (internal)');
      return p;
    } catch (e) {
      // ENOTFOUND when .internal isn't resolvable; allow fallback
      if (['ENOTFOUND', 'ECONNREFUSED', 'DEPTH_ZERO_SELF_SIGNED_CERT'].includes(e.code || '')) {
        attempts.push(e);
        return null;
      }
      throw e;
    }
  };

  const tryExternal = async () => {
    if (!externalUrl) return null;
    try {
      const p = await tryPool(externalUrl, { rejectUnauthorized: false }); // external over SSL
      console.log('DB connected (external)');
      return p;
    } catch (e) {
      attempts.push(e);
      return null;
    }
  };

  let pool = null;
  if (preferInternal) pool = await tryInternal() || await tryExternal();
  else pool = await tryExternal() || await tryInternal();

  if (!pool) throw attempts[attempts.length - 1] || new Error('DB connect failed');
  return pool;
}

export const pool = await connectDb();
export const query = (text, params) => pool.query(text, params);