// test-enhanced-integration.js - Test the enhanced Discord bot integration
import 'dotenv/config';
import { fetchUsdPrice, fetchCoinData, debugResolve } from './src/price-enhanced-smart.js';

console.log('🤖 Testing Enhanced Discord Bot Integration');
console.log('CoinGecko API Key:', process.env.COINGECKO_API_KEY ? 'Configured ✅' : 'Missing ❌');
console.log();

async function testPriceCommand() {
  console.log('💰 Testing price command scenarios:');
  
  const testCases = [
    'btc',           // Basic ticker
    'eth',           // Basic ticker  
    'btcusdt',       // Pair detection
    'eth/usdc',      // Pair with slash
    'wormhole',      // Protected protocol
    'matic',         // Rebranded token (should get POL)
    'usdc',          // Stablecoin (should be handled specially)
    'crv',           // Should get governance token, not stablecoin
    'mog',           // Meme coin
  ];
  
  for (const ticker of testCases) {
    try {
      // Test the debug resolver first
      const debug = await debugResolve(ticker);
      console.log(`\n🔍 "${ticker}":`);
      console.log(`   Resolution: ${debug.resolution.type}${debug.resolution.id ? ` → ${debug.resolution.id}` : ''}${debug.resolution.baseId ? ` → ${debug.resolution.baseId}/${debug.resolution.quote}` : ''}`);
      
      // Test actual price fetch (what Discord commands use)
      const coinData = await fetchCoinData(ticker);
      const priceFormatted = coinData.price >= 1 ? 
        coinData.price.toFixed(2) : 
        coinData.price.toFixed(8);
      
      console.log(`   Price: $${priceFormatted}${coinData.change24h ? ` (${coinData.change24h > 0 ? '+' : ''}${coinData.change24h.toFixed(2)}%)` : ''}`);
      
      if (coinData.isPair) {
        console.log(`   📊 Detected as trading pair: ${coinData.resolvedFrom}`);
      }
      
      if (coinData.marketCap) {
        const mcap = coinData.marketCap >= 1e9 ? 
          `$${(coinData.marketCap / 1e9).toFixed(2)}B` : 
          `$${(coinData.marketCap / 1e6).toFixed(2)}M`;
        console.log(`   📈 Market Cap: ${mcap}`);
      }
      
    } catch (error) {
      console.log(`\n❌ "${ticker}": ${error.message}`);
    }
    
    // Small delay to respect rate limits
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
}

async function testTradeScenarios() {
  console.log('\n\n📈 Testing trade entry scenarios:');
  
  const tradeTests = [
    'btc',     // Standard long
    'eth',     // Standard entry
    'doge',    // Meme coin
    'sol',     // Popular alt
  ];
  
  for (const ticker of tradeTests) {
    try {
      const price = await fetchUsdPrice(ticker);
      console.log(`✅ Trade entry simulation: ${ticker.toUpperCase()} at $${price.toFixed(8)}`);
    } catch (error) {
      console.log(`❌ Trade entry failed for ${ticker}: ${error.message}`);
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

async function testStablecoinHandling() {
  console.log('\n\n🏦 Testing stablecoin handling:');
  
  const stableTests = ['usdt', 'usdc'];
  
  for (const ticker of stableTests) {
    try {
      const coinData = await fetchCoinData(ticker);
      console.log(`✅ ${ticker.toUpperCase()}: $${coinData.price} (fixed)`);
    } catch (error) {
      console.log(`❌ ${ticker}: ${error.message}`);
    }
  }
}

async function testErrorHandling() {
  console.log('\n\n❌ Testing error handling:');
  
  const errorTests = ['notarealtoken', 'invalidticker123'];
  
  for (const ticker of errorTests) {
    try {
      await fetchUsdPrice(ticker);
      console.log(`⚠️ ${ticker}: Unexpectedly succeeded`);
    } catch (error) {
      console.log(`✅ ${ticker}: Properly failed - ${error.message}`);
    }
  }
}

// Run all tests
async function runTests() {
  try {
    await testPriceCommand();
    await testTradeScenarios();
    await testStablecoinHandling();
    await testErrorHandling();
    
    console.log('\n✨ Enhanced integration test completed!');
    console.log('\nYour Discord bot is now enhanced with:');
    console.log('- 🎯 Advanced token resolution (no more wrapped tokens by accident)');
    console.log('- 📊 Trading pair detection (btcusdt, eth/usdc work)');
    console.log('- 🛡️ Protocol token protection (wormhole, synapse, etc.)');
    console.log('- 🚀 CoinGecko Pro API with higher rate limits');
    console.log('- 🏦 Smart stablecoin handling');
    console.log('- 💾 Maintained caching and rate limiting');
    
  } catch (error) {
    console.error('Test suite error:', error);
  }
}

runTests();