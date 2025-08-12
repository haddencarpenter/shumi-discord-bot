import 'dotenv/config';
import { fetchUsdPrice } from './src/price.js';
import { resolveCoinId } from './src/resolve.js';

console.log('🧪 Comprehensive Local Testing Suite');
console.log('====================================\n');

// Test different categories of inputs
const testSuites = {
  'Major Cryptocurrencies': [
    'btc', 'eth', 'sol', 'bnb', 'ada', 'xrp', 'doge', 'avax', 'dot', 'link'
  ],
  'Single Letter Tickers': [
    'w', 'x', 'z', 'a', 'b', 'c', 'd', 'e', 'f', 'g'
  ],
  'Meme Coins': [
    'pepe', 'shib', 'doge', 'floki', 'wif', 'bonk', 'mog'
  ],
  'DeFi Tokens': [
    'uni', 'aave', 'comp', 'mkr', 'crv', 'sushi', 'ldo'
  ],
  'Recent/Trending': [
    'pengu', 'ordi', 'sei', 'tia', 'jup', 'pyth'
  ],
  'Stablecoins': [
    'usdt', 'usdc', 'dai', 'tusd', 'frax'
  ],
  'Edge Cases': [
    'wrapped-bitcoin', 'weth', 'nonsense123', 'btc-usd', 'ethereum-classic'
  ]
};

async function testSuite(suiteName, tickers) {
  console.log(`\n📊 Testing: ${suiteName}`);
  console.log('='.repeat(50));
  
  const results = {
    successful: 0,
    failed: 0,
    errors: []
  };
  
  for (const ticker of tickers) {
    try {
      // First test resolution
      const coinId = await resolveCoinId(ticker);
      
      if (coinId) {
        // Then test price fetching
        const price = await fetchUsdPrice(ticker);
        console.log(`✅ ${ticker.padEnd(12)} → ${coinId.padEnd(20)} → $${price.toLocaleString()}`);
        results.successful++;
      } else {
        console.log(`⚠️  ${ticker.padEnd(12)} → No resolution found`);
        results.failed++;
        results.errors.push(`${ticker}: No resolution`);
      }
    } catch (error) {
      console.log(`❌ ${ticker.padEnd(12)} → ERROR: ${error.message}`);
      results.failed++;
      results.errors.push(`${ticker}: ${error.message}`);
    }
  }
  
  console.log(`\nResults: ${results.successful}✅ ${results.failed}❌`);
  return results;
}

async function testPerformance() {
  console.log('\n⚡ Performance Testing');
  console.log('='.repeat(50));
  
  const testTickers = ['btc', 'eth', 'sol', 'link', 'uni'];
  
  // Sequential test
  console.log('Testing sequential fetches...');
  const startSeq = Date.now();
  for (const ticker of testTickers) {
    await fetchUsdPrice(ticker);
  }
  const seqTime = Date.now() - startSeq;
  console.log(`Sequential: ${seqTime}ms (${(seqTime/testTickers.length).toFixed(0)}ms avg)`);
  
  // Parallel test
  console.log('Testing parallel fetches...');
  const startPar = Date.now();
  await Promise.all(testTickers.map(ticker => fetchUsdPrice(ticker)));
  const parTime = Date.now() - startPar;
  console.log(`Parallel: ${parTime}ms (${(parTime/testTickers.length).toFixed(0)}ms avg)`);
  
  console.log(`Speedup: ${(seqTime/parTime).toFixed(1)}x faster`);
}

async function testErrorHandling() {
  console.log('\n🚨 Error Handling Tests');
  console.log('='.repeat(50));
  
  const errorCases = [
    { input: '', description: 'Empty string' },
    { input: '   ', description: 'Whitespace only' },
    { input: 'this-does-not-exist-123456', description: 'Non-existent ticker' },
    { input: '!@#$%', description: 'Special characters' },
    { input: 'a'.repeat(100), description: 'Very long input' },
  ];
  
  for (const testCase of errorCases) {
    try {
      const result = await fetchUsdPrice(testCase.input);
      console.log(`⚠️  ${testCase.description}: Unexpectedly succeeded → $${result}`);
    } catch (error) {
      console.log(`✅ ${testCase.description}: Properly failed → ${error.message}`);
    }
  }
}

async function runComprehensiveTest() {
  const allResults = {
    totalSuccessful: 0,
    totalFailed: 0,
    allErrors: []
  };
  
  // Run all test suites
  for (const [suiteName, tickers] of Object.entries(testSuites)) {
    const results = await testSuite(suiteName, tickers);
    allResults.totalSuccessful += results.successful;
    allResults.totalFailed += results.failed;
    allResults.allErrors.push(...results.errors);
  }
  
  // Performance testing
  await testPerformance();
  
  // Error handling
  await testErrorHandling();
  
  // Final summary
  console.log('\n🎯 Final Test Summary');
  console.log('='.repeat(50));
  console.log(`Total Tests: ${allResults.totalSuccessful + allResults.totalFailed}`);
  console.log(`Successful: ${allResults.totalSuccessful} ✅`);
  console.log(`Failed: ${allResults.totalFailed} ❌`);
  console.log(`Success Rate: ${((allResults.totalSuccessful / (allResults.totalSuccessful + allResults.totalFailed)) * 100).toFixed(1)}%`);
  
  if (allResults.allErrors.length > 0) {
    console.log('\n📋 Failed Cases:');
    allResults.allErrors.forEach(error => console.log(`  - ${error}`));
  }
  
  console.log('\n✨ Local testing complete!');
  
  // Exit with appropriate code
  process.exit(allResults.totalFailed > 0 ? 1 : 0);
}

// Run with timeout
const timeout = setTimeout(() => {
  console.error('❌ Test suite timeout after 2 minutes');
  process.exit(1);
}, 120000);

runComprehensiveTest()
  .then(() => clearTimeout(timeout))
  .catch(error => {
    console.error('❌ Test suite crashed:', error);
    clearTimeout(timeout);
    process.exit(1);
  });