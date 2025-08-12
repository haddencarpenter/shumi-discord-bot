// test-offline.js - Test resolver logic without API calls
import { 
  resolveCanonical, 
  parsePair, 
  detectFlags, 
  CANONICAL,
  QUOTES,
  STABLES_CORE,
  BLOCKED_IDS
} from './src/resolver-advanced.js';

console.log('🧪 Offline Resolver Logic Tests\n');

function testCanonical() {
  console.log('⚡ Testing canonical mappings:');
  
  const tests = ['btc', 'eth', 'sol', 'matic', 'pol', 'w', 'syn', 'multi', 'nonexistent'];
  
  tests.forEach(ticker => {
    const result = resolveCanonical(ticker);
    console.log(`  ${ticker} → ${result || 'null'}`);
  });
  console.log();
}

function testPairParsing() {
  console.log('📊 Testing pair parsing:');
  
  const tests = [
    'btcusdt',
    'eth/usdc', 
    'ondo-usdt',
    'xrp:dai',
    'kasusdt',
    'notapair',
    'btceur',  // not in quotes list
    'susdtusd'  // edge case
  ];
  
  tests.forEach(query => {
    const result = parsePair(query.toLowerCase());
    if (result) {
      console.log(`  ✅ "${query}" → ${result.base}/${result.quote}`);
    } else {
      console.log(`  ❌ "${query}" → not a pair`);
    }
  });
  console.log();
}

function testFlagDetection() {
  console.log('🏳️ Testing flag detection:');
  
  const tests = [
    'btc price',
    'weth wrapped ethereum', 
    'staked solana price',
    'bridged usdc polygon',
    'stable coin dai',
    'exact wbtc force',
    'just normal query'
  ];
  
  tests.forEach(query => {
    const flags = detectFlags(query);
    const activeFlags = Object.entries(flags)
      .filter(([_, value]) => value)
      .map(([key, _]) => key)
      .join(', ') || 'none';
    
    console.log(`  "${query}" → flags: ${activeFlags}`);
  });
  console.log();
}

function testBlocklist() {
  console.log('🚫 Testing blocklist:');
  
  const testIds = [
    'bitcoin',      // should be allowed
    'ethereum',     // should be allowed
    'weth',         // should be blocked
    'wrapped-bitcoin', // should be blocked
    'wormhole',     // should be allowed (protected)
    'solana-wormhole', // should be blocked
    'synapse-2',    // should be allowed (protected)
    'multichain-bridged-usdc' // should be blocked
  ];
  
  testIds.forEach(id => {
    const blocked = BLOCKED_IDS.has(id);
    const status = blocked ? '🚫 BLOCKED' : '✅ allowed';
    console.log(`  ${id} → ${status}`);
  });
  console.log();
}

function testStablecoinDetection() {
  console.log('💰 Testing stablecoin detection:');
  
  const testCoins = [
    { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin' },
    { id: 'tether', symbol: 'usdt', name: 'Tether' },
    { id: 'usd-coin', symbol: 'usdc', name: 'USD Coin' },
    { id: 'dai', symbol: 'dai', name: 'Dai' },
    { id: 'curve-dao-token', symbol: 'crv', name: 'Curve DAO Token' },
    { id: 'crvusd', symbol: 'crvusd', name: 'crvUSD' }
  ];
  
  testCoins.forEach(coin => {
    const isStable = STABLES_CORE.has(coin.id.toLowerCase()) || 
                     STABLES_CORE.has(coin.symbol.toLowerCase()) ||
                     STABLES_CORE.has(coin.name.toLowerCase());
    const status = isStable ? '💰 STABLE' : '📈 not stable';
    console.log(`  ${coin.symbol} (${coin.id}) → ${status}`);
  });
  console.log();
}

function testQuoteCurrencies() {
  console.log('💱 Quote currencies supported:');
  console.log(`  ${QUOTES.join(', ')}`);
  console.log();
}

// Run all tests
console.log('='.repeat(50));
testCanonical();
testPairParsing();
testFlagDetection();
testBlocklist();
testStablecoinDetection();
testQuoteCurrencies();
console.log('✨ All offline tests completed!');