#!/usr/bin/env node
/**
 * Add velodrome -> velodrome-finance ticker mapping
 * Run this script against the production database to fix the velodrome ticker
 */
import 'dotenv/config';
import { query } from '../src/db.js';

async function addVelodromeMapping() {
  console.log('Adding velodrome -> velodrome-finance mapping to database...\n');
  
  try {
    // Check if mapping already exists
    const existing = await query('SELECT * FROM ticker_mappings WHERE ticker = $1', ['velodrome']);
    
    if (existing.rows.length > 0) {
      console.log('✅ Velodrome mapping already exists:');
      console.log(`   Ticker: ${existing.rows[0].ticker}`);
      console.log(`   CoinGecko ID: ${existing.rows[0].coingecko_id}`);
      console.log(`   Confidence: ${existing.rows[0].confidence_score}`);
      console.log(`   Banned: ${existing.rows[0].is_banned}`);
      return;
    }
    
    // Add the mapping
    await query(`
      INSERT INTO ticker_mappings (ticker, coingecko_id, confidence_score, hit_count, is_banned, source, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
    `, ['velodrome', 'velodrome-finance', 95, 1, false, 'admin']);
    
    console.log('✅ Successfully added velodrome mapping:');
    console.log('   ticker: velodrome');
    console.log('   coingecko_id: velodrome-finance');
    console.log('   confidence_score: 95');
    console.log('   source: admin');
    
    // Also clear any failed resolution entries for velodrome
    const failedRows = await query('DELETE FROM failed_resolutions WHERE ticker = $1 RETURNING *', ['velodrome']);
    if (failedRows.rows.length > 0) {
      console.log(`✅ Cleared ${failedRows.rows.length} failed resolution entries for velodrome`);
    }
    
    console.log('\n🎉 Velodrome should now work with "shumi enter velodrome short"!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
  
  process.exit(0);
}

addVelodromeMapping();