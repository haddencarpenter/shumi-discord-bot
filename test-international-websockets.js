import WebSocket from 'ws';
import { EventEmitter } from 'events';

/**
 * Test international exchanges and on-chain sources for WebSocket reliability
 * Focus on non-US exchanges which often have better API access
 */

class InternationalWebSocketTester extends EventEmitter {
  constructor() {
    super();
    this.testResults = new Map();
    this.bannedExchanges = new Set();
  }

  /**
   * International exchange configurations
   * These typically have more relaxed rate limits
   */
  getInternationalExchangeConfigs() {
    return {
      bybit: {
        url: 'wss://stream.bybit.com/v5/public/spot',
        name: 'Bybit',
        region: 'Singapore',
        maxConnections: 10, // Bybit is usually generous
        subscribe: {
          op: 'subscribe',
          args: ['tickers.BTCUSDT', 'tickers.ETHUSDT', 'tickers.SOLUSDT']
        },
        testPairs: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
        priceField: 'lastPrice',
        dataField: 'data' // Bybit wraps data
      },
      
      gateio: {
        url: 'wss://api.gateio.ws/ws/v4/',
        name: 'Gate.io',
        region: 'Global',
        maxConnections: 8,
        subscribe: {
          method: 'ticker.subscribe',
          params: ['BTC_USDT', 'ETH_USDT', 'SOL_USDT'],
          id: 12345
        },
        testPairs: ['BTC_USDT', 'ETH_USDT', 'SOL_USDT'],
        priceField: 'last'
      },

      kucoin: {
        url: 'wss://ws-api-spot.kucoin.com/',
        name: 'KuCoin',
        region: 'Singapore', 
        maxConnections: 5,
        // KuCoin requires token-based connection, we'll test basic connection
        testPairs: ['BTC-USDT', 'ETH-USDT', 'SOL-USDT'],
        needsToken: true // Special handling required
      },

      okx: {
        url: 'wss://ws.okx.com:8443/ws/v5/public',
        name: 'OKX',
        region: 'Global',
        maxConnections: 6,
        subscribe: {
          op: 'subscribe',
          args: [
            { channel: 'tickers', instId: 'BTC-USDT' },
            { channel: 'tickers', instId: 'ETH-USDT' },
            { channel: 'tickers', instId: 'SOL-USDT' }
          ]
        },
        testPairs: ['BTC-USDT', 'ETH-USDT', 'SOL-USDT'],
        priceField: 'last'
      },

      hyperliquid: {
        url: 'wss://api.hyperliquid.xyz/ws',
        name: 'Hyperliquid (On-chain)',
        region: 'Decentralized',
        maxConnections: 3,
        subscribe: {
          method: 'subscribe',
          subscription: {
            type: 'allMids'
          }
        },
        testPairs: ['BTC', 'ETH', 'SOL'], // On-chain uses different format
        priceField: 'mid',
        onChain: true
      },

      mexc: {
        url: 'wss://wbs.mexc.com/ws',
        name: 'MEXC',
        region: 'Singapore',
        maxConnections: 5,
        subscribe: {
          method: 'SUBSCRIPTION',
          params: ['spot@public.miniTicker.v3.api@BTCUSDT', 'spot@public.miniTicker.v3.api@ETHUSDT']
        },
        testPairs: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']
      },

      bitget: {
        url: 'wss://ws.bitget.com/spot/v1/stream',
        name: 'Bitget',
        region: 'Singapore',
        maxConnections: 4,
        subscribe: {
          op: 'subscribe',
          args: [
            { instType: 'sp', channel: 'ticker', instId: 'BTCUSDT' },
            { instType: 'sp', channel: 'ticker', instId: 'ETHUSDT' }
          ]
        },
        testPairs: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']
      }
    };
  }

  /**
   * Test a single international exchange
   */
  async testExchange(exchangeKey, config) {
    console.log(`\n🌍 Testing ${config.name} (${config.region}) WebSocket...`);
    
    const testResults = {
      exchange: config.name,
      region: config.region,
      maxConnections: 0,
      avgLatency: 0,
      errors: [],
      bannedAt: null,
      pricesReceived: 0,
      onChain: config.onChain || false,
      specialFeatures: []
    };

    // Add special features
    if (config.needsToken) testResults.specialFeatures.push('Requires auth token');
    if (config.onChain) testResults.specialFeatures.push('On-chain/DEX data');

    // Test connections gradually
    for (let connCount = 1; connCount <= config.maxConnections; connCount++) {
      console.log(`  📊 Testing ${connCount} connection(s)...`);
      
      try {
        const success = await this.createInternationalConnection(exchangeKey, config, connCount);
        
        if (success) {
          testResults.maxConnections = connCount;
          console.log(`  ✅ ${connCount} connection(s) successful`);
          
          // Shorter wait for international exchanges (they're usually more stable)
          await this.delay(1500);
        } else {
          console.log(`  ❌ Failed at ${connCount} connections`);
          break;
        }
      } catch (error) {
        console.log(`  🚫 Error at ${connCount} connections:`, error.message);
        
        // Check for various ban/limit indicators
        if (error.message.includes('429') || 
            error.message.includes('banned') ||
            error.message.includes('rate limit') ||
            error.message.includes('too many')) {
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
   * Create connection to international exchange
   */
  async createInternationalConnection(exchangeKey, config, connectionId) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let pricesReceived = 0;
      
      // Handle special cases
      if (config.needsToken && exchangeKey === 'kucoin') {
        console.log(`    ⚠️ ${config.name} requires auth token, testing basic connection only`);
      }

      const ws = new WebSocket(config.url);
      const timeoutId = setTimeout(() => {
        ws.close();
        reject(new Error(`Connection timeout (${config.name})`));
      }, 15000); // Longer timeout for international exchanges

      ws.on('open', () => {
        console.log(`    🔗 ${config.name} connection ${connectionId} opened`);
        
        // Send subscription for exchanges that support it
        if (config.subscribe && !config.needsToken) {
          try {
            ws.send(JSON.stringify(config.subscribe));
            console.log(`    📡 Subscription sent to ${config.name}`);
          } catch (error) {
            console.log(`    ⚠️ Subscription failed: ${error.message}`);
          }
        }
      });

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          pricesReceived++;
          
          let price = null;
          
          // Extract price based on exchange format
          switch (exchangeKey) {
            case 'bybit':
              if (message.data && message.data.lastPrice) {
                price = parseFloat(message.data.lastPrice);
              }
              break;
              
            case 'gateio':
              if (message.result && message.result.last) {
                price = parseFloat(message.result.last);
              }
              break;
              
            case 'okx':
              if (message.data && message.data[0] && message.data[0].last) {
                price = parseFloat(message.data[0].last);
              }
              break;
              
            case 'hyperliquid':
              if (message.data && message.data.mids) {
                // Hyperliquid sends all mids, find BTC
                const btcMid = message.data.mids['BTC'];
                if (btcMid) price = parseFloat(btcMid);
              }
              break;
              
            case 'mexc':
              if (message.d && message.d.c) {
                price = parseFloat(message.d.c);
              }
              break;
              
            case 'bitget':
              if (message.data && message.data.last) {
                price = parseFloat(message.data.last);
              }
              break;
          }

          if (price && pricesReceived === 1) {
            const latency = Date.now() - startTime;
            console.log(`    💰 ${config.name} first price: $${price} (${latency}ms)`);
            
            clearTimeout(timeoutId);
            ws.close();
            resolve(true);
          }
          
          // For exchanges without immediate price data, accept any response
          if (pricesReceived >= 3 && !price) {
            console.log(`    📡 ${config.name} responding (no price data yet)`);
            clearTimeout(timeoutId);
            ws.close();
            resolve(true);
          }
          
        } catch (error) {
          console.log(`    ⚠️ ${config.name} parse error:`, error.message);
        }
      });

      ws.on('error', (error) => {
        console.log(`    ❌ ${config.name} WebSocket error:`, error.message);
        clearTimeout(timeoutId);
        reject(error);
      });

      ws.on('close', (code, reason) => {
        console.log(`    🔌 ${config.name} connection ${connectionId} closed: ${code} ${reason}`);
        clearTimeout(timeoutId);
        
        // Check for ban/limit indicators
        if (code === 1006 || code === 1002 || code === 4001) {
          reject(new Error(`Possible rate limit/ban - close code: ${code}`));
        }
      });
    });
  }

  /**
   * Test all international exchanges
   */
  async testAllInternationalExchanges() {
    console.log('🌍 Testing International Exchange WebSockets');
    console.log('===========================================');
    console.log('🎯 Focus: Non-US exchanges with better API access\n');
    
    const configs = this.getInternationalExchangeConfigs();
    const results = [];

    for (const [exchangeKey, config] of Object.entries(configs)) {
      if (this.bannedExchanges.has(exchangeKey)) {
        console.log(`⏭️  Skipping ${config.name} - previously rate limited`);
        continue;
      }

      try {
        const result = await this.testExchange(exchangeKey, config);
        results.push(result);
        
        // Longer delay between international exchanges
        await this.delay(3000);
      } catch (error) {
        console.log(`💥 Failed to test ${config.name}:`, error.message);
      }
    }

    this.printInternationalSummary(results);
    return results;
  }

  /**
   * Print comprehensive test results for international exchanges
   */
  printInternationalSummary(results) {
    console.log('\n🌍 International Exchange Test Results');
    console.log('======================================');
    
    const workingExchanges = results.filter(r => r.maxConnections > 0);
    const onChainSources = results.filter(r => r.onChain);
    
    console.log(`📊 Summary: ${workingExchanges.length}/${results.length} exchanges working`);
    console.log(`🔗 On-chain sources: ${onChainSources.length}`);
    
    // Sort by max connections (best first)
    const sortedResults = results.sort((a, b) => b.maxConnections - a.maxConnections);
    
    console.log('\n🏆 Best Exchanges (by connection limit):');
    sortedResults.forEach((result, index) => {
      if (result.maxConnections > 0) {
        const features = result.specialFeatures.length > 0 ? 
          ` (${result.specialFeatures.join(', ')})` : '';
        console.log(`  ${index + 1}. ${result.exchange} (${result.region}): ${result.maxConnections} connections${features}`);
      }
    });

    console.log('\n❌ Failed Exchanges:');
    results.forEach(result => {
      if (result.maxConnections === 0) {
        const errors = result.errors.slice(0, 2).join('; ');
        console.log(`  - ${result.exchange}: ${errors}`);
      }
    });

    console.log('\n🎯 Recommendations:');
    
    if (workingExchanges.length > 0) {
      const best = workingExchanges[0];
      console.log(`  🥇 Primary: ${best.exchange} (${best.maxConnections} connections)`);
      
      if (workingExchanges.length > 1) {
        const secondary = workingExchanges.slice(1, 3);
        console.log(`  🥈 Backup: ${secondary.map(e => e.exchange).join(', ')}`);
      }
    }

    if (onChainSources.length > 0) {
      console.log(`  ⛓️  On-chain option: ${onChainSources[0].exchange}`);
    }

    console.log('\n🔒 Safety Strategy:');
    console.log('  - Use 2-3 exchanges in rotation');
    console.log('  - International exchanges often have better limits');
    console.log('  - On-chain sources for ultimate reliability');
    console.log('  - Implement circuit breakers for each exchange');
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Run the international exchange test
const tester = new InternationalWebSocketTester();
tester.testAllInternationalExchanges().then(() => {
  console.log('\n✅ International exchange testing complete!');
  process.exit(0);
}).catch(error => {
  console.error('💥 Test failed:', error);
  process.exit(1);
});

