// src/db.js
import pg from 'pg';

const { Pool } = pg;

// Redact password for a one-time boot log
function redact(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '<invalid DATABASE_URL>';
  }
}

const connStr = process.env.DATABASE_URL;
if (!connStr) {
  throw new Error('DATABASE_URL is not set');
}

// If you ever accidentally set an internal host, this log will show it
console.log('[DB] Using DATABASE_URL:', redact(connStr));

// For Render's EXTERNAL URL we include sslmode=require in the string,
// but node-postgres sometimes still needs ssl: { rejectUnauthorized: false }
// for managed PGs that present an intermediate CA. This is harmless even
// if the CA is trusted.
const pool = new Pool({
  connectionString: connStr,
  ssl: connStr.includes('render.com') ? { rejectUnauthorized: false } : undefined,
  max: 10, // keep modest pool
});

async function query(text, params) {
  return pool.query(text, params);
}

export { query, pool };