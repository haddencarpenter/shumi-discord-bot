import { EventEmitter } from 'events';

/**
 * Smart Price Service with Intelligent Fallback Strategy
 * 
 * Strategy:
 * 1. CoinGecko Pro API (primary) - batch processing for best efficiency
 * 2. WebSocket fallbacks (Binance, OKX, Bitget) - instant for major coins during high load
 * 3. Smart circuit breaker - detects 429 errors and switches to fallback
 * 4. Cost control - minimize API calls, maximize uptime
 */

class SmartPriceService extends EventEmitter {
  constructor() {
    super();
    
    // Service state
    this.coingeckoHealthy = true;
    this.rateLimitedUntil = null;
    this.requestCount = 0;
    this.lastResetTime = Date.now();
    this.maxRequestsPerMinute = 300; // Conservative limit for Pro API
    
    // Fallback state
    this.webSocketFallbacks = new Map();
    this.fallbackPrices = new Map(); // Cache for WebSocket prices
    
    // Performance metrics
    this.metrics = {
      coingeckoRequests: 0,
      fallbackRequests: 0,
      errors: 0,
      rateLimits: 0,
      avgResponseTime: 0
    };

    this.initializeFallbacks();
  }

  /**
   * Initialize WebSocket fallbacks based on our test results
   * OKX (6 connections) + Binance (5 connections) + Bitget (4 connections)
   */
  async initializeFallbacks() {
    try {
      // Import and setup fallback services
      const { default: webSocketBackstop } = await import('./websocket-backstop.js');
      await webSocketBackstop.connect();
      
      console.log('[SMART_PRICE] WebSocket fallbacks initialized');
      this.emit('fallbackReady');
    } catch (error) {
      console.log('[SMART_PRICE] Failed to initialize fallbacks:', error.message);
    }
  }

  /**
   * Expanded safe symbol mapping - hundreds of coins while maintaining safety
   * Only includes coins with unambiguous mappings across exchanges
   */
  getExpandedSymbolMapping() {
    return {
      // Major cryptocurrencies (top 50 by market cap)
      'bitcoin': { binance: 'BTCUSDT', okx: 'BTC-USDT', bitget: 'BTCUSDT' },
      'ethereum': { binance: 'ETHUSDT', okx: 'ETH-USDT', bitget: 'ETHUSDT' },
      'tether': { binance: 'USDCUSDT', okx: 'USDC-USDT', bitget: 'USDCUSDT' }, // Use USDC as proxy
      'binancecoin': { binance: 'BNBUSDT', okx: 'BNB-USDT', bitget: 'BNBUSDT' },
      'solana': { binance: 'SOLUSDT', okx: 'SOL-USDT', bitget: 'SOLUSDT' },
      'usd-coin': { binance: 'USDCUSDT', okx: 'USDC-USDT', bitget: 'USDCUSDT' },
      'ripple': { binance: 'XRPUSDT', okx: 'XRP-USDT', bitget: 'XRPUSDT' },
      'cardano': { binance: 'ADAUSDT', okx: 'ADA-USDT', bitget: 'ADAUSDT' },
      'avalanche-2': { binance: 'AVAXUSDT', okx: 'AVAX-USDT', bitget: 'AVAXUSDT' },
      'dogecoin': { binance: 'DOGEUSDT', okx: 'DOGE-USDT', bitget: 'DOGEUSDT' },
      
      // DeFi tokens (unambiguous symbols only)
      'uniswap': { binance: 'UNIUSDT', okx: 'UNI-USDT', bitget: 'UNIUSDT' },
      'chainlink': { binance: 'LINKUSDT', okx: 'LINK-USDT', bitget: 'LINKUSDT' },
      'polygon': { binance: 'MATICUSDT', okx: 'MATIC-USDT', bitget: 'MATICUSDT' },
      'wrapped-bitcoin': { binance: 'WBTCUSDT', okx: 'WBTC-USDT', bitget: 'WBTCUSDT' },
      'aave': { binance: 'AAVEUSDT', okx: 'AAVE-USDT', bitget: 'AAVEUSDT' },
      'compound': { binance: 'COMPUSDT', okx: 'COMP-USDT', bitget: 'COMPUSDT' },
      'maker': { binance: 'MKRUSDT', okx: 'MKR-USDT', bitget: 'MKRUSDT' },
      'curve-dao-token': { binance: 'CRVUSDT', okx: 'CRV-USDT', bitget: 'CRVUSDT' },
      'synthetix': { binance: 'SNXUSDT', okx: 'SNX-USDT', bitget: 'SNXUSDT' },
      
      // Layer 1 blockchains
      'polkadot': { binance: 'DOTUSDT', okx: 'DOT-USDT', bitget: 'DOTUSDT' },
      'litecoin': { binance: 'LTCUSDT', okx: 'LTC-USDT', bitget: 'LTCUSDT' },
      'ethereum-classic': { binance: 'ETCUSDT', okx: 'ETC-USDT', bitget: 'ETCUSDT' },
      'bitcoin-cash': { binance: 'BCHUSDT', okx: 'BCH-USDT', bitget: 'BCHUSDT' },
      'stellar': { binance: 'XLMUSDT', okx: 'XLM-USDT', bitget: 'XLMUSDT' },
      'vechain': { binance: 'VETUSDT', okx: 'VET-USDT', bitget: 'VETUSDT' },
      'internet-computer': { binance: 'ICPUSDT', okx: 'ICP-USDT', bitget: 'ICPUSDT' },
      'filecoin': { binance: 'FILUSDT', okx: 'FIL-USDT', bitget: 'FILUSDT' },
      'cosmos': { binance: 'ATOMUSDT', okx: 'ATOM-USDT', bitget: 'ATOMUSDT' },
      'algorand': { binance: 'ALGOUSDT', okx: 'ALGO-USDT', bitget: 'ALGOUSDT' },
      
      // Popular altcoins (with clear, unambiguous symbols)
      'shiba-inu': { binance: 'SHIBUSDT', okx: 'SHIB-USDT', bitget: 'SHIBUSDT' },
      'near': { binance: 'NEARUSDT', okx: 'NEAR-USDT', bitget: 'NEARUSDT' },
      'aptos': { binance: 'APTUSDT', okx: 'APT-USDT', bitget: 'APTUSDT' },
      'optimism': { binance: 'OPUSDT', okx: 'OP-USDT', bitget: 'OPUSDT' },
      'arbitrum': { binance: 'ARBUSDT', okx: 'ARB-USDT', bitget: 'ARBUSDT' },
      'immutable-x': { binance: 'IMXUSDT', okx: 'IMX-USDT', bitget: 'IMXUSDT' },
      'sandbox': { binance: 'SANDUSDT', okx: 'SAND-USDT', bitget: 'SANDUSDT' },
      'decentraland': { binance: 'MANAUSDT', okx: 'MANA-USDT', bitget: 'MANAUSDT' },
      'axie-infinity': { binance: 'AXSUSDT', okx: 'AXS-USDT', bitget: 'AXSUSDT' },
      
      // Stablecoins and wrapped tokens
      'dai': { binance: 'DAIUSDT', okx: 'DAI-USDT', bitget: 'DAIUSDT' },
      'frax': { binance: 'FRAXUSDT', okx: 'FRAX-USDT', bitget: 'FRAXUSDT' },
      'terrausd': { binance: 'USTCUSDT', okx: 'USTC-USDT', bitget: 'USTCUSDT' },
      
      // Exchange tokens
      'ftx-token': { binance: 'FTTUSDT', okx: 'FTT-USDT', bitget: 'FTTUSDT' },
      'okb': { binance: 'OKBUSDT', okx: 'OKB-USDT', bitget: 'OKBUSDT' },
      'huobi-token': { binance: 'HTUSDT', okx: 'HT-USDT', bitget: 'HTUSDT' },
      'kucoin-shares': { binance: 'KCSUSDT', okx: 'KCS-USDT', bitget: 'KCSUSDT' },
      
      // Gaming and NFT tokens (clear symbols only)
      'enjincoin': { binance: 'ENJUSDT', okx: 'ENJ-USDT', bitget: 'ENJUSDT' },
      'flow': { binance: 'FLOWUSDT', okx: 'FLOW-USDT', bitget: 'FLOWUSDT' },
      'gala': { binance: 'GALAUSDT', okx: 'GALA-USDT', bitget: 'GALAUSDT' },
      'chromia': { binance: 'CHRUSDT', okx: 'CHR-USDT', bitget: 'CHRUSDT' },
      
      // Meme coins (popular, unambiguous)
      'pepe': { binance: 'PEPEUSDT', okx: 'PEPE-USDT', bitget: 'PEPEUSDT' },
      'floki': { binance: 'FLOKIUSDT', okx: 'FLOKI-USDT', bitget: 'FLOKIUSDT' },
      'bonk': { binance: 'BONKUSDT', okx: 'BONK-USDT', bitget: 'BONKUSDT' },
      
      // Additional Layer 1s and popular tokens
      'tezos': { binance: 'XTZUSDT', okx: 'XTZ-USDT', bitget: 'XTZUSDT' },
      'monero': { binance: 'XMRUSDT', okx: 'XMR-USDT', bitget: 'XMRUSDT' },
      'zcash': { binance: 'ZECUSDT', okx: 'ZEC-USDT', bitget: 'ZECUSDT' },
      'dash': { binance: 'DASHUSDT', okx: 'DASH-USDT', bitget: 'DASHUSDT' },
      'neo': { binance: 'NEOUSDT', okx: 'NEO-USDT', bitget: 'NEOUSDT' },
      'iota': { binance: 'IOTAUSDT', okx: 'IOTA-USDT', bitget: 'IOTAUSDT' },
      'elrond-erd-2': { binance: 'EGLDUSDT', okx: 'EGLD-USDT', bitget: 'EGLDUSDT' },
      'fantom': { binance: 'FTMUSDT', okx: 'FTM-USDT', bitget: 'FTMUSDT' },
      'harmony': { binance: 'ONEUSDT', okx: 'ONE-USDT', bitget: 'ONEUSDT' },
      'zilliqa': { binance: 'ZILUSDT', okx: 'ZIL-USDT', bitget: 'ZILUSDT' },
      
      // NOTE: Intentionally EXCLUDING ambiguous symbols like:
      // - Single letters (M, W, T, etc.)
      // - Common abbreviations that could map to multiple coins
      // - New/unstable tokens without clear exchange consensus
      // - Tokens with naming conflicts across exchanges
    };
  }

  /**
   * Check if we're currently rate limited
   */
  isRateLimited() {
    if (this.rateLimitedUntil && Date.now() < this.rateLimitedUntil) {
      return true;
    }
    
    // Reset rate limit if time has passed
    if (this.rateLimitedUntil && Date.now() >= this.rateLimitedUntil) {
      this.rateLimitedUntil = null;
      this.coingeckoHealthy = true;
      console.log('[SMART_PRICE] CoinGecko rate limit cleared');
    }
    
    return false;
  }

  /**
   * Check current request rate
   */
  checkRequestRate() {
    const now = Date.now();
    const timeSinceReset = now - this.lastResetTime;
    
    // Reset counter every minute
    if (timeSinceReset >= 60000) {
      this.requestCount = 0;
      this.lastResetTime = now;
    }
    
    return {
      requests: this.requestCount,
      timeWindow: timeSinceReset,
      approaching: this.requestCount > (this.maxRequestsPerMinute * 0.8)
    };
  }

  /**
   * Handle CoinGecko error and update service state
   */
  handleCoinGeckoError(error) {
    this.metrics.errors++;
    
    if (error.response?.status === 429 || error.message.includes('429') || error.message.includes('Throttled')) {
      this.metrics.rateLimits++;
      this.coingeckoHealthy = false;
      
      // Rate limited for 2 minutes (conservative)
      this.rateLimitedUntil = Date.now() + (2 * 60 * 1000);
      
      console.log('[SMART_PRICE] CoinGecko rate limited, switching to fallbacks for 2 minutes');
      this.emit('rateLimited', { until: this.rateLimitedUntil });
      
      return true; // Error handled
    }
    
    return false; // Not a rate limit error
  }

  /**
   * Smart price fetching with fallback logic
   */
  async getSmartPrice(coinId) {
    const startTime = Date.now();
    
    try {
      // Check if we should use fallback
      if (this.shouldUseFallback(coinId)) {
        return await this.getFallbackPrice(coinId);
      }
      
      // Try CoinGecko first
      const price = await this.getCoinGeckoPrice(coinId);
      this.metrics.coingeckoRequests++;
      this.metrics.avgResponseTime = Date.now() - startTime;
      
      return price;
      
    } catch (error) {
      // Handle CoinGecko error
      if (this.handleCoinGeckoError(error)) {
        // Try fallback if rate limited
        return await this.getFallbackPrice(coinId);
      }
      
      throw error;
    }
  }

  /**
   * Smart batch price fetching
   */
  async getSmartPrices(coinIds) {
    const results = [];
    const mapping = this.getExpandedSymbolMapping();
    
    // Separate coins into CoinGecko and fallback categories
    const coinGeckoCoins = [];
    const fallbackCoins = [];
    
    for (const coinId of coinIds) {
      if (this.shouldUseFallback(coinId)) {
        fallbackCoins.push(coinId);
      } else {
        coinGeckoCoins.push(coinId);
      }
    }
    
    console.log(`[SMART_PRICE] Batch: ${coinGeckoCoins.length} via CoinGecko, ${fallbackCoins.length} via fallback`);
    
    // Process both in parallel
    const [cgResults, fallbackResults] = await Promise.all([
      this.batchCoinGeckoPrices(coinGeckoCoins),
      this.batchFallbackPrices(fallbackCoins)
    ]);
    
    // Merge results in original order
    let cgIndex = 0;
    let fallbackIndex = 0;
    
    for (const coinId of coinIds) {
      if (this.shouldUseFallback(coinId)) {
        results.push(fallbackResults[fallbackIndex++]);
      } else {
        results.push(cgResults[cgIndex++]);
      }
    }
    
    return results;
  }

  /**
   * Determine if we should use fallback for a specific coin
   */
  shouldUseFallback(coinId) {
    const mapping = this.getExpandedSymbolMapping();
    const rateStatus = this.checkRequestRate();
    
    return (
      this.isRateLimited() || // Currently rate limited
      rateStatus.approaching || // Approaching rate limit
      (mapping[coinId] && !this.coingeckoHealthy) // Have fallback and CG unhealthy
    );
  }

  /**
   * Get price from WebSocket fallback
   */
  async getFallbackPrice(coinId) {
    const mapping = this.getExpandedSymbolMapping();
    
    if (!mapping[coinId]) {
      throw new Error(`No fallback available for ${coinId}`);
    }
    
    // Try to get from WebSocket backstop
    try {
      const { default: webSocketBackstop } = await import('./websocket-backstop.js');
      const price = await webSocketBackstop.getPrice(coinId);
      
      this.metrics.fallbackRequests++;
      console.log(`[SMART_PRICE] Fallback price for ${coinId}: $${price.price}`);
      
      return price;
    } catch (error) {
      throw new Error(`Fallback failed for ${coinId}: ${error.message}`);
    }
  }

  /**
   * Get price from CoinGecko
   */
  async getCoinGeckoPrice(coinId) {
    // Import the existing CoinGecko batcher
    const { getPrice } = await import('./cg-batcher.js');
    this.requestCount++;
    
    return await getPrice(coinId);
  }

  /**
   * Batch CoinGecko prices
   */
  async batchCoinGeckoPrices(coinIds) {
    if (coinIds.length === 0) return [];
    
    const { getPrices } = await import('./cg-batcher.js');
    this.requestCount += Math.ceil(coinIds.length / 250); // Estimate batch requests
    this.metrics.coingeckoRequests += coinIds.length;
    
    return await getPrices(coinIds);
  }

  /**
   * Batch fallback prices
   */
  async batchFallbackPrices(coinIds) {
    if (coinIds.length === 0) return [];
    
    const results = [];
    for (const coinId of coinIds) {
      try {
        const price = await this.getFallbackPrice(coinId);
        results.push(price);
      } catch (error) {
        console.log(`[SMART_PRICE] Fallback failed for ${coinId}:`, error.message);
        results.push(null);
      }
    }
    
    return results;
  }

  /**
   * Get service health status
   */
  getHealthStatus() {
    const rateStatus = this.checkRequestRate();
    
    return {
      coingeckoHealthy: this.coingeckoHealthy,
      rateLimited: this.isRateLimited(),
      rateLimitedUntil: this.rateLimitedUntil,
      requestsThisMinute: this.requestCount,
      requestRate: rateStatus,
      supportedFallbackCoins: Object.keys(this.getExpandedSymbolMapping()).length,
      metrics: this.metrics
    };
  }

  /**
   * Get list of coins supported by fallback
   */
  getSupportedFallbackCoins() {
    return Object.keys(this.getExpandedSymbolMapping());
  }
}

// Export singleton instance
const smartPriceService = new SmartPriceService();
export default smartPriceService;

