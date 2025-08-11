import axios from 'axios';
import { resolveCoinId, resolveMany } from './resolve.js';
import { getCoinGeckoConfig } from './resolver-advanced.js';

export async function fetchUsdPrice(ticker) {
  const input = ticker.toLowerCase().trim();
  
  // Handle stablecoins at fixed $1.00
  if (input === 'usdt' || input === 'usdc') return 1.0;
  
  // Use the resolver to get the correct CoinGecko ID
  const coinId = await resolveCoinId(input);
  
  if (!coinId) {
    throw new Error(`Could not find coin for "${ticker}". Try common tickers like btc, eth, sol, doge, shib, pepe`);
  }
  
  try {
    const config = getCoinGeckoConfig();
    const q = encodeURIComponent(coinId);
    const { data } = await axios.get(`${config.baseURL}/simple/price?ids=${q}&vs_currencies=usd`, { 
      timeout: config.timeout,
      headers: config.headers
    });
    
    if (!data[coinId] || data[coinId]?.usd == null) {
      throw new Error(`Price not found for ${ticker}`);
    }
    
    return Number(data[coinId].usd);
  } catch (error) {
    console.error(`Error fetching price for ${ticker} (${coinId}):`, error.message);
    throw new Error(`Failed to fetch price for ${ticker}. Try again later.`);
  }
}

/** Batch fetch prices for multiple tickers */
export async function getPricesForTickers(tickers) {
  // Normalize tickers
  const normalizedTickers = tickers.map(t => t.toLowerCase().trim());
  
  // Handle stablecoins first
  const stablecoins = new Set(['usdt', 'usdc']);
  const results = {};
  
  // Set stablecoin prices
  normalizedTickers.forEach((ticker, i) => {
    if (stablecoins.has(ticker)) {
      results[tickers[i]] = { usd: 1.0 };
    }
  });
  
  // Filter out stablecoins for API request
  const nonStableTickers = normalizedTickers.filter(t => !stablecoins.has(t));
  const originalNonStableTickers = tickers.filter((_, i) => !stablecoins.has(normalizedTickers[i]));
  
  if (nonStableTickers.length === 0) {
    return results;
  }
  
  // Resolve coin IDs
  const coinIds = await resolveMany(nonStableTickers);
  const validIds = coinIds.filter(Boolean);
  
  if (validIds.length === 0) {
    return results;
  }
  
  try {
    const config = getCoinGeckoConfig();
    // Batch request to CoinGecko
    const { data } = await axios.get(`${config.baseURL}/simple/price`, {
      params: {
        ids: validIds.join(","),
        vs_currencies: "usd",
        include_24hr_change: true,
        include_market_cap: true,
        precision: "full"
      },
      headers: config.headers,
      timeout: config.timeout,
    });
    
    // Map results back to original tickers
    originalNonStableTickers.forEach((ticker, i) => {
      const coinId = coinIds[i];
      if (coinId && data[coinId]) {
        results[ticker] = data[coinId];
      } else {
        results[ticker] = null;
      }
    });
  } catch (error) {
    console.error("Batch price fetch error:", error.message);
  }
  
  return results;
}