import WebSocket from 'ws';
import { EventEmitter } from 'events';

/**
 * Production WebSocket backstop for CoinGecko API failures
 * Only handles major, unambiguous symbols to prevent price errors
 */

class WebSocketBackstop extends EventEmitter {
  constructor() {
    super();
    this.connections = new Map();
    this.priceCache = new Map();
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.connectionCount = 0;
    this.maxConnections = 2; // Conservative limit
    this.banned = false;
  }

  /**
   * Safe symbol mapping - ONLY major, unambiguous coins
   * NO single letters, ambiguous tokens, or new coins
   */
  getSafeSymbolMapping() {
    return {
      'bitcoin': {
        binanceSymbol: 'BTCUSDT',
        coingeckoId: 'bitcoin'
      },
      'ethereum': {
        binanceSymbol: 'ETHUSDT', 
        coingeckoId: 'ethereum'
      },
      'solana': {
        binanceSymbol: 'SOLUSDT',
        coingeckoId: 'solana'
      },
      'binancecoin': {
        binanceSymbol: 'BNBUSDT',
        coingeckoId: 'binancecoin'
      },
      'cardano': {
        binanceSymbol: 'ADAUSDT',
        coingeckoId: 'cardano'
      },
      'avalanche-2': {
        binanceSymbol: 'AVAXUSDT',
        coingeckoId: 'avalanche-2'
      },
      'chainlink': {
        binanceSymbol: 'LINKUSDT',
        coingeckoId: 'chainlink'
      },
      'polygon': {
        binanceSymbol: 'MATICUSDT',
        coingeckoId: 'polygon'
      },
      'uniswap': {
        binanceSymbol: 'UNIUSDT',
        coingeckoId: 'uniswap'
      },
      'litecoin': {
        binanceSymbol: 'LTCUSDT',
        coingeckoId: 'litecoin'
      }
      // ONLY add symbols we're 100% confident about
      // NO PENGU, M, SD, or other ambiguous tokens
    };
  }

  /**
   * Check if a coinId can be safely handled by WebSocket backstop
   */
  canHandle(coinId) {
    if (this.banned) return false;
    const mapping = this.getSafeSymbolMapping();
    return mapping.hasOwnProperty(coinId);
  }

  /**
   * Get supported coin IDs for logging/debugging
   */
  getSupportedCoins() {
    return Object.keys(this.getSafeSymbolMapping());
  }

  /**
   * Connect to Binance WebSocket stream
   */
  async connect() {
    if (this.connectionCount >= this.maxConnections) {
      console.log('[WS_BACKSTOP] Max connections reached, skipping');
      return false;
    }

    if (this.banned) {
      console.log('[WS_BACKSTOP] IP banned, cannot connect');
      return false;
    }

    try {
      console.log('[WS_BACKSTOP] Connecting to Binance WebSocket...');
      
      // Use all tickers stream for efficiency
      const ws = new WebSocket('wss://stream.binance.com:9443/ws/!ticker@arr');
      this.connectionCount++;

      ws.on('open', () => {
        console.log('[WS_BACKSTOP] Connected successfully');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.emit('connected');
      });

      ws.on('message', (data) => {
        try {
          const tickers = JSON.parse(data);
          this.processPriceData(tickers);
        } catch (error) {
          console.log('[WS_BACKSTOP] Parse error:', error.message);
        }
      });

      ws.on('error', (error) => {
        console.log('[WS_BACKSTOP] WebSocket error:', error.message);
        this.handleConnectionError(error);
      });

      ws.on('close', (code, reason) => {
        console.log(`[WS_BACKSTOP] Connection closed: ${code} ${reason}`);
        this.isConnected = false;
        this.connectionCount = Math.max(0, this.connectionCount - 1);
        
        // Check for ban indicators
        if (code === 1006 || code === 1002) {
          console.log('[WS_BACKSTOP] Possible IP ban detected');
          this.banned = true;
          this.emit('banned');
          return;
        }

        this.handleReconnection();
      });

      this.connections.set('binance', ws);
      return true;

    } catch (error) {
      console.log('[WS_BACKSTOP] Connection failed:', error.message);
      this.connectionCount = Math.max(0, this.connectionCount - 1);
      return false;
    }
  }

  /**
   * Process incoming price data from Binance
   */
  processPriceData(tickers) {
    const mapping = this.getSafeSymbolMapping();
    const timestamp = Date.now();
    
    // Only process tickers we safely support
    for (const ticker of tickers) {
      const symbol = ticker.s; // e.g., "BTCUSDT"
      
      // Find matching coinId for this Binance symbol
      for (const [coinId, config] of Object.entries(mapping)) {
        if (config.binanceSymbol === symbol) {
          const price = parseFloat(ticker.c); // Close price
          const change24h = parseFloat(ticker.P); // 24h change percentage
          
          if (price > 0) {
            this.priceCache.set(coinId, {
              price,
              change24h,
              timestamp,
              source: 'binance_websocket',
              symbol: symbol
            });
            
            this.emit('priceUpdate', {
              coinId,
              price,
              change24h,
              source: 'binance_websocket'
            });
          }
          break;
        }
      }
    }
  }

  /**
   * Get price from WebSocket cache (backstop function)
   */
  async getPrice(coinId) {
    if (!this.canHandle(coinId)) {
      throw new Error(`WebSocket backstop cannot handle: ${coinId}`);
    }

    const cached = this.priceCache.get(coinId);
    if (!cached) {
      throw new Error(`No WebSocket price data for: ${coinId}`);
    }

    // Check if data is fresh (max 30 seconds old)
    const age = Date.now() - cached.timestamp;
    if (age > 30000) {
      throw new Error(`WebSocket price data too old for: ${coinId} (${age}ms)`);
    }

    console.log(`[WS_BACKSTOP] Serving ${coinId}: $${cached.price} (${cached.source})`);
    
    return {
      price: cached.price,
      change24h: cached.change24h,
      source: 'binance_websocket',
      timestamp: cached.timestamp
    };
  }

  /**
   * Get prices for multiple coins (batch function)
   */
  async getPrices(coinIds) {
    const results = [];
    
    for (const coinId of coinIds) {
      try {
        if (this.canHandle(coinId)) {
          const price = await this.getPrice(coinId);
          results.push(price);
        } else {
          results.push(null); // Cannot handle this coin
        }
      } catch (error) {
        console.log(`[WS_BACKSTOP] Failed to get price for ${coinId}:`, error.message);
        results.push(null);
      }
    }
    
    return results;
  }

  /**
   * Handle connection errors
   */
  handleConnectionError(error) {
    if (error.message.includes('429') || error.message.includes('banned')) {
      this.banned = true;
      console.log('[WS_BACKSTOP] Rate limited/banned, disabling WebSocket backstop');
    }
  }

  /**
   * Handle reconnection with exponential backoff
   */
  handleReconnection() {
    if (this.banned || this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[WS_BACKSTOP] Max reconnect attempts reached or banned');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    
    console.log(`[WS_BACKSTOP] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      this.connect();
    }, delay);
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    const now = Date.now();
    let freshPrices = 0;
    let stalePrices = 0;
    
    for (const cached of this.priceCache.values()) {
      const age = now - cached.timestamp;
      if (age <= 30000) {
        freshPrices++;
      } else {
        stalePrices++;
      }
    }
    
    return {
      connected: this.isConnected,
      banned: this.banned,
      totalCached: this.priceCache.size,
      freshPrices,
      stalePrices,
      supportedCoins: this.getSupportedCoins().length,
      connectionCount: this.connectionCount
    };
  }

  /**
   * Disconnect and cleanup
   */
  disconnect() {
    console.log('[WS_BACKSTOP] Disconnecting...');
    
    for (const ws of this.connections.values()) {
      ws.close();
    }
    
    this.connections.clear();
    this.priceCache.clear();
    this.isConnected = false;
    this.connectionCount = 0;
  }
}

// Export singleton instance
const webSocketBackstop = new WebSocketBackstop();
export default webSocketBackstop;

