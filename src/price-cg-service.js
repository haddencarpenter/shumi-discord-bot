// src/price-cg-service.js
// Unified price service that combines symbol index + CG batcher
// Provides clean interface for cashtag-based price requests

import { resolveSymbolToId, getIndexInfo } from './symbol-index.js';
import { getPrice, getPrices } from './cg-batcher.js';

/**
 * Parse cashtag from user input
 * Returns symbol without the $ prefix, or null if not a cashtag
 */
function parseCashtag(input) {
  const trimmed = input.trim();
  if (trimmed.startsWith('$') && trimmed.length > 1) {
    return trimmed.substring(1).toLowerCase();
  }
  return null;
}

/**
 * Extract all cashtags from a message
 * Returns array of symbols (without $ prefix)
 */
export function extractCashtags(message) {
  if (!message || typeof message !== 'string') {
    return [];
  }
  
  // Match $SYMBOL patterns (letters, numbers, basic symbols, 1-15 chars)
  const cashtagRegex = /\$([a-zA-Z0-9]+(?:[._-][a-zA-Z0-9]+)*)/g;
  const matches = [];
  let match;
  
  while ((match = cashtagRegex.exec(message)) !== null) {
    const symbol = match[1].toLowerCase();
    if (symbol.length >= 1 && symbol.length <= 15) {
      matches.push(symbol);
    }
  }
  
  // Remove duplicates while preserving order
  return [...new Set(matches)];
}

/**
 * Get price data for a single cashtag
 */
export async function getPriceForCashtag(cashtag) {
  // Parse cashtag
  const symbol = parseCashtag(cashtag) || cashtag.toLowerCase();
  
  // Resolve symbol to coin ID using symbol index
  const resolution = resolveSymbolToId(symbol);
  if (!resolution) {
    throw new Error(`Unknown symbol: $${symbol.toUpperCase()}. Try common symbols like $BTC, $ETH, $SOL`);
  }
  
  const { coinId, method, source } = resolution;
  
  try {
    // Get price data from batcher (automatically cached and batched)
    const priceData = await getPrice(coinId);
    
    // Log structured data for monitoring
    const { shortVersion } = await import('./version.js');
    console.log(JSON.stringify({
      evt: 'price_reply',
      q: `$${symbol.toUpperCase()}`,
      coinId,
      method: 'cashtag',
      source: priceData.source,
      ts: Date.now(),
      v: shortVersion
    }));
    
    return {
      symbol: symbol.toUpperCase(),
      coinId,
      price: priceData.price,
      change24h: priceData.change24h,
      marketCap: priceData.marketCap,
      method: 'cashtag',
      source: priceData.source,
      resolverSource: source
    };
    
  } catch (error) {
    console.error(`Price fetch failed for $${symbol.toUpperCase()}:`, error.message);
    throw new Error(`Price not available for $${symbol.toUpperCase()}: ${error.message}`);
  }
}

/**
 * Get price data using mixed strategy (Option C)
 * Tries symbol index first, falls back to old resolver with encouragement
 */
export async function getPricesWithFallback(tokens, strategy) {
  const results = [];
  const needsFallback = [];
  
  // Try symbol index resolution first
  for (const token of tokens) {
    const { symbol } = token;
    const resolution = resolveSymbolToId(symbol);
    
    if (resolution) {
      results.push({
        symbol: symbol.toUpperCase(),
        token,
        resolution,
        needsFallback: false
      });
    } else {
      results.push({
        symbol: symbol.toUpperCase(),
        token,
        resolution: null,
        needsFallback: true
      });
      needsFallback.push(token);
    }
  }
  
  // For tokens not in symbol index, try fallback resolver
  if (needsFallback.length > 0 && strategy === 'fallback') {
    // Import the old resolver for fallback
    const smartResolver = await import('./smart-resolver-v2.js');
    
    for (const token of needsFallback) {
      try {
        const coinId = await smartResolver.default.resolve(token.symbol);
        if (coinId) {
          // Update the result with fallback resolution
          const resultIndex = results.findIndex(r => r.symbol === token.symbol.toUpperCase());
          if (resultIndex >= 0) {
            results[resultIndex].resolution = {
              coinId,
              method: 'fallback-search',
              source: 'coingecko-search'
            };
            results[resultIndex].needsFallback = false;
          }
        }
      } catch (error) {
        console.error(`Fallback resolution failed for ${token.symbol}:`, error.message);
      }
    }
  }
  
  // Get prices for all resolved tokens
  const coinIds = results
    .filter(r => r.resolution)
    .map(r => r.resolution.coinId);
  
  const priceResults = coinIds.length > 0 ? await getPrices(coinIds) : [];
  
  // Combine with price data
  const finalResults = [];
  let priceIndex = 0;
  
  for (const result of results) {
    const { symbol, token, resolution, needsFallback } = result;
    
    if (!resolution || needsFallback) {
      finalResults.push({
        symbol,
        token: token.type === 'cashtag' ? `$${symbol}` : symbol.toLowerCase(),
        success: false,
        error: token.type === 'cashtag' 
          ? `Unknown symbol: $${symbol}` 
          : `Unknown: ${symbol.toLowerCase()}. Try cashtags like $BTC $ETH`,
        strategy
      });
      continue;
    }
    
    const priceData = priceResults[priceIndex++];
    
    if (!priceData) {
      finalResults.push({
        symbol,
        token: token.type === 'cashtag' ? `$${symbol}` : symbol.toLowerCase(),
        success: false,
        error: `Price not available for ${symbol}`,
        strategy
      });
      continue;
    }
    
    finalResults.push({
      symbol,
      token: token.type === 'cashtag' ? `$${symbol}` : symbol.toLowerCase(),
      coinId: resolution.coinId,
      success: true,
      price: priceData.price,
      change24h: priceData.change24h,
      marketCap: priceData.marketCap,
      method: resolution.method,
      source: priceData.source,
      resolverSource: resolution.source,
      strategy,
      // No per-message encouragement - we'll update help command instead
      encouragement: null
    });
  }
  
  // Log the request for monitoring
  const { shortVersion } = await import('./version.js');
  const successCount = finalResults.filter(r => r.success).length;
  console.log(JSON.stringify({
    evt: 'mixed_price_reply',
    strategy,
    count: finalResults.length,
    successful: successCount,
    fallbackUsed: strategy === 'fallback',
    ts: Date.now(),
    v: shortVersion
  }));
  
  return finalResults;
}

/**
 * Get price data for multiple cashtags
 * Efficiently batches all requests
 */
export async function getPricesForCashtags(cashtags) {
  if (!Array.isArray(cashtags) || cashtags.length === 0) {
    return [];
  }
  
  // Resolve all symbols to coin IDs
  const resolutions = [];
  const coinIds = [];
  const validCashtags = [];
  
  for (const cashtag of cashtags) {
    const symbol = parseCashtag(cashtag) || cashtag.toLowerCase();
    const resolution = resolveSymbolToId(symbol);
    
    if (resolution) {
      resolutions.push({ symbol, resolution });
      coinIds.push(resolution.coinId);
      validCashtags.push(cashtag);
    } else {
      resolutions.push({ symbol, resolution: null });
      coinIds.push(null);
      validCashtags.push(cashtag);
    }
  }
  
  // Get all prices in one batch
  const priceResults = await getPrices(coinIds.filter(id => id !== null));
  
  // Combine resolutions with price data
  const results = [];
  let priceIndex = 0;
  
  for (let i = 0; i < resolutions.length; i++) {
    const { symbol, resolution } = resolutions[i];
    const originalCashtag = cashtags[i];
    
    if (!resolution) {
      results.push({
        symbol: symbol.toUpperCase(),
        cashtag: originalCashtag,
        success: false,
        error: `Unknown symbol: $${symbol.toUpperCase()}`
      });
      continue;
    }
    
    const priceData = priceResults[priceIndex++];
    
    if (!priceData) {
      results.push({
        symbol: symbol.toUpperCase(),
        cashtag: originalCashtag,
        success: false,
        error: `Price not available for $${symbol.toUpperCase()}`
      });
      continue;
    }
    
    results.push({
      symbol: symbol.toUpperCase(),
      cashtag: originalCashtag,
      coinId: resolution.coinId,
      success: true,
      price: priceData.price,
      change24h: priceData.change24h,
      marketCap: priceData.marketCap,
      method: 'cashtag',
      source: priceData.source,
      resolverSource: resolution.source
    });
  }
  
  // Log batch request for monitoring
  const { shortVersion } = await import('./version.js');
  const successCount = results.filter(r => r.success).length;
  console.log(JSON.stringify({
    evt: 'batch_price_reply',
    count: results.length,
    successful: successCount,
    cashtags: cashtags.map(c => c.startsWith('$') ? c : `$${c}`),
    ts: Date.now(),
    v: shortVersion
  }));
  
  return results;
}

/**
 * Parse mixed input (cashtags + plain text) - Option C approach
 * Tries cashtags first, falls back to plain text with encouragement
 */
export function parseInputTokens(message) {
  if (!message || typeof message !== 'string') {
    return { tokens: [], strategy: 'none' };
  }
  
  // Extract cashtags first
  const cashtags = extractCashtags(message);
  
  if (cashtags.length > 0) {
    // Found cashtags - use pure cashtag strategy
    if (cashtags.length > 6) {
      return {
        tokens: [],
        strategy: 'error',
        error: 'Too many symbols. Please request up to 6 at a time.'
      };
    }
    
    return {
      tokens: cashtags.map(symbol => ({ type: 'cashtag', symbol })),
      strategy: 'cashtag'
    };
  }
  
  // No cashtags found - try to parse as plain text symbols
  const plainTokens = message
    .toLowerCase()
    .split(/\s+/)
    .filter(token => token.length > 0 && token.length <= 15)
    .filter(token => /^[a-z0-9]+$/.test(token)) // Only alphanumeric
    .slice(0, 6); // Limit to 6
  
  if (plainTokens.length === 0) {
    return {
      tokens: [],
      strategy: 'error',
      error: 'Please specify symbols like $BTC, $ETH, $SOL. Example: `shumi price $BTC $ETH`'
    };
  }
  
  return {
    tokens: plainTokens.map(symbol => ({ type: 'plain', symbol })),
    strategy: 'fallback'
  };
}

/**
 * Get service status information
 */
export function getServiceInfo() {
  const indexInfo = getIndexInfo();
  
  return {
    symbolIndex: {
      size: indexInfo.size,
      ageHours: indexInfo.ageHours,
      nextUpdateHours: indexInfo.nextUpdateHours,
      source: indexInfo.source,
      isStale: indexInfo.isStale
    },
    priceCache: {
      // Cache stats would come from cg-batcher
    },
    version: '2.0-cashtag'
  };
}

/**
 * Format price data for Discord display (handles mixed results)
 */
export function formatPriceForDiscord(priceResult) {
  if (!priceResult.success) {
    return `${priceResult.token}: ${priceResult.error}`;
  }
  
  const { symbol, price, change24h, marketCap, encouragement } = priceResult;
  
  // Format price with appropriate precision
  let priceStr;
  if (price >= 1000) {
    priceStr = `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  } else if (price >= 1) {
    priceStr = `$${price.toFixed(4)}`;
  } else if (price >= 0.001) {
    priceStr = `$${price.toFixed(6)}`;
  } else {
    priceStr = `$${price.toExponential(3)}`;
  }
  
  // Format 24h change with emoji
  const changeStr = change24h >= 0 ? `+${change24h.toFixed(2)}%` : `${change24h.toFixed(2)}%`;
  const changeEmoji = change24h >= 0 ? '🟢' : '🔴';
  
  // Format market cap
  let mcapStr = '';
  if (marketCap) {
    if (marketCap >= 1e9) {
      mcapStr = ` • $${(marketCap / 1e9).toFixed(1)}B`;
    } else if (marketCap >= 1e6) {
      mcapStr = ` • $${(marketCap / 1e6).toFixed(1)}M`;
    }
  }
  
  // Main price line
  let result = `**$${symbol}** ${priceStr} ${changeEmoji} ${changeStr}${mcapStr}`;
  
  // Add encouragement if present
  if (encouragement) {
    result += `\n${encouragement}`;
  }
  
  return result;
}

/**
 * Create summary encouragement message for fallback strategy
 * Now returns null - we'll teach in help command instead
 */
export function createEncouragementMessage(results, strategy) {
  // No per-message encouragement - help command is better place to teach
  return null;
}

/**
 * Get service status for debugging (internal use only)
 */
export function getDebugInfo() {
  const indexInfo = getIndexInfo();
  return {
    resolver: 'cashtag',
    source: indexInfo.source,
    version: process.env.npm_package_version || 'dev'
  };
}
