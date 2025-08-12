// test-pro-api.js - Test Pro API with rate limiting
import dotenv from 'dotenv';
dotenv.config();

import { fetchAdvancedPrice } from './src/price-advanced.js';
import { resolveQuery } from './src/resolver-advanced.js';

console.log('🚀 CoinGecko Pro API Test');
console.log('API Key:', process.env.COINGECKO_API_KEY ? 'Set ✅' : 'Not set ❌');
console.log();

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testWithDelay(query, delay = 2000) {
  console.log(`🔍 Testing: "${query}"`);
  
  try {
    const result = await fetchAdvancedPrice(query);
    console.log(`   ✅ Success: ${result.displayText}`);
    console.log(`   Type: ${result.type}${result.baseId ? ` (base: ${result.baseId})` : ''}`);
    
    if (result.marketCap) {
      const mcap = result.marketCap > 1e9 ? 
        `$${(result.marketCap / 1e9).toFixed(2)}B` : 
        `$${(result.marketCap / 1e6).toFixed(2)}M`;
      console.log(`   Market Cap: ${mcap}`);
    }
    
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }
  
  console.log();
  if (delay > 0) {
    await sleep(delay);
  }
}

async function runTests() {
  // Test canonical mappings (no API calls needed for resolution)
  await testWithDelay('btc');
  await testWithDelay('eth');
  
  // Test pair detection
  await testWithDelay('btcusdt');
  await testWithDelay('eth/usdc');
  
  // Test protocol tokens
  await testWithDelay('w'); // Wormhole - should use canonical mapping
  
  // Test one search-based query (will hit API)
  await testWithDelay('matic');
  
  console.log('🎯 Testing stablecoin guard...');
  await testWithDelay('crv'); // Should get curve, not crvusd
  
  console.log('✨ Pro API tests completed!');
}

runTests();