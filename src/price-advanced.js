// price-advanced.js - Integration with the advanced resolver
import { resolveQuery } from './resolver-advanced.js';
import axios from 'axios';

/**
 * Enhanced price fetcher using the advanced resolver
 * @param {string} query - User query (can be ticker, pair, or natural language)
 * @returns {Promise<Object>} Price data and metadata
 */
export async function fetchAdvancedPrice(query) {
  try {
    const result = await resolveQuery(query);
    
    if (result.type === 'pair') {
      // Handle trading pair requests
      return await fetchPairPrice(result.baseId, result.quote);
    }
    
    if (result.type === 'coin') {
      // Handle single coin requests
      return await fetchCoinPrice(result.id);
    }
    
    // Handle resolution failures
    if (result.type === 'none') {
      throw new Error(getErrorMessage(result.reason, query));
    }
    
  } catch (error) {
    console.error(`Advanced price fetch error for "${query}":`, error.message);
    throw error;
  }
}

/**
 * Fetch price for a trading pair
 * @param {string} baseId - CoinGecko ID of base asset
 * @param {string} quote - Quote currency (USDT, USDC, etc.)
 * @returns {Promise<Object>}
 */
async function fetchPairPrice(baseId, quote) {
  const coinData = await fetchCoinPrice(baseId);
  
  return {
    type: 'pair',
    baseId,
    baseName: coinData.name,
    baseSymbol: coinData.symbol,
    quote: quote.toUpperCase(),
    price: coinData.price,
    change24h: coinData.change24h,
    marketCap: coinData.marketCap,
    volume24h: coinData.volume24h,
    displayText: `${coinData.symbol.toUpperCase()}/${quote} = $${coinData.price.toFixed(getDecimalPlaces(coinData.price))}`
  };
}

/**
 * Get CoinGecko API configuration
 * @returns {Object} API config with headers and base URL
 */
function getCoinGeckoConfig() {
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

/**
 * Fetch price for a single coin using Pro API
 * @param {string} coinId - CoinGecko ID
 * @returns {Promise<Object>}
 */
async function fetchCoinPrice(coinId) {
  const config = getCoinGeckoConfig();
  
  const { data } = await axios.get(`${config.baseURL}/simple/price`, {
    params: {
      ids: coinId,
      vs_currencies: 'usd',
      include_24hr_change: true,
      include_market_cap: true,
      include_24hr_vol: true,
      precision: 'full'
    },
    headers: config.headers,
    timeout: config.timeout
  });
  
  if (!data[coinId]) {
    throw new Error(`Price data not available for ${coinId}`);
  }
  
  const coinData = data[coinId];
  
  // Get additional coin info (name, symbol) from a separate call if needed
  let name = coinId;
  let symbol = coinId;
  
  try {
    const { data: coinInfo } = await axios.get(`${config.baseURL}/coins/${coinId}`, {
      params: { 
        localization: false, 
        tickers: false, 
        market_data: false, 
        community_data: false, 
        developer_data: false,
        sparkline: false
      },
      headers: config.headers,
      timeout: config.timeout
    });
    name = coinInfo.name;
    symbol = coinInfo.symbol;
  } catch (error) {
    // Fallback to just using the price data
    console.warn(`Could not fetch coin info for ${coinId}, using fallback`);
  }
  
  return {
    type: 'coin',
    id: coinId,
    name,
    symbol: symbol.toUpperCase(),
    price: coinData.usd,
    change24h: coinData.usd_24h_change || 0,
    marketCap: coinData.usd_market_cap,
    volume24h: coinData.usd_24h_vol,
    displayText: `${symbol.toUpperCase()} = $${coinData.usd.toFixed(getDecimalPlaces(coinData.usd))}${coinData.usd_24h_change ? ` (${coinData.usd_24h_change > 0 ? '+' : ''}${coinData.usd_24h_change.toFixed(2)}%)` : ''}`
  };
}

/**
 * Get appropriate decimal places for price display
 * @param {number} price
 * @returns {number}
 */
function getDecimalPlaces(price) {
  if (price >= 100) return 2;
  if (price >= 1) return 4;
  if (price >= 0.01) return 6;
  return 8;
}

/**
 * Generate helpful error messages
 * @param {string} reason
 * @param {string} query
 * @returns {string}
 */
function getErrorMessage(reason, query) {
  switch (reason) {
    case 'base_not_found':
      return `Could not find the base asset in "${query}". Try a clearer ticker.`;
    case 'no_match':
      return `No clear match found for "${query}". Try common tickers like BTC, ETH, SOL, or add "stablecoin" if you want USDC/DAI.`;
    default:
      return `Could not resolve "${query}". Try a different ticker or be more specific.`;
  }
}

/**
 * Batch fetch prices for multiple queries
 * @param {string[]} queries
 * @returns {Promise<Object[]>}
 */
export async function fetchAdvancedPrices(queries) {
  const results = [];
  
  for (const query of queries) {
    try {
      const result = await fetchAdvancedPrice(query);
      results.push({ query, success: true, data: result });
    } catch (error) {
      results.push({ query, success: false, error: error.message });
    }
  }
  
  return results;
}

// Export for Discord command integration
export default fetchAdvancedPrice;