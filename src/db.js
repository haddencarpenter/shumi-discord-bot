import pg from 'pg';
const { Pool } = pg;

/**
 * Use internal DB URL on Render (no SSL).
 * If DATABASE_EXTERNAL === 'true', we assume external URL and enable SSL with no verify.
 */
const external = process.env.DATABASE_EXTERNAL === 'true';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: external ? { rejectUnauthorized: false } : false
});

export const query = (text, params) => pool.query(text, params);

// TEMP sanity (remove after first successful deploy)
query('select 1').then(()=>console.log('DB OK')).catch(e=>console.error('DB FAIL', e));