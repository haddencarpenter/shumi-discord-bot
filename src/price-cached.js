import axios from 'axios';

const cache = new Map(); // key: ids string => { t, data }
const TTL_MS = 60_000; // 1 minute cache
let lastCall = 0;

async function rateGate() {
  const now = Date.now();
  const wait = Math.max(0, 1000 - (now - lastCall)); // 1 second between calls
  if (wait) await new Promise(r => setTimeout(r, wait));
  lastCall = Date.now();
}

export async function fetchMany(idsArr) {
  const ids = idsArr.join(',');
  const hit = cache.get(ids);
  if (hit && Date.now() - hit.t < TTL_MS) return hit.data;

  await rateGate();
  const url = `https://api.coingecko.com/api/v3/simple/price`;
  const params = {
    ids, 
    vs_currencies: 'usd',
    include_24hr_change: true,
    include_market_cap: true
  };
  const headers = { 'User-Agent': 'shumi-bot/1.0 (discord trading competition)' };

  // Retry with backoff on 429
  for (const delay of [0, 300, 600, 1200]) {
    try {
      if (delay) await new Promise(r => setTimeout(r, delay));
      const { data } = await axios.get(url, { params, headers, timeout: 8000 });
      cache.set(ids, { t: Date.now(), data });
      return data;
    } catch (e) {
      if (!(e.response && e.response.status === 429)) throw e;
      console.log(`[CoinGecko] 429 rate limit, retrying in ${delay}ms...`);
    }
  }

  // Fall back to stale cache if available
  if (hit) {
    console.log(`[CoinGecko] Using stale cache for ${ids}`);
    return hit.data;
  }
  throw new Error('CoinGecko 429 rate limit exceeded');
}

export async function fetchUsdPrice(ticker) {
  const input = ticker.toLowerCase().trim();
  
  // Handle stablecoins at fixed $1.00
  if (input === 'usdt' || input === 'usdc') return 1.0;
  
  // Common ticker mapping
  const TICKER_MAP = {
    'btc': 'bitcoin', 'eth': 'ethereum', 'bnb': 'binancecoin', 'xrp': 'ripple',
    'ada': 'cardano', 'sol': 'solana', 'dot': 'polkadot', 'doge': 'dogecoin',
    'avax': 'avalanche-2', 'matic': 'matic-network', 'link': 'chainlink',
    'uni': 'uniswap', 'ltc': 'litecoin', 'atom': 'cosmos', 'etc': 'ethereum-classic',
    'xlm': 'stellar', 'bch': 'bitcoin-cash', 'fil': 'filecoin', 'trx': 'tron',
    'vet': 'vechain', 'icp': 'internet-computer', 'theta': 'theta-token',
    'ftm': 'fantom', 'algo': 'algorand', 'xmr': 'monero', 'egld': 'elrond-erd-2',
    'aave': 'aave', 'eos': 'eos', 'axs': 'axie-infinity', 'mkr': 'maker',
    'shib': 'shiba-inu', 'pepe': 'pepe', 'floki': 'floki', 'mog': 'mog-coin',
    'wojak': 'wojak', 'turbo': 'turbo', 'bonk': 'bonk', 'wif': 'dogwifcoin',
    'popcat': 'popcat', 'neiro': 'first-neiro-on-ethereum', 'pnut': 'peanut-the-squirrel',
    'goat': 'goatseus-maximus', 'mew': 'cat-in-a-dogs-world', 'brett': 'based-brett',
    'cake': 'pancakeswap-token', 'sushi': 'sushi', 'comp': 'compound-governance-token'
  };
  
  const coinId = TICKER_MAP[input] || input;
  
  try {
    const data = await fetchMany([coinId]);
    const coinData = data[coinId];
    if (!coinData || coinData.usd == null) throw new Error(`price not found for ${ticker}`);
    return Number(coinData.usd);
  } catch (error) {
    // If mapping failed, try the raw ticker as backup
    if (coinId !== input) {
      try {
        const data = await fetchMany([input]);
        const coinData = data[input];
        if (coinData && coinData.usd != null) {
          return Number(coinData.usd);
        }
      } catch {}
    }
    throw new Error(`price not found for ${ticker}. try common tickers like btc, eth, sol, doge, shib, pepe`);
  }
}

export async function fetchCoinData(ticker) {
  const input = ticker.toLowerCase().trim();
  
  // Handle stablecoins
  if (input === 'usdt' || input === 'usdc') {
    return { price: 1.0, change24h: 0, marketCap: null };
  }
  
  // Same mapping as above
  const TICKER_MAP = {
    'btc': 'bitcoin', 'eth': 'ethereum', 'bnb': 'binancecoin', 'xrp': 'ripple',
    'ada': 'cardano', 'sol': 'solana', 'dot': 'polkadot', 'doge': 'dogecoin',
    'avax': 'avalanche-2', 'matic': 'matic-network', 'link': 'chainlink',
    'uni': 'uniswap', 'ltc': 'litecoin', 'atom': 'cosmos', 'etc': 'ethereum-classic',
    'xlm': 'stellar', 'bch': 'bitcoin-cash', 'fil': 'filecoin', 'trx': 'tron',
    'vet': 'vechain', 'icp': 'internet-computer', 'theta': 'theta-token',
    'ftm': 'fantom', 'algo': 'algorand', 'xmr': 'monero', 'egld': 'elrond-erd-2',
    'aave': 'aave', 'eos': 'eos', 'axs': 'axie-infinity', 'mkr': 'maker',
    'shib': 'shiba-inu', 'pepe': 'pepe', 'floki': 'floki', 'mog': 'mog-coin',
    'wojak': 'wojak', 'turbo': 'turbo', 'bonk': 'bonk', 'wif': 'dogwifcoin',
    'popcat': 'popcat', 'neiro': 'first-neiro-on-ethereum', 'pnut': 'peanut-the-squirrel',
    'goat': 'goatseus-maximus', 'mew': 'cat-in-a-dogs-world', 'brett': 'based-brett',
    'cake': 'pancakeswap-token', 'sushi': 'sushi', 'comp': 'compound-governance-token'
  };
  
  const coinId = TICKER_MAP[input] || input;
  
  try {
    const data = await fetchMany([coinId]);
    const coinData = data[coinId];
    if (!coinData) throw new Error(`coin not found for ${ticker}`);
    
    return {
      price: coinData.usd ?? 0,
      change24h: coinData.usd_24h_change ?? 0,
      marketCap: coinData.usd_market_cap ?? null
    };
  } catch (error) {
    // If mapping failed, try the raw ticker as backup
    if (coinId !== input) {
      try {
        const data = await fetchMany([input]);
        const coinData = data[input];
        if (coinData) {
          return {
            price: coinData.usd ?? 0,
            change24h: coinData.usd_24h_change ?? 0,
            marketCap: coinData.usd_market_cap ?? null
          };
        }
      } catch {}
    }
    throw new Error(`coin not found for ${ticker}`);
  }
}