// test-pengu-debug.js - Debug the PENGU resolution issue
import 'dotenv/config';
import { resolveQuery, debugResolve } from './src/resolver-advanced.js';
import { fetchCoinData } from './src/price-enhanced-smart.js';

console.log('🐧 Debugging PENGU Resolution Issue');

async function testPenguResolution() {
  console.log('\n1. Testing resolver debug for "pengu":');
  try {
    const debug = await debugResolve('pengu');
    console.log(`   Debug result:`, JSON.stringify(debug, null, 2));
  } catch (error) {
    console.log(`   Debug error:`, error.message);
  }

  console.log('\n2. Testing actual price fetch:');
  try {
    const coinData = await fetchCoinData('pengu');
    console.log(`   Price: $${coinData.price.toFixed(8)}`);
    console.log(`   Market Cap: $${coinData.marketCap ? (coinData.marketCap / 1e6).toFixed(1) + 'M' : 'N/A'}`);
    console.log(`   Coin ID used: ${coinData.coinId}`);
  } catch (error) {
    console.log(`   Price fetch error:`, error.message);
  }

  console.log('\n3. Testing "pudgy":');
  try {
    const coinData = await fetchCoinData('pudgy');
    console.log(`   Price: $${coinData.price.toFixed(8)}`);
    console.log(`   Market Cap: $${coinData.marketCap ? (coinData.marketCap / 1e6).toFixed(1) + 'M' : 'N/A'}`);
    console.log(`   Coin ID used: ${coinData.coinId}`);
  } catch (error) {
    console.log(`   Price fetch error:`, error.message);
  }
}

testPenguResolution();