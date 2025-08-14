import WebSocket from 'ws';
import { EventEmitter } from 'events';

/**
 * Safe WebSocket testing framework
 * Tests rate limits across multiple exchanges without getting IP banned
 */

class WebSocketTester extends EventEmitter {
  constructor() {
    super();
    this.connections = new Map();
    this.priceData = new Map();
    this.connectionAttempts = new Map();
    this.bannedExchanges = new Set();
    this.testResults = new Map();
  }

  /**
   * Exchange configurations with safe connection limits
   */
  getExchangeConfigs() {
    return {
      binance: {
        url: 'wss://stream.binance.com:9443/ws/btcusdt@ticker',
        name: 'Binance',
        maxConnections: 5, // Conservative start
        reconnectDelay: 5000,
        testPairs: ['btcusdt', 'ethusdt', 'solusdt'],
        priceField: 'c' // Close price
      },
      coinbase: {
        url: 'wss://ws-feed.pro.coinbase.com',
        name: 'Coinbase Pro',
        maxConnections: 3,
        reconnectDelay: 3000,
        testPairs: ['BTC-USD', 'ETH-USD', 'SOL-USD'],
        subscribe: {
          type: 'subscribe',
          product_ids: ['BTC-USD', 'ETH-USD', 'SOL-USD'],
          channels: ['ticker']
        },
        priceField: 'price'
      },
      kraken: {
        url: 'wss://ws.kraken.com',
        name: 'Kraken',
        maxConnections: 3,
        reconnectDelay: 4000,
        testPairs: ['BTC/USD', 'ETH/USD', 'SOL/USD'],
        subscribe: {
          event: 'subscribe',
          pair: ['XBT/USD', 'ETH/USD', 'SOL/USD'],
          subscription: { name: 'ticker' }
        },
        priceField: 'c' // Close price array [price, volume]
      }
    };
  }

  /**
   * Safe symbol mapping to prevent wrong prices
   */
  getSafeSymbolMapping() {
    return {
      // Only map major, unambiguous symbols
      'bitcoin': {
        binance: 'BTCUSDT',
        coinbase: 'BTC-USD', 
        kraken: 'XBT/USD', // Note: Kraken uses XBT for Bitcoin
        coingeckoId: 'bitcoin'
      },
      'ethereum': {
        binance: 'ETHUSDT',
        coinbase: 'ETH-USD',
        kraken: 'ETH/USD',
        coingeckoId: 'ethereum'
      },
      'solana': {
        binance: 'SOLUSDT',
        coinbase: 'SOL-USD', 
        kraken: 'SOL/USD',
        coingeckoId: 'solana'
      }
      // Only add symbols we're 100% confident about
      // NO single letters, ambiguous tokens, or new coins
    };
  }

  /**
   * Test a single exchange with gradual connection increases
   */
  async testExchange(exchangeKey, config) {
    console.log(`\n🧪 Testing ${config.name} WebSocket limits...`);
    
    const testResults = {
      exchange: config.name,
      maxConnections: 0,
      avgLatency: 0,
      errors: [],
      bannedAt: null,
      pricesReceived: 0
    };

    // Start with 1 connection, gradually increase
    for (let connCount = 1; connCount <= config.maxConnections; connCount++) {
      console.log(`  📊 Testing ${connCount} connection(s)...`);
      
      try {
        const success = await this.createTestConnection(exchangeKey, config, connCount);
        
        if (success) {
          testResults.maxConnections = connCount;
          console.log(`  ✅ ${connCount} connection(s) successful`);
          
          // Wait between tests to be respectful
          await this.delay(2000);
        } else {
          console.log(`  ❌ Failed at ${connCount} connections`);
          break;
        }
      } catch (error) {
        console.log(`  🚫 Error at ${connCount} connections:`, error.message);
        if (error.message.includes('429') || error.message.includes('banned')) {
          testResults.bannedAt = connCount;
          this.bannedExchanges.add(exchangeKey);
        }
        testResults.errors.push(`${connCount} conn: ${error.message}`);
        break;
      }
    }

    this.testResults.set(exchangeKey, testResults);
    return testResults;
  }

  /**
   * Create a test WebSocket connection
   */
  async createTestConnection(exchangeKey, config, connectionId) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let pricesReceived = 0;
      
      const ws = new WebSocket(config.url);
      const timeoutId = setTimeout(() => {
        ws.close();
        reject(new Error('Connection timeout'));
      }, 10000);

      ws.on('open', () => {
        console.log(`    🔗 Connection ${connectionId} opened`);
        
        // Send subscription for exchanges that need it
        if (config.subscribe) {
          ws.send(JSON.stringify(config.subscribe));
        }
      });

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          pricesReceived++;
          
          // Extract price based on exchange format
          let price = null;
          if (exchangeKey === 'binance' && message.c) {
            price = parseFloat(message.c);
          } else if (exchangeKey === 'coinbase' && message.price) {
            price = parseFloat(message.price);
          } else if (exchangeKey === 'kraken' && message[1]?.c?.[0]) {
            price = parseFloat(message[1].c[0]);
          }

          if (price && pricesReceived === 1) {
            const latency = Date.now() - startTime;
            console.log(`    💰 First price received: $${price} (${latency}ms)`);
            
            clearTimeout(timeoutId);
            ws.close();
            resolve(true);
          }
        } catch (error) {
          console.log(`    ⚠️ Parse error:`, error.message);
        }
      });

      ws.on('error', (error) => {
        console.log(`    ❌ WebSocket error:`, error.message);
        clearTimeout(timeoutId);
        reject(error);
      });

      ws.on('close', (code, reason) => {
        console.log(`    🔌 Connection ${connectionId} closed: ${code} ${reason}`);
        clearTimeout(timeoutId);
        
        // Check for ban indicators
        if (code === 1006 || code === 1002) {
          reject(new Error(`Possible IP ban - close code: ${code}`));
        }
      });
    });
  }

  /**
   * Test all exchanges safely
   */
  async testAllExchanges() {
    console.log('🚀 Starting safe WebSocket limit testing...\n');
    console.log('⚠️  Testing with conservative limits to avoid IP bans');
    
    const configs = this.getExchangeConfigs();
    const results = [];

    for (const [exchangeKey, config] of Object.entries(configs)) {
      if (this.bannedExchanges.has(exchangeKey)) {
        console.log(`⏭️  Skipping ${config.name} - previously banned`);
        continue;
      }

      try {
        const result = await this.testExchange(exchangeKey, config);
        results.push(result);
        
        // Longer delay between exchanges to be extra safe
        await this.delay(5000);
      } catch (error) {
        console.log(`💥 Failed to test ${config.name}:`, error.message);
      }
    }

    this.printTestSummary(results);
    return results;
  }

  /**
   * Print comprehensive test results
   */
  printTestSummary(results) {
    console.log('\n📊 WebSocket Test Results Summary');
    console.log('=====================================');
    
    results.forEach(result => {
      console.log(`\n${result.exchange}:`);
      console.log(`  Max Safe Connections: ${result.maxConnections}`);
      console.log(`  Banned At: ${result.bannedAt || 'No ban detected'}`);
      console.log(`  Errors: ${result.errors.length}`);
      if (result.errors.length > 0) {
        result.errors.forEach(err => console.log(`    - ${err}`));
      }
    });

    console.log('\n🎯 Recommendations:');
    const safestExchange = results.reduce((best, current) => 
      current.maxConnections > (best?.maxConnections || 0) ? current : best, null);
    
    if (safestExchange) {
      console.log(`  - Use ${safestExchange.exchange} as primary (${safestExchange.maxConnections} connections)`);
    }
    
    const workingExchanges = results.filter(r => r.maxConnections > 0);
    console.log(`  - ${workingExchanges.length} exchanges working`);
    console.log(`  - Rotate between exchanges to distribute load`);
    
    console.log('\n⚠️  Symbol Mapping Safety:');
    const mapping = this.getSafeSymbolMapping();
    console.log(`  - Only ${Object.keys(mapping).length} safely mapped symbols`);
    console.log(`  - Symbols: ${Object.keys(mapping).join(', ')}`);
    console.log(`  - NO ambiguous or single-letter symbols included`);
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Run the test
const tester = new WebSocketTester();
tester.testAllExchanges().then(() => {
  console.log('\n✅ Testing complete! Review results above.');
  process.exit(0);
}).catch(error => {
  console.error('💥 Test failed:', error);
  process.exit(1);
});

