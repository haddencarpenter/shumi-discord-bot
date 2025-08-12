// test-pengu-simple.js - Simple PENGU test
import 'dotenv/config';
import { resolveQuery } from './src/resolver-advanced.js';
import { fetchCoinData } from './src/price-enhanced-smart.js';

console.log('🐧 Testing PENGU Resolution');

async function testPengu() {
  console.log('\n1. Testing "pengu" resolution:');
  try {
    const resolution = await resolveQuery('pengu');
    console.log(`   Resolver: ${resolution.type} → ${resolution.id}`);
  } catch (error) {
    console.log(`   Resolver error:`, error.message);
  }

  console.log('\n2. Testing "pengu" price fetch:');
  try {
    const coinData = await fetchCoinData('pengu');
    console.log(`   Price: $${coinData.price.toFixed(8)}`);
    console.log(`   Market Cap: $${coinData.marketCap ? (coinData.marketCap / 1e6).toFixed(1) + 'M' : 'N/A'}`);
    console.log(`   Coin ID: ${coinData.coinId}`);
  } catch (error) {
    console.log(`   Error:`, error.message);
  }

  console.log('\n3. Testing "pudgy-penguins" directly:');
  try {
    const resolution = await resolveQuery('pudgy-penguins');
    console.log(`   Resolver: ${resolution.type} → ${resolution.id}`);
    
    const coinData = await fetchCoinData('pudgy-penguins');
    console.log(`   Price: $${coinData.price.toFixed(8)}`);
    console.log(`   Market Cap: $${coinData.marketCap ? (coinData.marketCap / 1e6).toFixed(1) + 'M' : 'N/A'}`);
  } catch (error) {
    console.log(`   Error:`, error.message);
  }
}

testPengu();