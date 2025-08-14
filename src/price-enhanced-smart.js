// Enhanced price-smart.js - Drop-in replacement with advanced resolver
import axios from 'axios';
import smartResolver from './smart-resolver-v2.js';
import { getCoinGeckoConfig } from './cg-batcher.js';

// Adapter to match the expected resolveQuery interface
async function resolveQuery(rawQuery) {
  const result = await smartResolver.resolve(rawQuery.trim().toLowerCase());
  if (result) {
    return { type: 'coin', id: result };
  }
  return { type: 'none', reason: 'not_found' };
}

// Cache for search results (1 hour) and price data (1 minute)
const searchCache = new Map();
const priceCache = new Map();
const SEARCH_CACHE_DURATION = 60 * 60 * 1000; // 1 hour
const PRICE_CACHE_DURATION = 60 * 1000; // 1 minute
let lastPriceCall = 0;

async function rateLimit() {
  const now = Date.now();
  const timeSince = now - lastPriceCall;
  if (timeSince < 1100) { // 1.1 second between calls
    await new Promise(resolve => setTimeout(resolve, 1100 - timeSince));
  }
  lastPriceCall = Date.now();
}

/**
 * Enhanced coin data fetching with advanced resolver
 * Maintains the same interface as the original fetchCoinData
 */
export async function fetchCoinData(ticker) {
  const input = ticker.toLowerCase().trim();
  
  // Handle stablecoins at fixed $1.00
  if (input === 'usdt' || input === 'usdc') {
    const result = {
      price: 1.0,
      change24h: 0,
      marketCap: null,
      method: 'fixed-stablecoin',
      source: 'hardcoded'
    };
    
    // Log provenance for anomaly detection
    const { shortVersion } = await import('./version.js');
    console.log(JSON.stringify({
      evt: 'price_reply',
      q: ticker,
      coinId: input,
      method: result.method,
      source: result.source,
      ts: Date.now(),
      v: shortVersion
    }));
    
    return result;
  }
  
  // Check price cache first
  const cacheKey = input;
  const now = Date.now();
  if (priceCache.has(cacheKey)) {
    const cached = priceCache.get(cacheKey);
    if (now - cached.timestamp < PRICE_CACHE_DURATION) {
      console.log(`Cache hit: ${ticker}`);
      return cached.data;
    }
  }
  
  try {
    // Use the advanced resolver to get coin ID
    const resolution = await resolveQuery(input);
    
    let coinId;
    let isPair = false;
    
    if (resolution.type === 'pair') {
      // For pairs like "btcusdt", just get the base coin price
      coinId = resolution.baseId;
      isPair = true;
      console.log(`Pair detected: ${ticker} → base coin: ${coinId}`);
    } else if (resolution.type === 'coin') {
      coinId = resolution.id;
      console.log(`Resolved: ${ticker} → ${coinId}`);
    } else {
      throw new Error(`Could not resolve ticker "${ticker}"`);
    }
    
    // Debug trace for resolution
    console.log(JSON.stringify({
      evt: 'resolve_trace',
      raw: ticker,
      out: { coinId, method: resolution.type },
      ts: Date.now()
    }));
    
    // Rate limit API calls
    await rateLimit();
    
    // Get CoinGecko config (handles Pro API automatically)
    const config = getCoinGeckoConfig();
    
    const q = encodeURIComponent(coinId);
    
    try {
      // Get both price data and coin metadata in parallel
      const [priceResponse, coinResponse] = await Promise.all([
        axios.get(`${config.baseURL}/simple/price?ids=${q}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&precision=full`, { 
          timeout: config.timeout,
          headers: config.headers
        }),
        axios.get(`${config.baseURL}/coins/${coinId}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`, {
          timeout: config.timeout,
          headers: config.headers
        })
      ]);
      
      const priceData = priceResponse.data;
      const coinData = coinResponse.data;
      
      if (!priceData[coinId] || priceData[coinId]?.usd == null) {
        console.error(JSON.stringify({ evt: 'cg_null', token: ticker, coinId, ts: Date.now() }));
        throw new Error(`price not found for ${ticker}`);
      }
    
    const coin = priceData[coinId];
    const result = {
      price: Number(coin.usd),
      change24h: Number(coin.usd_24h_change || 0),
      marketCap: coin.usd_market_cap ? Number(coin.usd_market_cap) : null,
      coinId: coinId, // Return the actual coin ID used
      coinName: coinData.name || null, // Add coin name for disambiguation
      symbol: coinData.symbol?.toUpperCase() || ticker.toUpperCase(), // Actual symbol from CoinGecko
      isPair: isPair, // Flag if this was resolved from a pair
      resolvedFrom: resolution.type === 'pair' ? `${ticker} (pair)` : ticker,
      method: resolution.type === 'pair' ? 'pair-resolution' : 'canonical-or-search',
      source: 'coingecko-rest'
    };
    
    // Log provenance for anomaly detection
    const { shortVersion } = await import('./version.js');
    console.log(JSON.stringify({
      evt: 'price_reply',
      q: ticker,
      coinId,
      method: result.method,
      source: result.source,
      ts: Date.now(),
      v: shortVersion
    }));
    
    // Cache the result
    priceCache.set(cacheKey, {
      data: result,
      timestamp: now
    });
    
    return result;
    } catch (cgError) {
      console.error(JSON.stringify({ evt: 'cg_error', token: ticker, msg: String(cgError), ts: Date.now() }));
      throw cgError;
    }
  } catch (error) {
    console.error(`Enhanced price fetch failed for ${ticker}:`, error.message);
    
    // Try to return stale cache if available (max 5 minutes old for fairness)
    if (priceCache.has(cacheKey)) {
      const stale = priceCache.get(cacheKey);
      const ageMinutes = Math.floor((now - stale.timestamp) / 60000);
      if (ageMinutes <= 5) {
        console.log(`Using stale cache for ${ticker} (${ageMinutes}m old)`);
        // Add age info to the returned data so it can be displayed
        return { ...stale.data, isStale: true, ageMinutes };
      } else {
        console.log(`Stale cache too old for ${ticker} (${ageMinutes}m), rejecting`);
      }
    }
    
    // Provide more specific error messages
    if (error.message.includes('429') || error.message.includes('rate limit')) {
      throw new Error(`rate limited for ${ticker} - try again in 1 minute`);
    }
    
    if (error.message.includes('no_match')) {
      throw new Error(`ticker not found: ${ticker}. try common tickers like btc, eth, sol, doge, or add "stablecoin" for USDC/DAI`);
    }
    
    if (error.message.includes('base_not_found')) {
      throw new Error(`could not find base asset in pair "${ticker}". try a clearer ticker`);
    }
    
    // Check if user entered a contract address instead of ticker
    if (ticker.startsWith('0x') && ticker.length === 42) {
      throw new Error(`Contract addresses not supported. Please use ticker symbols like BTC, ETH, SOL instead of ${ticker}`);
    }
    
    throw new Error(`price not found for ${ticker}. try common tickers like btc, eth, sol, doge, shib, pepe`);
  }
}

/**
 * Simple price fetching - maintains exact same interface
 */
export async function fetchUsdPrice(ticker) {
  const coinData = await fetchCoinData(ticker);
  return coinData.price;
}

/**
 * Batch price fetching for multiple tickers
 * Enhanced to handle pairs and use advanced resolver
 */
export async function fetchMultiplePrices(tickers) {
  const results = [];
  
  for (let i = 0; i < tickers.length; i++) {
    const ticker = tickers[i];
    try {
      const coinData = await fetchCoinData(ticker);
      results.push({
        ticker: ticker,
        success: true,
        data: coinData
      });
    } catch (error) {
      results.push({
        ticker: ticker,
        success: false,
        error: error.message
      });
    }
    
    // Rate limiting between requests
    if (i < tickers.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  
  return results;
}

/**
 * Debug function to see what the resolver would pick
 */
export async function debugResolve(ticker) {
  try {
    const resolution = await resolveQuery(ticker);
    return {
      input: ticker,
      resolution,
      success: true
    };
  } catch (error) {
    return {
      input: ticker,
      error: error.message,
      success: false
    };
  }
}

// Legacy compatibility - maintain the same cache clearing functions if needed
export function clearPriceCache() {
  priceCache.clear();
  console.log('Price cache cleared');
}

export function clearSearchCache() {
  searchCache.clear();
  console.log('Search cache cleared');
}