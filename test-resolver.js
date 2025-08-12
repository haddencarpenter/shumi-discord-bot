// test-resolver.js
import { resolveCoinId, debugResolve, resolveMany } from './src/resolve.js';
import { fetchUsdPrice, getPricesForTickers } from './src/price.js';

console.log('🧪 Testing CoinGecko Resolver\n');

async function testSingleResolve() {
  console.log('📍 Testing single coin resolution:');
  
  const testCases = [
    'eth',      // Should get ethereum, not wrapped-ether
    'btc',      // Should get bitcoin, not wrapped-bitcoin
    'sol',      // Should get solana, not wrapped variants
    'weth',     // Explicitly asking for wrapped version
    'wbtc',     // Explicitly asking for wrapped version
    'matic',    // Should get polygon-pos
    'pepe',     // Should get pepe meme coin
  ];
  
  for (const ticker of testCases) {
    try {
      const id = await resolveCoinId(ticker);
      console.log(`  ✅ "${ticker}" → "${id}"`);
    } catch (error) {
      console.log(`  ❌ "${ticker}" → Error: ${error.message}`);
    }
  }
  console.log();
}

async function testDebugResolve() {
  console.log('🔍 Debug resolution for "eth":');
  
  const debug = await debugResolve('eth');
  console.log(`  Query: ${debug.query}`);
  console.log(`  Resolved ID: ${debug.resolved_id}`);
  console.log(`  Method: ${debug.method}`);
  
  if (debug.candidates) {
    console.log(`  Top candidates found:`);
    debug.candidates.slice(0, 5).forEach(c => {
      const status = c.blocked ? '🚫' : c.looks_wrapped ? '⚠️' : '✅';
      console.log(`    ${status} ${c.id} (${c.symbol}) - rank: ${c.market_cap_rank}, score: ${c.score}`);
    });
  }
  console.log();
}

async function testPriceFetch() {
  console.log('💰 Testing price fetch with resolver:');
  
  const testTickers = ['eth', 'btc', 'sol', 'matic'];
  
  for (const ticker of testTickers) {
    try {
      const price = await fetchUsdPrice(ticker);
      console.log(`  ✅ ${ticker}: $${price.toFixed(2)}`);
    } catch (error) {
      console.log(`  ❌ ${ticker}: ${error.message}`);
    }
  }
  console.log();
}

async function testBatchPrices() {
  console.log('📊 Testing batch price fetch:');
  
  const tickers = ['ETH', 'BTC', 'SOL', 'MATIC', 'USDT', 'USDC'];
  const prices = await getPricesForTickers(tickers);
  
  for (const [ticker, data] of Object.entries(prices)) {
    if (data) {
      const price = data.usd;
      const change = data.usd_24h_change;
      console.log(`  ${ticker}: $${price.toFixed(2)}${change ? ` (${change > 0 ? '+' : ''}${change.toFixed(2)}%)` : ''}`);
    } else {
      console.log(`  ${ticker}: No data`);
    }
  }
  console.log();
}

async function testWrappedFiltering() {
  console.log('🎯 Testing wrapped/bridged filtering:');
  
  // These should all resolve to native versions
  const nativeTests = [
    { ticker: 'ethereum', expected: 'ethereum' },
    { ticker: 'bitcoin', expected: 'bitcoin' },
    { ticker: 'bnb', expected: 'binancecoin' },
  ];
  
  for (const test of nativeTests) {
    const id = await resolveCoinId(test.ticker);
    const status = id === test.expected ? '✅' : '⚠️';
    console.log(`  ${status} "${test.ticker}" → "${id}" (expected: "${test.expected}")`);
  }
  console.log();
}

// Run all tests
async function runTests() {
  try {
    await testSingleResolve();
    await testDebugResolve();
    await testWrappedFiltering();
    await testPriceFetch();
    await testBatchPrices();
    
    console.log('✨ All tests completed!\n');
  } catch (error) {
    console.error('Test suite error:', error);
  }
}

runTests();