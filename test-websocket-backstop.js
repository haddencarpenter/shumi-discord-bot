import webSocketBackstop from './src/websocket-backstop.js';

/**
 * Test the production WebSocket backstop implementation
 */

console.log('🧪 Testing WebSocket Backstop Implementation...\n');

// Test configuration
const testCoins = ['bitcoin', 'ethereum', 'solana', 'some-random-coin'];

async function testWebSocketBackstop() {
  console.log('📊 Supported coins:', webSocketBackstop.getSupportedCoins());
  console.log('');

  // Test canHandle function
  console.log('🔍 Testing canHandle function:');
  for (const coin of testCoins) {
    const canHandle = webSocketBackstop.canHandle(coin);
    console.log(`  ${coin}: ${canHandle ? '✅ Supported' : '❌ Not supported'}`);
  }
  console.log('');

  // Connect to WebSocket
  console.log('🔗 Connecting to Binance WebSocket...');
  const connected = await webSocketBackstop.connect();
  
  if (!connected) {
    console.log('❌ Failed to connect');
    return;
  }

  // Wait for price data
  console.log('⏳ Waiting for price data (10 seconds)...');
  await new Promise(resolve => setTimeout(resolve, 10000));

  // Test price retrieval
  console.log('💰 Testing price retrieval:');
  const supportedCoins = webSocketBackstop.getSupportedCoins().slice(0, 3); // Test first 3
  
  for (const coinId of supportedCoins) {
    try {
      const price = await webSocketBackstop.getPrice(coinId);
      console.log(`  ${coinId}: $${price.price} (${price.change24h >= 0 ? '+' : ''}${price.change24h.toFixed(2)}%)`);
    } catch (error) {
      console.log(`  ${coinId}: ❌ ${error.message}`);
    }
  }

  // Test batch retrieval
  console.log('\n📦 Testing batch price retrieval:');
  const batchCoins = ['bitcoin', 'ethereum', 'unknown-coin'];
  const batchPrices = await webSocketBackstop.getPrices(batchCoins);
  
  batchCoins.forEach((coinId, index) => {
    const price = batchPrices[index];
    if (price) {
      console.log(`  ${coinId}: $${price.price}`);
    } else {
      console.log(`  ${coinId}: ❌ No data`);
    }
  });

  // Show cache stats
  console.log('\n📊 Cache Statistics:');
  const stats = webSocketBackstop.getCacheStats();
  console.log(`  Connected: ${stats.connected}`);
  console.log(`  Banned: ${stats.banned}`);
  console.log(`  Total Cached: ${stats.totalCached}`);
  console.log(`  Fresh Prices: ${stats.freshPrices}`);
  console.log(`  Stale Prices: ${stats.stalePrices}`);
  console.log(`  Supported Coins: ${stats.supportedCoins}`);
  console.log(`  Active Connections: ${stats.connectionCount}`);

  // Cleanup
  console.log('\n🧹 Cleaning up...');
  webSocketBackstop.disconnect();
  
  console.log('✅ Test completed successfully!');
}

// Handle events
webSocketBackstop.on('connected', () => {
  console.log('🎉 WebSocket connected successfully');
});

webSocketBackstop.on('priceUpdate', (data) => {
  console.log(`📈 Price update: ${data.coinId} = $${data.price}`);
});

webSocketBackstop.on('banned', () => {
  console.log('🚫 IP banned detected!');
});

// Run test
testWebSocketBackstop().catch(error => {
  console.error('💥 Test failed:', error);
  process.exit(1);
});

