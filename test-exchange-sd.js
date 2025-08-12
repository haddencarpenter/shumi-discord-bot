import axios from 'axios';

console.log('🏦 Testing SD Price via Exchange APIs (No CoinGecko)');
console.log('===================================================\n');

/**
 * Test SD price from various exchanges directly
 * Bypasses CoinGecko completely
 */

async function testKuCoinSD() {
  try {
    console.log('1. Testing KuCoin REST API for SD-USDT:');
    console.log('---------------------------------------');
    
    const response = await axios.get('https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=SD-USDT', {
      timeout: 5000,
      headers: { 'User-Agent': 'shumi-bot/1.0' }
    });
    
    if (response.data && response.data.data) {
      const data = response.data.data;
      console.log(`✅ KuCoin SD-USDT Found:`);
      console.log(`   Best Ask: $${data.bestAsk}`);
      console.log(`   Best Bid: $${data.bestBid}`);
      console.log(`   Mid Price: $${((parseFloat(data.bestAsk) + parseFloat(data.bestBid)) / 2).toFixed(6)}`);
      console.log(`   Time: ${new Date(parseInt(data.time)).toISOString()}`);
      console.log(`   Source: KuCoin REST API`);
      
      return {
        price: (parseFloat(data.bestAsk) + parseFloat(data.bestBid)) / 2,
        source: 'kucoin-rest',
        timestamp: parseInt(data.time)
      };
    }
  } catch (error) {
    console.log(`❌ KuCoin SD-USDT not available: ${error.message}`);
    return null;
  }
}

async function testBinanceSD() {
  try {
    console.log('\n2. Testing Binance REST API for SDUSDT:');
    console.log('----------------------------------------');
    
    const response = await axios.get('https://api.binance.com/api/v3/ticker/24hr?symbol=SDUSDT', {
      timeout: 5000,
      headers: { 'User-Agent': 'shumi-bot/1.0' }
    });
    
    if (response.data) {
      const data = response.data;
      console.log(`✅ Binance SDUSDT Found:`);
      console.log(`   Price: $${data.lastPrice}`);
      console.log(`   24h Change: ${data.priceChangePercent}%`);
      console.log(`   24h Volume: ${data.volume}`);
      console.log(`   Source: Binance REST API`);
      
      return {
        price: parseFloat(data.lastPrice),
        change24h: parseFloat(data.priceChangePercent),
        volume: parseFloat(data.volume),
        source: 'binance-rest'
      };
    }
  } catch (error) {
    console.log(`❌ Binance SDUSDT not available: ${error.message}`);
    return null;
  }
}

async function testBybitSD() {
  try {
    console.log('\n3. Testing Bybit REST API for SDUSDT:');
    console.log('--------------------------------------');
    
    const response = await axios.get('https://api.bybit.com/v5/market/tickers?category=spot&symbol=SDUSDT', {
      timeout: 5000,
      headers: { 'User-Agent': 'shumi-bot/1.0' }
    });
    
    if (response.data && response.data.result && response.data.result.list && response.data.result.list.length > 0) {
      const data = response.data.result.list[0];
      console.log(`✅ Bybit SDUSDT Found:`);
      console.log(`   Price: $${data.lastPrice}`);
      console.log(`   24h Change: ${data.price24hPcnt}%`);
      console.log(`   24h Volume: ${data.volume24h}`);
      console.log(`   Source: Bybit REST API`);
      
      return {
        price: parseFloat(data.lastPrice),
        change24h: parseFloat(data.price24hPcnt) * 100,
        volume: parseFloat(data.volume24h),
        source: 'bybit-rest'
      };
    }
  } catch (error) {
    console.log(`❌ Bybit SDUSDT not available: ${error.message}`);
    return null;
  }
}

async function testGateSD() {
  try {
    console.log('\n4. Testing Gate.io REST API for SD_USDT:');
    console.log('----------------------------------------');
    
    const response = await axios.get('https://api.gateio.ws/api/v4/spot/tickers?currency_pair=SD_USDT', {
      timeout: 5000,
      headers: { 'User-Agent': 'shumi-bot/1.0' }
    });
    
    if (response.data && response.data.length > 0) {
      const data = response.data[0];
      console.log(`✅ Gate.io SD_USDT Found:`);
      console.log(`   Price: $${data.last}`);
      console.log(`   24h Change: ${data.change_percentage}%`);
      console.log(`   24h Volume: ${data.base_volume}`);
      console.log(`   Source: Gate.io REST API`);
      
      return {
        price: parseFloat(data.last),
        change24h: parseFloat(data.change_percentage),
        volume: parseFloat(data.base_volume),
        source: 'gateio-rest'
      };
    }
  } catch (error) {
    console.log(`❌ Gate.io SD_USDT not available: ${error.message}`);
    return null;
  }
}

// Run all exchange tests
async function runExchangeTests() {
  console.log('🎯 Testing SD token price across major exchanges...\n');
  console.log('⚠️  NO COINGECKO API CALLS - Direct exchange data only!\n');
  
  const results = [];
  
  // Test each exchange
  const kucoin = await testKuCoinSD();
  if (kucoin) results.push(kucoin);
  
  const binance = await testBinanceSD();
  if (binance) results.push(binance);
  
  const bybit = await testBybitSD();
  if (bybit) results.push(bybit);
  
  const gate = await testGateSD();
  if (gate) results.push(gate);
  
  // Summary
  console.log('\n🎯 Exchange Test Results Summary:');
  console.log('=================================');
  
  if (results.length === 0) {
    console.log('❌ SD token not found on any tested exchanges');
    console.log('💡 This suggests SD might be:');
    console.log('   - Listed on smaller exchanges only');
    console.log('   - A newer token not widely available');
    console.log('   - Trading under a different symbol');
    console.log('\n🔍 Fallback: Use CoinGecko\'s aggregated data for SD pricing');
  } else {
    console.log(`✅ Found SD on ${results.length} exchange(s):`);
    
    const prices = results.map(r => r.price).filter(p => !isNaN(p));
    if (prices.length > 0) {
      const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      
      console.log(`\n📊 SD Price Analysis:`);
      console.log(`   Average: $${avgPrice.toFixed(6)}`);
      console.log(`   Range: $${minPrice.toFixed(6)} - $${maxPrice.toFixed(6)}`);
      console.log(`   Spread: ${(((maxPrice - minPrice) / avgPrice) * 100).toFixed(2)}%`);
    }
    
    console.log('\n📋 Individual Exchange Results:');
    results.forEach((result, i) => {
      console.log(`   ${i + 1}. ${result.source}: $${result.price.toFixed(6)}`);
    });
  }
  
  console.log('\n✨ Exchange API test complete - Zero CoinGecko calls made!');
}

runExchangeTests().catch(error => {
  console.error('❌ Test failed:', error.message);
  process.exit(1);
});