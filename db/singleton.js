// Single instance guard using PostgreSQL advisory locks
import { query } from '../src/db.js';

const LOCK_ID = 884422113355n; // Unique lock ID for this bot

export async function assertSingleInstance() {
  try {
    const { rows } = await query('SELECT pg_try_advisory_lock($1::bigint) AS ok', [LOCK_ID]);
    
    if (!rows[0].ok) {
      console.error('❌ Another bot instance is active (advisory lock held). Exiting.');
      console.error('   This prevents multiple Discord bots from running simultaneously.');
      console.error('   If this is unexpected, check for zombie processes or restart the database.');
      process.exit(1);
    }
    
    console.log('🔒 Advisory lock acquired - single instance confirmed');
    
    // Release lock on graceful shutdown
    process.on('SIGTERM', releaseLock);
    process.on('SIGINT', releaseLock);
    
  } catch (error) {
    console.error('❌ Failed to acquire advisory lock:', error.message);
    console.error('   Database connection may be unavailable');
    process.exit(1);
  }
}

async function releaseLock() {
  try {
    await query('SELECT pg_advisory_unlock($1::bigint)', [LOCK_ID]);
    console.log('🔓 Advisory lock released');
  } catch (error) {
    console.warn('⚠️ Failed to release advisory lock:', error.message);
  }
}