import axios from 'axios';

// Cache for coin list (refreshed every hour)
let coinListCache = null;
let lastFetch = 0;
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

// Basic ticker map for common coins (fallback)
const BASIC_TICKER_MAP = {
  'btc': 'bitcoin',
  'eth': 'ethereum', 
  'bnb': 'binancecoin',
  'xrp': 'ripple',
  'ada': 'cardano',
  'sol': 'solana',
  'doge': 'dogecoin',
  'dot': 'polkadot',
  'matic': 'matic-network',
  'shib': 'shiba-inu',
  'avax': 'avalanche-2',
  'ltc': 'litecoin',
  'link': 'chainlink',
  'uni': 'uniswap',
  'atom': 'cosmos',
  'etc': 'ethereum-classic',
  'xlm': 'stellar',
  'bch': 'bitcoin-cash',
  'fil': 'filecoin',
  'trx': 'tron',
  'vet': 'vechain',
  'icp': 'internet-computer',
  'ftm': 'fantom',
  'algo': 'algorand',
  'xmr': 'monero',
  'aave': 'aave',
  'mkr': 'maker',
  'theta': 'theta-token',
  'pepe': 'pepe',
  'mog': 'mog-coin',
  'brett': 'based-brett',
  'rpl': 'rocket-pool',
  'usdt': 'tether',
  'usdc': 'usd-coin'
};

async function fetchCoinList() {
  try {
    const { data } = await axios.get('https://api.coingecko.com/api/v3/coins/list', { timeout: 10000 });
    return data;
  } catch (error) {
    console.warn('Failed to fetch coin list from CoinGecko:', error.message);
    return null;
  }
}

async function getCoinId(ticker) {
  const input = ticker.toLowerCase().trim();
  
  // Check basic map first
  if (BASIC_TICKER_MAP[input]) {
    return BASIC_TICKER_MAP[input];
  }
  
  // Try to get comprehensive coin list
  const now = Date.now();
  if (!coinListCache || (now - lastFetch) > CACHE_DURATION) {
    console.log('Refreshing coin list cache...');
    const newList = await fetchCoinList();
    if (newList) {
      coinListCache = newList;
      lastFetch = now;
    }
  }
  
  if (coinListCache) {
    // Search by symbol (ticker)
    const bySymbol = coinListCache.find(coin => coin.symbol.toLowerCase() === input);
    if (bySymbol) return bySymbol.id;
    
    // Search by name
    const byName = coinListCache.find(coin => coin.name.toLowerCase() === input);
    if (byName) return byName.id;
    
    // Partial name match
    const partialMatch = coinListCache.find(coin => 
      coin.name.toLowerCase().includes(input) || coin.id.toLowerCase().includes(input)
    );
    if (partialMatch) return partialMatch.id;
  }
  
  // Return original input as last resort
  return input;
}

export async function fetchUsdPrice(ticker) {
  const input = ticker.toLowerCase().trim();
  
  // Handle stablecoins at fixed $1.00
  if (input === 'usdt' || input === 'usdc') return 1.0;
  
  try {
    const coinId = await getCoinId(input);
    const q = encodeURIComponent(coinId);
    const { data } = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${q}&vs_currencies=usd`, { timeout: 8000 });
    
    const k = Object.keys(data)[0];
    if (!k || data[k]?.usd == null) {
      throw new Error(`price not found for ${ticker}`);
    }
    
    return Number(data[k].usd);
  } catch (error) {
    throw new Error(`price not found for ${ticker}. try common tickers like btc, eth, sol, doge, shib, pepe`);
  }
}