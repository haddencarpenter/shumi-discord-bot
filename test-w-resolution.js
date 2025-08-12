// test-w-resolution.js - Debug the W resolution issue
import 'dotenv/config';
import { resolveQuery } from './src/resolver-advanced.js';
import { fetchCoinData } from './src/price-enhanced-smart.js';

console.log('🔍 Testing W Resolution Issue');

async function testWResolution() {
  console.log('\n1. Testing resolver directly:');
  try {
    const resolution = await resolveQuery('w');
    console.log(`   Resolver result:`, resolution);
  } catch (error) {
    console.log(`   Resolver error:`, error.message);
  }

  console.log('\n2. Testing fetchCoinData (what Discord uses):');
  try {
    const coinData = await fetchCoinData('w');
    console.log(`   Price: $${coinData.price.toFixed(8)}`);
    console.log(`   Market Cap: $${(coinData.marketCap / 1e6).toFixed(0)}M`);
    console.log(`   Coin ID used: ${coinData.coinId}`);
  } catch (error) {
    console.log(`   fetchCoinData error:`, error.message);
  }

  console.log('\n3. Testing again (cache test):');
  try {
    const coinData2 = await fetchCoinData('w');
    console.log(`   Second fetch price: $${coinData2.price.toFixed(8)}`);
    console.log(`   Same coin ID: ${coinData2.coinId}`);
  } catch (error) {
    console.log(`   Second fetch error:`, error.message);
  }
}

testWResolution();