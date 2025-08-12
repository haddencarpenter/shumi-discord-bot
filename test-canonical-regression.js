#!/usr/bin/env node
// test-canonical-regression.js - Ensure critical tickers never drift from canonical mapping

import assert from 'node:assert/strict';
import { resolveCoinId } from './src/resolve.js';

// Critical tickers that MUST resolve to exact coinId via canonical mapping
const mustBeCanonical = { 
  sd: 'stader',     // The core fix - SD must never drift back to USDS
  btc: 'bitcoin', 
  eth: 'ethereum',
  sol: 'solana',
  doge: 'dogecoin',
  uni: 'uniswap',
  link: 'chainlink',
  matic: 'polygon-ecosystem-token'
};

console.log('🔍 Running canonical regression tests...');

for (const [query, expectedCoinId] of Object.entries(mustBeCanonical)) {
  try {
    const resolvedId = await resolveCoinId(query);
    
    // Strict assertion: must resolve to exact expected coinId
    assert.equal(
      resolvedId, 
      expectedCoinId, 
      `REGRESSION: ${query} resolved to "${resolvedId}" instead of "${expectedCoinId}"`
    );
    
    console.log(`✅ ${query} → ${resolvedId}`);
  } catch (error) {
    console.error(`❌ FAILED: ${query} - ${error.message}`);
    process.exit(1);
  }
}

console.log('✅ All canonical regression tests passed');