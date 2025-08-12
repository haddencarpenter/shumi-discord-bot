// test-interactive.js - Interactive testing of the advanced resolver
import { fetchAdvancedPrice } from './src/price-advanced.js';
import { resolveQuery } from './src/resolver-advanced.js';

console.log('🚀 Interactive Advanced Resolver Test');
console.log('Try these example queries:');
console.log('  - btc');
console.log('  - btcusdt');
console.log('  - eth/usdc');
console.log('  - wormhole');
console.log('  - usdc (should be blocked)');
console.log('  - usdc stablecoin (should work)');
console.log('  - wrapped bitcoin (should be blocked)');
console.log('  - exit\n');

async function testQuery(query) {
  console.log(`\n🔍 Testing: "${query}"`);
  
  try {
    // First show what the resolver decides
    const resolution = await resolveQuery(query);
    console.log(`   Resolution:`, resolution);
    
    // Then get the actual price
    const result = await fetchAdvancedPrice(query);
    console.log(`   Result:`, {
      type: result.type,
      display: result.displayText,
      price: result.price
    });
    
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }
}

// Test specific queries
const testQueries = [
  'btc',
  'btcusdt', 
  'eth/usdc',
  'wormhole',
  'usdc',
  'crv',
  'matic',
  'w'
];

async function runTests() {
  console.log('Running automated tests...\n');
  
  for (const query of testQueries) {
    await testQuery(query);
    await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limit protection
  }
  
  console.log('\n✨ All tests completed!');
}

runTests();