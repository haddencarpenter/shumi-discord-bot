// test-resolver-advanced.js
import { resolveQuery, parsePair, detectFlags, resolveCanonical } from './src/resolver-advanced.js';

console.log('🧪 Testing Advanced CoinGecko Resolver\n');

async function testPairDetection() {
  console.log('📊 Testing pair detection:');
  
  const testCases = [
    'btcusdt',
    'ONDO/USDT', 
    'eth:usdc',
    'matic-usdt',
    'susdt',  // not a pair, should be treated as coin
    'xrp/dai'
  ];
  
  for (const query of testCases) {
    try {
      const result = await resolveQuery(query);
      if (result.type === 'pair') {
        console.log(`  ✅ "${query}" → pair: ${result.baseId}/${result.quote}`);
      } else if (result.type === 'coin') {
        console.log(`  📈 "${query}" → coin: ${result.id}`);
      } else {
        console.log(`  ❌ "${query}" → ${result.reason}`);
      }
    } catch (error) {
      console.log(`  💥 "${query}" → Error: ${error.message}`);
    }
  }
  console.log();
}

async function testCanonicalMapping() {
  console.log('⚡ Testing canonical fast-path:');
  
  const testCases = ['btc', 'eth', 'sol', 'matic', 'pol', 'w', 'syn', 'multi'];
  
  for (const ticker of testCases) {
    const result = await resolveQuery(ticker);
    if (result.type === 'coin') {
      console.log(`  ✅ "${ticker}" → "${result.id}"`);
    } else {
      console.log(`  ❌ "${ticker}" → ${result.reason || 'failed'}`);
    }
  }
  console.log();
}

async function testStablecoinGuard() {
  console.log('🛡️ Testing stablecoin guard:');
  
  const testCases = [
    { query: 'usdc', shouldBlock: true },
    { query: 'usdc stablecoin', shouldBlock: false }, // explicit request
    { query: 'frax', shouldBlock: true },
    { query: 'dai price', shouldBlock: false }, // explicit mention
    { query: 'crv', shouldBlock: false }, // should get curve-dao-token, not crvusd
  ];
  
  for (const test of testCases) {
    const result = await resolveQuery(test.query);
    const blocked = result.type === 'none' && result.reason === 'no_match';
    const status = blocked === test.shouldBlock ? '✅' : '⚠️';
    console.log(`  ${status} "${test.query}" → ${result.type}${result.id ? ` (${result.id})` : ''}${result.reason ? ` (${result.reason})` : ''}`);
  }
  console.log();
}

async function testWrappedFiltering() {
  console.log('🎯 Testing wrapped/staked filtering:');
  
  const testCases = [
    { query: 'eth', expectNative: true },
    { query: 'bitcoin', expectNative: true },
    { query: 'weth explicit', expectWrapped: true },
    { query: 'staked eth', expectStaked: true },
    { query: 'wormhole', expectProtocol: true }, // should get protocol, not bridged
  ];
  
  for (const test of testCases) {
    const result = await resolveQuery(test.query);
    if (result.type === 'coin') {
      const isNative = !result.id.includes('wrapped') && !result.id.includes('staked');
      const isWrapped = result.id.includes('wrapped') || result.id.includes('weth') || result.id.includes('wbtc');
      const isStaked = result.id.includes('staked') || result.id.includes('steth');
      const isProtocol = ['wormhole', 'synapse-2', 'multichain', 'anyswap'].includes(result.id);
      
      let status = '⚠️';
      if (test.expectNative && isNative) status = '✅';
      if (test.expectWrapped && isWrapped) status = '✅';
      if (test.expectStaked && isStaked) status = '✅';
      if (test.expectProtocol && isProtocol) status = '✅';
      
      console.log(`  ${status} "${test.query}" → "${result.id}"`);
    } else {
      console.log(`  ❌ "${test.query}" → ${result.reason || 'failed'}`);
    }
  }
  console.log();
}

async function testFlagDetection() {
  console.log('🏳️ Testing flag detection:');
  
  const testCases = [
    'btc price',
    'weth wrapped',
    'staked ethereum',
    'bridged usdc',
    'stable coin dai',
    'exact wbtc'
  ];
  
  for (const query of testCases) {
    const flags = detectFlags(query);
    console.log(`  "${query}":`, {
      wrapped: flags.include_wrapped,
      staked: flags.include_staked,
      bridged: flags.include_bridged,
      stables: flags.include_stablecoins,
      exact: flags.force_exact
    });
  }
  console.log();
}

async function testPairParsing() {
  console.log('🔍 Testing pair parsing:');
  
  const testCases = [
    'btcusdt',
    'ETH/USDC',
    'ondo-usdt',
    'xrp:dai',
    'notapair',
    'kasusdt'
  ];
  
  for (const query of testCases) {
    const pair = parsePair(query.toLowerCase());
    if (pair) {
      console.log(`  ✅ "${query}" → ${pair.base}/${pair.quote}`);
    } else {
      console.log(`  ❌ "${query}" → not a pair`);
    }
  }
  console.log();
}

// Run all tests
async function runTests() {
  try {
    await testCanonicalMapping();
    await testPairParsing();
    await testPairDetection();
    await testFlagDetection();
    await testStablecoinGuard();
    await testWrappedFiltering();
    
    console.log('✨ All tests completed!\n');
  } catch (error) {
    console.error('Test suite error:', error);
  }
}

runTests();