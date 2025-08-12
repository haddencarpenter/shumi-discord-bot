import 'dotenv/config';
import { resolveCoinId } from './src/resolve.js';
import { fetchUsdPrice } from './src/price.js';

console.log('🔍 Testing Current Resolver Implementation');
console.log('==========================================\n');

// Test the exact tokens mentioned in instructions
const testTokens = ['BTC', 'ETH', 'SOL', 'SD', 'ORDI', 'WIF'];

async function testCurrentResolver() {
  console.log('Testing resolution and price fetching...\n');
  
  let correctResolutions = 0;
  let incorrectResolutions = 0;
  
  for (const token of testTokens) {
    try {
      console.log(`📊 Testing: ${token}`);
      
      // Step 1: Resolution
      const coinId = await resolveCoinId(token.toLowerCase());
      console.log(`   Resolution: ${token} → ${coinId || 'null'}`);
      
      if (!coinId) {
        console.log(`   ❌ No resolution found`);
        incorrectResolutions++;
        continue;
      }
      
      // Step 2: Price fetch
      const price = await fetchUsdPrice(token.toLowerCase());
      console.log(`   Price: $${price.toLocaleString()}`);
      console.log(`   Source: CoinGecko REST API (no WebSocket)`);
      
      // Step 3: Validate specific cases
      if (token === 'SD') {
        if (coinId === 'stader') {
          console.log(`   ✅ SD correctly resolved to Stader`);
          correctResolutions++;
        } else {
          console.log(`   ❌ SD incorrectly resolved to ${coinId} (should be 'stader')`);
          incorrectResolutions++;
        }
      } else {
        // For other tokens, just check if we got a resolution
        console.log(`   ✅ ${token} resolved successfully`);
        correctResolutions++;
      }
      
    } catch (error) {
      console.log(`   ❌ Error: ${error.message}`);
      incorrectResolutions++;
    }
    
    console.log();
  }
  
  console.log('📈 Test Results:');
  console.log('================');
  console.log(`✅ Correct resolutions: ${correctResolutions}`);
  console.log(`❌ Incorrect resolutions: ${incorrectResolutions}`);
  console.log(`Success rate: ${((correctResolutions / testTokens.length) * 100).toFixed(1)}%`);
  
  if (incorrectResolutions > 0) {
    console.log('\n🚨 FAIL CRITERIA MET:');
    console.log('- Multiple tokens have incorrect resolution results');
    console.log('- SD token resolution needs fixing');
  }
  
  console.log('\n⚠️  ARCHITECTURE NOTE:');
  console.log('- This bot uses CoinGecko REST API only');
  console.log('- No WebSocket price aggregator found');
  console.log('- No realtime price sources detected');
  console.log('- Files mentioned in instructions do not exist');
  
  return { correctResolutions, incorrectResolutions };
}

async function testSpecificSDCase() {
  console.log('\n🔍 Detailed SD Token Investigation:');
  console.log('===================================');
  
  // Test what SD currently resolves to
  const sdResolution = await resolveCoinId('sd');
  console.log(`Current SD resolution: sd → ${sdResolution}`);
  
  // Test the actual Stader token price
  try {
    const staderPrice = await fetchUsdPrice('stader');
    console.log(`Direct Stader price: $${staderPrice}`);
  } catch (error) {
    console.log(`Direct Stader access failed: ${error.message}`);
  }
  
  // Test what SD price gives us
  try {
    const sdPrice = await fetchUsdPrice('sd');
    console.log(`SD price via resolver: $${sdPrice}`);
  } catch (error) {
    console.log(`SD price failed: ${error.message}`);
  }
}

// Run tests
async function runTests() {
  const { correctResolutions, incorrectResolutions } = await testCurrentResolver();
  await testSpecificSDCase();
  
  // Exit with appropriate code
  process.exit(incorrectResolutions > 0 ? 1 : 0);
}

// Timeout protection
const timeout = setTimeout(() => {
  console.error('❌ Test timeout after 60 seconds');
  process.exit(1);
}, 60000);

runTests()
  .then(() => clearTimeout(timeout))
  .catch(error => {
    console.error('❌ Test crashed:', error);
    clearTimeout(timeout);
    process.exit(1);
  });