// src/symbol-index.js
// Dynamic symbol index built from CoinGecko markets data
// NO hardcoded mappings - everything comes from live CG data

import axios from 'axios';
import { CANONICAL } from './resolve.js';

// In-memory symbol index
let symbolIndex = new Map(); // symbol -> coinId
let indexMetadata = {
  size: 0,
  lastUpdated: null,
  nextUpdate: null,
  source: 'none'
};

const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
const TOP_COINS_COUNT = 300;

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
 * Build symbol index from CoinGecko markets data
 * ONE API call per day for top 300 coins by market cap
 */
export async function buildSymbolIndex(force = false) {
  const now = Date.now();
  
  // Check if we need to update
  if (!force && indexMetadata.lastUpdated && (now - indexMetadata.lastUpdated < CACHE_DURATION)) {
    console.log(`Symbol index current (${indexMetadata.size} symbols, ${Math.floor((now - indexMetadata.lastUpdated) / 1000 / 60)}m old)`);
    return indexMetadata;
  }

  console.log(`Building symbol index from CoinGecko markets (top ${TOP_COINS_COUNT})...`);
  
  try {
    const config = getCoinGeckoConfig();
    
    // Single API call to get top 300 coins by market cap
    const { data } = await axios.get(`${config.baseURL}/coins/markets`, {
      params: {
        vs_currency: 'usd',
        order: 'market_cap_desc',
        per_page: TOP_COINS_COUNT,
        page: 1,
        sparkline: false,
        price_change_percentage: '24h'
      },
      headers: config.headers,
      timeout: config.timeout
    });

    // Clear old index
    symbolIndex.clear();
    
    // Build new index: symbol -> highest market cap coinId
    const symbolConflicts = new Map(); // Track conflicts for logging
    
    for (const coin of data) {
      const symbol = coin.symbol.toLowerCase();
      const coinId = coin.id;
      const marketCapRank = coin.market_cap_rank || 9999;
      
      if (symbolIndex.has(symbol)) {
        // Conflict: keep the one with better market cap rank (lower number = better)
        const existingCoinId = symbolIndex.get(symbol);
        const existingCoin = data.find(c => c.id === existingCoinId);
        const existingRank = existingCoin?.market_cap_rank || 9999;
        
        if (marketCapRank < existingRank) {
          // New coin has better rank, replace
          symbolIndex.set(symbol, coinId);
          symbolConflicts.set(symbol, { winner: coinId, loser: existingCoinId, reason: 'better_market_cap' });
        } else {
          // Keep existing coin, log conflict
          symbolConflicts.set(symbol, { winner: existingCoinId, loser: coinId, reason: 'worse_market_cap' });
        }
      } else {
        // No conflict, add new mapping
        symbolIndex.set(symbol, coinId);
      }
    }
    
    // Update metadata
    indexMetadata = {
      size: symbolIndex.size,
      lastUpdated: now,
      nextUpdate: now + CACHE_DURATION,
      source: config.baseURL.includes('pro-api') ? 'coingecko-pro' : 'coingecko-free',
      conflicts: symbolConflicts.size,
      topCoinsCount: TOP_COINS_COUNT
    };
    
    console.log(`Symbol index built: ${indexMetadata.size} symbols from ${data.length} coins`);
    if (symbolConflicts.size > 0) {
      console.log(`Resolved ${symbolConflicts.size} symbol conflicts by market cap ranking`);
      
      // Log a few examples for debugging
      const examples = Array.from(symbolConflicts.entries()).slice(0, 3);
      for (const [symbol, conflict] of examples) {
        console.log(`  ${symbol}: chose ${conflict.winner} over ${conflict.loser} (${conflict.reason})`);
      }
    }
    
    return indexMetadata;
    
  } catch (error) {
    console.error('Failed to build symbol index:', error.message);
    
    // If we have stale data, keep using it
    if (symbolIndex.size > 0) {
      console.log(`Keeping stale symbol index (${indexMetadata.size} symbols)`);
      return indexMetadata;
    }
    
    throw new Error(`Symbol index build failed: ${error.message}`);
  }
}

/**
 * Resolve a symbol to a CoinGecko coin ID
 * Uses the cached symbol index - no API calls
 */
export function resolveSymbolToId(symbol) {
  const normalizedSymbol = symbol.toLowerCase().trim();
  
  // Check CANONICAL mapping first (takes precedence over symbol index)
  if (CANONICAL[normalizedSymbol]) {
    return {
      coinId: CANONICAL[normalizedSymbol],
      method: 'canonical',
      source: 'manual-override'
    };
  }
  
  if (symbolIndex.has(normalizedSymbol)) {
    return {
      coinId: symbolIndex.get(normalizedSymbol),
      method: 'symbol-index',
      source: indexMetadata.source
    };
  }
  
  return null;
}

/**
 * Get information about the current symbol index
 */
export function getIndexInfo() {
  const now = Date.now();
  const ageHours = indexMetadata.lastUpdated ? Math.floor((now - indexMetadata.lastUpdated) / 1000 / 60 / 60) : null;
  const nextUpdateHours = indexMetadata.nextUpdate ? Math.floor((indexMetadata.nextUpdate - now) / 1000 / 60 / 60) : null;
  
  return {
    ...indexMetadata,
    ageHours,
    nextUpdateHours: Math.max(0, nextUpdateHours || 0),
    isStale: ageHours ? ageHours >= 24 : false
  };
}

/**
 * Schedule automatic daily refresh of symbol index
 */
export function scheduleIndexRefresh() {
  const REFRESH_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
  
  setInterval(async () => {
    try {
      console.log('Scheduled symbol index refresh starting...');
      await buildSymbolIndex(true);
      console.log('Scheduled symbol index refresh completed');
    } catch (error) {
      console.error('Scheduled symbol index refresh failed:', error.message);
    }
  }, REFRESH_INTERVAL);
  
  console.log('Symbol index refresh scheduled (every 24 hours)');
}

/**
 * Get all symbols in the index (for debugging)
 */
export function getAllSymbols() {
  return Array.from(symbolIndex.keys()).sort();
}

/**
 * Search for symbols matching a pattern (for debugging)
 */
export function searchSymbols(pattern) {
  const regex = new RegExp(pattern, 'i');
  const matches = [];
  
  for (const [symbol, coinId] of symbolIndex.entries()) {
    if (regex.test(symbol) || regex.test(coinId)) {
      matches.push({ symbol, coinId });
    }
  }
  
  return matches.slice(0, 10); // Limit results
}
