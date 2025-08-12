// src/cg-batcher.js
// CoinGecko request batcher and cache
// Coalesces multiple price requests into single API calls

import axios from 'axios';

// Batching configuration
const BATCH_WINDOW_MS = 50; // Wait 50ms to collect requests
const MAX_BATCH_SIZE = 250; // CoinGecko supports up to 250 IDs per request
const CACHE_TTL_MS = 30 * 1000; // Cache prices for 30 seconds

// State management
const priceCache = new Map(); // coinId -> {price, change24h, marketCap, timestamp}
const pendingRequests = new Map(); // coinId -> Promise
let batchQueue = new Set(); // coinIds waiting to be batched
let batchTimer = null;

/**
 * Get CoinGecko API configuration
 */
function getCoinGeckoConfig() {
  const apiKey = process.env.COINGECKO_API_KEY;
  
  if (apiKey) {
    return {
      baseURL: 'https://pro-api.coingecko.com/api/v3',
      headers: { 'x-cg-pro-api-key': apiKey },
      timeout: 10000
    };
  } else {
    return {
      baseURL: 'https://api.coingecko.com/api/v3',
      headers: { 'User-Agent': 'shumi-bot/2.0' },
      timeout: 10000
    };
  }
}

/**
 * Check if cached data is still valid
 */
function isCacheValid(cacheEntry) {
  return cacheEntry && (Date.now() - cacheEntry.timestamp < CACHE_TTL_MS);
}

/**
 * Execute a batch request to CoinGecko
 */
async function executeBatch(coinIds) {
  const config = getCoinGeckoConfig();
  const idsParam = coinIds.join(',');
  
  console.log(`Batching price request for ${coinIds.length} coins: ${idsParam.substring(0, 100)}${idsParam.length > 100 ? '...' : ''}`);
  
  try {
    const { data } = await axios.get(`${config.baseURL}/simple/price`, {
      params: {
        ids: idsParam,
        vs_currencies: 'usd',
        include_24hr_change: true,
        include_market_cap: true,
        precision: 'full'
      },
      headers: config.headers,
      timeout: config.timeout
    });
    
    const timestamp = Date.now();
    const results = new Map();
    
    // Process successful results
    for (const coinId of coinIds) {
      if (data[coinId] && data[coinId].usd !== null && data[coinId].usd !== undefined) {
        const result = {
          price: Number(data[coinId].usd),
          change24h: Number(data[coinId].usd_24h_change || 0),
          marketCap: data[coinId].usd_market_cap ? Number(data[coinId].usd_market_cap) : null,
          timestamp,
          source: config.baseURL.includes('pro-api') ? 'coingecko-pro' : 'coingecko-free'
        };
        
        // Cache the result
        priceCache.set(coinId, result);
        results.set(coinId, result);
      } else {
        // Mark as not found
        results.set(coinId, null);
      }
    }
    
    console.log(`Batch completed: ${results.size} results, ${Array.from(results.values()).filter(r => r !== null).length} successful`);
    return results;
    
  } catch (error) {
    console.error(`Batch request failed:`, error.message);
    
    // Return error for all requested coins
    const errorResults = new Map();
    for (const coinId of coinIds) {
      errorResults.set(coinId, new Error(`API error: ${error.message}`));
    }
    return errorResults;
  }
}

/**
 * Process the current batch queue
 */
async function processBatch() {
  if (batchQueue.size === 0) return;
  
  const coinsToFetch = Array.from(batchQueue);
  batchQueue.clear();
  batchTimer = null;
  
  // Split into chunks if too many coins
  const chunks = [];
  for (let i = 0; i < coinsToFetch.length; i += MAX_BATCH_SIZE) {
    chunks.push(coinsToFetch.slice(i, i + MAX_BATCH_SIZE));
  }
  
  // Execute all chunks in parallel
  const chunkPromises = chunks.map(chunk => executeBatch(chunk));
  const chunkResults = await Promise.all(chunkPromises);
  
  // Combine results from all chunks
  const allResults = new Map();
  for (const chunkResult of chunkResults) {
    for (const [coinId, result] of chunkResult) {
      allResults.set(coinId, result);
    }
  }
  
  // Resolve all pending promises
  for (const [coinId, result] of allResults) {
    const pendingPromise = pendingRequests.get(coinId);
    if (pendingPromise) {
      pendingRequests.delete(coinId);
      
      if (result instanceof Error) {
        pendingPromise.reject(result);
      } else if (result === null) {
        pendingPromise.reject(new Error(`Price not found for ${coinId}`));
      } else {
        pendingPromise.resolve(result);
      }
    }
  }
}

/**
 * Get price for a single coin ID
 * Automatically batches requests and caches results
 */
export async function getPrice(coinId) {
  if (!coinId || typeof coinId !== 'string') {
    throw new Error('Invalid coin ID');
  }
  
  // Check cache first
  const cached = priceCache.get(coinId);
  if (isCacheValid(cached)) {
    console.log(`Cache hit: ${coinId}`);
    return cached;
  }
  
  // Check if already pending
  if (pendingRequests.has(coinId)) {
    console.log(`Request pending: ${coinId}`);
    return pendingRequests.get(coinId).promise;
  }
  
  // Create new pending request
  let resolvePromise, rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  
  pendingRequests.set(coinId, {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise
  });
  
  // Add to batch queue
  batchQueue.add(coinId);
  
  // Schedule batch processing if not already scheduled
  if (!batchTimer) {
    batchTimer = setTimeout(processBatch, BATCH_WINDOW_MS);
  }
  
  return promise;
}

/**
 * Get prices for multiple coin IDs
 * Returns array in same order as input, with null for failed requests
 */
export async function getPrices(coinIds) {
  if (!Array.isArray(coinIds) || coinIds.length === 0) {
    return [];
  }
  
  // Filter out invalid coin IDs
  const validCoinIds = coinIds.filter(id => id && typeof id === 'string');
  
  if (validCoinIds.length === 0) {
    return new Array(coinIds.length).fill(null);
  }
  
  console.log(`Batch price request for ${validCoinIds.length} coins`);
  
  // Request all prices (will be automatically batched)
  const pricePromises = validCoinIds.map(async (coinId, index) => {
    try {
      const price = await getPrice(coinId);
      return { index: coinIds.indexOf(coinId), price };
    } catch (error) {
      console.error(`Failed to get price for ${coinId}:`, error.message);
      return { index: coinIds.indexOf(coinId), price: null };
    }
  });
  
  const results = await Promise.all(pricePromises);
  
  // Reconstruct array in original order
  const orderedResults = new Array(coinIds.length).fill(null);
  for (const { index, price } of results) {
    orderedResults[index] = price;
  }
  
  return orderedResults;
}

/**
 * Clear the price cache
 */
export function clearCache() {
  priceCache.clear();
  console.log('Price cache cleared');
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
  const now = Date.now();
  let validEntries = 0;
  let staleEntries = 0;
  
  for (const entry of priceCache.values()) {
    if (isCacheValid(entry)) {
      validEntries++;
    } else {
      staleEntries++;
    }
  }
  
  return {
    totalEntries: priceCache.size,
    validEntries,
    staleEntries,
    hitRate: priceCache.size > 0 ? Math.round((validEntries / priceCache.size) * 100) : 0,
    pendingRequests: pendingRequests.size,
    queuedForBatch: batchQueue.size
  };
}

/**
 * Force process any pending batch (useful for testing)
 */
export async function flushBatch() {
  if (batchTimer) {
    clearTimeout(batchTimer);
    await processBatch();
  }
}
