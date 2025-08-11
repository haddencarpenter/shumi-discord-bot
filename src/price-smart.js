import axios from 'axios';

// Cache for search results (1 hour)
const searchCache = new Map();
const CACHE_DURATION = 60 * 60 * 1000;

// Basic mappings for very common tickers to avoid API calls
const COMMON_TICKERS = {
  'btc': 'bitcoin',
  'eth': 'ethereum',
  'bnb': 'binancecoin',
  'xrp': 'ripple',
  'ada': 'cardano', 
  'sol': 'solana',
  'doge': 'dogecoin',
  'dot': 'polkadot',
  'matic': 'matic-network',
  'link': 'chainlink',
  'uni': 'uniswap',
  'ltc': 'litecoin',
  'avax': 'avalanche-2',
  'atom': 'cosmos',
  'shib': 'shiba-inu',
  'pepe': 'pepe',
  'usdt': 'tether',
  'usdc': 'usd-coin',
  'mog': 'mog-coin',
  'pengu': 'pudgy-penguins',
  'brett': 'based-brett',
  'ena': 'ethena',
  'hype': 'hyperliquid',
  'ray': 'raydium'
};

async function searchCoin(ticker) {
  const cacheKey = ticker.toLowerCase();
  const now = Date.now();
  
  // Check cache first
  if (searchCache.has(cacheKey)) {
    const cached = searchCache.get(cacheKey);
    if (now - cached.timestamp < CACHE_DURATION) {
      return cached.results;
    }
  }
  
  try {
    const { data } = await axios.get(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(ticker)}`, {
      timeout: 5000
    });
    
    // Cache the results
    searchCache.set(cacheKey, {
      results: data.coins || [],
      timestamp: now
    });
    
    return data.coins || [];
  } catch (error) {
    console.warn(`Search failed for ${ticker}:`, error.message);
    return [];
  }
}

function rankCoinMatches(ticker, coins) {
  const input = ticker.toLowerCase();
  
  return coins.map(coin => {
    let score = 0;
    const symbol = coin.symbol.toLowerCase();
    const name = coin.name.toLowerCase();
    
    // Exact symbol match gets highest score (must always win)
    if (symbol === input) score += 10000;
    
    // Partial symbol match
    if (symbol.includes(input)) score += 50;
    
    // Name contains ticker
    if (name.includes(input)) score += 25;
    
    // Higher market cap rank = better score
    if (coin.market_cap_rank) {
      score += Math.max(0, 1000 - coin.market_cap_rank);
    }
    
    // Prefer coins with lower market cap rank (higher market cap)
    if (coin.market_cap_rank && coin.market_cap_rank <= 100) score += 500;
    if (coin.market_cap_rank && coin.market_cap_rank <= 500) score += 200;
    
    return { ...coin, score };
  }).sort((a, b) => b.score - a.score);
}

async function findBestCoinId(ticker) {
  const input = ticker.toLowerCase();
  
  // Check common tickers first (bypass search entirely)
  if (COMMON_TICKERS[input]) {
    console.log(`✅ Direct mapping: ${ticker} → ${COMMON_TICKERS[input]}`);
    return COMMON_TICKERS[input];
  }
  
  try {
    // Search CoinGecko
    const searchResults = await searchCoin(ticker);
    if (!searchResults.length) {
      console.log(`❌ No search results for "${ticker}"`);
      return ticker; // Fallback to original input
    }
    
    // Rank matches by relevance
    const rankedCoins = rankCoinMatches(ticker, searchResults);
    
    // For ambiguous cases, prefer the highest ranked coin
    const bestMatch = rankedCoins[0];
    
    console.log(`🔍 Search "${ticker}": Found ${searchResults.length} matches, using "${bestMatch.name}" (${bestMatch.symbol}) - Rank #${bestMatch.market_cap_rank || 'N/A'}`);
    
    return bestMatch.id;
  } catch (error) {
    console.error(`Search error for ${ticker}:`, error.message);
    // If search fails, try direct ticker
    return ticker;
  }
}

export async function fetchUsdPrice(ticker) {
  const coinData = await fetchCoinData(ticker);
  return coinData.price;
}

export async function fetchCoinData(ticker) {
  const input = ticker.toLowerCase().trim();
  
  // Handle stablecoins at fixed $1.00
  if (input === 'usdt' || input === 'usdc') {
    return {
      price: 1.0,
      change24h: 0,
      marketCap: null
    };
  }
  
  try {
    // Find best matching coin ID
    const coinId = await findBestCoinId(input);
    
    const q = encodeURIComponent(coinId);
    const { data } = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${q}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`, { 
      timeout: 5000
    });
    
    const k = Object.keys(data)[0];
    if (!k || data[k]?.usd == null) {
      throw new Error(`price not found for ${ticker}`);
    }
    
    const coin = data[k];
    return {
      price: Number(coin.usd),
      change24h: Number(coin.usd_24h_change || 0),
      marketCap: coin.usd_market_cap ? Number(coin.usd_market_cap) : null,
      coinId: k // Return the actual coin ID used
    };
  } catch (error) {
    console.error(`Price fetch failed for ${ticker}:`, error.message);
    throw new Error(`price not found for ${ticker}. try common tickers like btc, eth, sol, doge, shib, pepe`);
  }
}