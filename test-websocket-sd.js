import WebSocket from 'ws';

console.log('🔌 Testing SD Price via Exchange WebSocket');
console.log('==========================================\n');

/**
 * Test SD price from KuCoin WebSocket (SD-USDT pair exists there)
 * This bypasses CoinGecko entirely and gets real-time exchange data
 */
async function testSDWebSocketPrice() {
  return new Promise((resolve, reject) => {
    // KuCoin WebSocket endpoint
    const ws = new WebSocket('wss://ws-api-spot.kucoin.com/endpoint');
    
    let connectionId = null;
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('WebSocket timeout after 10 seconds'));
    }, 10000);

    ws.on('open', () => {
      console.log('🔌 Connected to KuCoin WebSocket');
      
      // Subscribe to SD-USDT ticker
      const subscribeMessage = {
        id: Date.now(),
        type: 'subscribe',
        topic: '/market/ticker:SD-USDT',
        response: true
      };
      
      ws.send(JSON.stringify(subscribeMessage));
      console.log('📡 Subscribed to SD-USDT ticker');
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        // Handle connection response
        if (message.type === 'welcome') {
          connectionId = message.id;
          console.log(`✅ WebSocket connection established (ID: ${connectionId})`);
          return;
        }
        
        // Handle subscription confirmation
        if (message.type === 'ack') {
          console.log('✅ Subscription confirmed');
          return;
        }
        
        // Handle ticker data
        if (message.type === 'message' && message.topic === '/market/ticker:SD-USDT') {
          const tickerData = message.data;
          
          console.log('📊 SD-USDT Price Data Received:');
          console.log(`   Price: $${tickerData.price}`);
          console.log(`   24h Change: ${tickerData.changeRate}%`);
          console.log(`   Volume: ${tickerData.vol}`);
          console.log(`   Source: KuCoin WebSocket (real-time)`);
          console.log(`   Timestamp: ${new Date(tickerData.time).toISOString()}`);
          
          clearTimeout(timeout);
          ws.close();
          resolve({
            price: parseFloat(tickerData.price),
            change24h: parseFloat(tickerData.changeRate) * 100,
            volume: parseFloat(tickerData.vol),
            source: 'kucoin-realtime',
            timestamp: parseInt(tickerData.time)
          });
        }
        
      } catch (error) {
        console.error('❌ Error parsing WebSocket message:', error.message);
      }
    });

    ws.on('error', (error) => {
      console.error('❌ WebSocket error:', error.message);
      clearTimeout(timeout);
      reject(error);
    });

    ws.on('close', (code, reason) => {
      console.log(`🔌 WebSocket closed (code: ${code}, reason: ${reason})`);
      clearTimeout(timeout);
    });
  });
}

/**
 * Also test Binance for comparison (if SD exists there)
 */
async function testBinanceWebSocket() {
  return new Promise((resolve, reject) => {
    // Try SD-USDT on Binance
    const ws = new WebSocket('wss://stream.binance.com:9443/ws/sdusdt@ticker');
    
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Binance: SD-USDT pair not available or timeout'));
    }, 5000);

    ws.on('open', () => {
      console.log('🔌 Testing Binance SD-USDT...');
    });

    ws.on('message', (data) => {
      try {
        const ticker = JSON.parse(data.toString());
        
        console.log('📊 Binance SD-USDT Found:');
        console.log(`   Price: $${ticker.c}`);
        console.log(`   24h Change: ${ticker.P}%`);
        console.log(`   Source: Binance WebSocket`);
        
        clearTimeout(timeout);
        ws.close();
        resolve({
          price: parseFloat(ticker.c),
          change24h: parseFloat(ticker.P),
          source: 'binance-realtime'
        });
      } catch (error) {
        console.error('❌ Binance WebSocket error:', error.message);
      }
    });

    ws.on('error', (error) => {
      console.log('⚠️ Binance SD-USDT not available');
      clearTimeout(timeout);
      resolve(null);
    });

    ws.on('close', () => {
      clearTimeout(timeout);
    });
  });
}

// Run the test
async function runWebSocketTest() {
  try {
    console.log('🚀 Starting WebSocket price test for SD token...\n');
    
    // Test KuCoin first (most likely to have SD)
    console.log('1. Testing KuCoin WebSocket:');
    console.log('-----------------------------');
    const kucoinPrice = await testSDWebSocketPrice();
    
    console.log('\n2. Testing Binance WebSocket:');
    console.log('-----------------------------');
    const binancePrice = await testBinanceWebSocket().catch(() => null);
    
    console.log('\n🎯 WebSocket Test Results:');
    console.log('==========================');
    
    if (kucoinPrice) {
      console.log(`✅ KuCoin SD Price: $${kucoinPrice.price}`);
      console.log(`   Change: ${kucoinPrice.change24h.toFixed(2)}%`);
      console.log(`   Source: ${kucoinPrice.source}`);
    }
    
    if (binancePrice) {
      console.log(`✅ Binance SD Price: $${binancePrice.price}`);
      console.log(`   Change: ${binancePrice.change24h.toFixed(2)}%`);
      console.log(`   Source: ${binancePrice.source}`);
    } else {
      console.log('⚠️ Binance: SD-USDT pair not available');
    }
    
    console.log('\n✨ WebSocket test complete - NO COINGECKO API USED!');
    
  } catch (error) {
    console.error('❌ WebSocket test failed:', error.message);
    process.exit(1);
  }
}

runWebSocketTest();