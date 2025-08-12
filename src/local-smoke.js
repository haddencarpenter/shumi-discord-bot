import 'dotenv/config';
import { fetchUsdPrice } from './price.js';

console.log('🧪 Starting local smoke test...\n');

const testTickers = ['BTC', 'ETH', 'SOL', 'ORDI', 'WIF', 'PENGU'];

async function runSmokeTest() {
  console.log('Testing price fetching for popular tickers:\n');
  
  const results = [];
  
  for (const ticker of testTickers) {
    try {
      console.log(`📊 Fetching ${ticker}...`);
      const price = await fetchUsdPrice(ticker);
      
      if (price !== null && price !== undefined) {
        results.push({
          ticker,
          status: '✅',
          price: price
        });
        console.log(`   ✅ ${ticker}: $${price.toLocaleString()}`);
      } else {
        results.push({
          ticker,
          status: '❌',
          error: 'No price data'
        });
        console.log(`   ❌ ${ticker}: No price data`);
      }
    } catch (error) {
      results.push({
        ticker,
        status: '❌',
        error: error.message
      });
      console.log(`   ❌ ${ticker}: ${error.message}`);
    }
  }
  
  console.log('\n📋 Summary:');
  console.log('=' .repeat(50));
  
  const successful = results.filter(r => r.status === '✅').length;
  const failed = results.filter(r => r.status === '❌').length;
  
  console.log(`Total tested: ${testTickers.length}`);
  console.log(`Successful: ${successful}`);
  console.log(`Failed: ${failed}`);
  
  if (failed > 0) {
    console.log('\nFailed tickers:');
    results.filter(r => r.status === '❌').forEach(r => {
      console.log(`  - ${r.ticker}: ${r.error}`);
    });
  }
  
  console.log('\n✨ Smoke test complete!');
  process.exit(failed > 0 ? 1 : 0);
}

// Run with timeout
const timeout = setTimeout(() => {
  console.error('❌ Test timeout after 30 seconds');
  process.exit(1);
}, 30000);

runSmokeTest()
  .then(() => clearTimeout(timeout))
  .catch(error => {
    console.error('❌ Test failed:', error);
    clearTimeout(timeout);
    process.exit(1);
  });