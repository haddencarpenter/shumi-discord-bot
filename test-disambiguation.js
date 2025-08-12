import 'dotenv/config';
import { resolveCoinId } from './src/resolve.js';
import { fetchUsdPrice } from './src/price.js';

console.log('🔍 Testing Token Disambiguation System\n');

// Test cases that commonly cause disambiguation issues
const testCases = [
  // Single letters (should use CANONICAL mapping)
  { input: 'w', expected: 'wormhole', description: 'Single letter W → Wormhole' },
  { input: 'x', expected: 'x', description: 'Single letter X' },
  { input: 'z', expected: 'zcash', description: 'Single letter Z → Zcash' },
  
  // Ambiguous tokens
  { input: 'uni', expected: 'uniswap', description: 'UNI → Uniswap' },
  { input: 'link', expected: 'chainlink', description: 'LINK → Chainlink' },
  { input: 'pengu', expected: 'pudgy-penguins', description: 'PENGU → Pudgy Penguins' },
  
  // Common tickers
  { input: 'btc', expected: 'bitcoin', description: 'BTC → Bitcoin' },
  { input: 'eth', expected: 'ethereum', description: 'ETH → Ethereum' },
  { input: 'sol', expected: 'solana', description: 'SOL → Solana' },
  
  // Edge cases that might be problematic
  { input: 'usdt', expected: null, description: 'USDT (stablecoin, should return null or handle specially)' },
  { input: 'wrapped-bitcoin', expected: null, description: 'Wrapped Bitcoin (should be filtered out)' },
  { input: 'nonsense123', expected: null, description: 'Invalid ticker' },
  
  // Case sensitivity
  { input: 'BTC', expected: 'bitcoin', description: 'BTC uppercase' },
  { input: 'Eth', expected: 'ethereum', description: 'ETH mixed case' },
];

async function testDisambiguation() {
  console.log('Running disambiguation tests...\n');
  
  let passed = 0;
  let failed = 0;
  
  for (const testCase of testCases) {
    try {
      console.log(`Testing: "${testCase.input}" (${testCase.description})`);
      const result = await resolveCoinId(testCase.input);
      
      if (result === testCase.expected) {
        console.log(`   ✅ PASS: ${testCase.input} → ${result}`);
        passed++;
      } else {
        console.log(`   ❌ FAIL: ${testCase.input} → ${result} (expected: ${testCase.expected})`);
        failed++;
      }
    } catch (error) {
      console.log(`   💥 ERROR: ${testCase.input} → ${error.message}`);
      failed++;
    }
    console.log();
  }
  
  console.log(`\n📊 Disambiguation Test Results:`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`Total: ${testCases.length}`);
  
  return { passed, failed };
}

async function testPriceResolution() {
  console.log('\n🔍 Testing Price Resolution with Disambiguation...\n');
  
  const priceTests = ['w', 'pengu', 'btc', 'nonsense123'];
  
  for (const ticker of priceTests) {
    try {
      console.log(`Fetching price for: ${ticker}`);
      const price = await fetchUsdPrice(ticker);
      console.log(`   ✅ ${ticker}: $${price.toLocaleString()}`);
    } catch (error) {
      console.log(`   ❌ ${ticker}: ${error.message}`);
    }
  }
}

async function runAllTests() {
  const { passed, failed } = await testDisambiguation();
  await testPriceResolution();
  
  console.log('\n🎯 Test Summary:');
  console.log('================');
  if (failed === 0) {
    console.log('✅ All disambiguation tests passed!');
  } else {
    console.log(`⚠️  ${failed} tests failed. Check disambiguation logic.`);
  }
  
  process.exit(failed > 0 ? 1 : 0);
}

// Run with timeout
const timeout = setTimeout(() => {
  console.error('❌ Tests timeout after 30 seconds');
  process.exit(1);
}, 30000);

runAllTests()
  .then(() => clearTimeout(timeout))
  .catch(error => {
    console.error('❌ Test suite failed:', error);
    clearTimeout(timeout);
    process.exit(1);
  });