import pg from 'pg';

const { Pool } = pg;

// Use internal URL with SSL disabled for Render same-region deployment
// Set DATABASE_EXTERNAL=true if using external URL from outside Render
const useExternal = process.env.DATABASE_EXTERNAL === 'true';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useExternal
    ? { rejectUnauthorized: false } // external URL over internet
    : false,                        // internal URL inside Render
  max: 5
});

export const query = (text, params) => pool.query(text, params);

// For debugging connection info
console.log(`[DB] Using ${useExternal ? 'external' : 'internal'} database connection`);