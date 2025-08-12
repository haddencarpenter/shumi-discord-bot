/**
 * DEPRECATED: Do not import this directly.
 * It re-exports the unified rules-as-data resolver.
 */
export * from './resolve.js';

// Legacy functions still needed by price-enhanced-smart.js
export function getCoinGeckoConfig() {
  const apiKey = process.env.COINGECKO_API_KEY;
  
  if (apiKey) {
    // Pro API configuration
    return {
      baseURL: 'https://pro-api.coingecko.com/api/v3',
      headers: {
        'User-Agent': 'shumi-bot/1.0',
        'x-cg-pro-api-key': apiKey
      },
      timeout: 10000
    };
  } else {
    // Free API configuration  
    return {
      baseURL: 'https://api.coingecko.com/api/v3',
      headers: {
        'User-Agent': 'shumi-bot/1.0'
      },
      timeout: 8000
    };
  }
}

// Legacy shim for resolveQuery - routes to our fixed resolver
export async function resolveQuery(rawQuery, opts = {}) {
  const { resolveCoinId } = await import('./resolve.js');
  const shimResult = await resolveCoinId(rawQuery.trim().toLowerCase());
  if (shimResult) {
    console.log(`✅ Resolved: ${rawQuery} → ${shimResult}`);
    return { type: 'coin', id: shimResult };
  }
  return { type: 'none', reason: 'not_found' };
}