import axios from 'axios';

// Common ticker to CoinGecko ID mapping
const TICKER_MAP = {
  // Stablecoins
  'usdt': 'tether',
  'usdc': 'usd-coin',
  'dai': 'dai',
  'busd': 'binance-usd',
  
  // Major coins
  'btc': 'bitcoin',
  'eth': 'ethereum',
  'bnb': 'binancecoin',
  'xrp': 'ripple',
  'ada': 'cardano',
  'sol': 'solana',
  'dot': 'polkadot',
  'doge': 'dogecoin',
  'avax': 'avalanche-2',
  'matic': 'matic-network',
  'link': 'chainlink',
  'uni': 'uniswap',
  'ltc': 'litecoin',
  'atom': 'cosmos',
  'etc': 'ethereum-classic',
  'xlm': 'stellar',
  'bch': 'bitcoin-cash',
  'fil': 'filecoin',
  'trx': 'tron',
  'vet': 'vechain',
  'icp': 'internet-computer',
  'theta': 'theta-token',
  'ftm': 'fantom',
  'algo': 'algorand',
  'xmr': 'monero',
  'egld': 'elrond-erd-2',
  'aave': 'aave',
  'eos': 'eos',
  'axs': 'axie-infinity',
  'mkr': 'maker',
  'kcs': 'kucoin-shares',
  'btt': 'bittorrent',
  'hbar': 'hedera-hashgraph',
  'flow': 'flow',
  'iota': 'iota',
  'xtz': 'tezos',
  'bsv': 'bitcoin-cash-sv',
  'neo': 'neo',
  'kda': 'kadena',
  'mina': 'mina-protocol',
  'rune': 'thorchain',
  'qnt': 'quant-network',
  'gala': 'gala',
  'chz': 'chiliz',
  'sand': 'the-sandbox',
  'mana': 'decentraland',
  'cro': 'crypto-com-chain',
  'lrc': 'loopring',
  'bat': 'basic-attention-token',
  'zec': 'zcash',
  'enj': 'enjincoin',
  'omg': 'omisego',
  'sushi': 'sushi',
  'comp': 'compound-governance-token',
  'snx': 'havven',
  'yfi': 'yearn-finance',
  'uma': 'uma',
  '1inch': '1inch',
  'crv': 'curve-dao-token',
  'ren': 'republic-protocol',
  'knc': 'kyber-network-crystal',
  'zrx': '0x',
  'storj': 'storj',
  'bal': 'balancer',
  'nmr': 'numeraire',
  'lpt': 'livepeer',
  
  // Meme coins and trending
  'shib': 'shiba-inu',
  'pepe': 'pepe',
  'floki': 'floki',
  'mog': 'mog-coin',
  'wojak': 'wojak',
  'turbo': 'turbo',
  'pepe2': 'pepe-2-0',
  'bonk': 'bonk',
  'wif': 'dogwifcoin',
  'popcat': 'popcat',
  'neiro': 'first-neiro-on-ethereum',
  'pnut': 'peanut-the-squirrel',
  'goat': 'goatseus-maximus',
  'mew': 'cat-in-a-dogs-world',
  'brett': 'based-brett',
  'giga': 'giga',
  'slerf': 'slerf',
  'bome': 'book-of-meme',
  'rpl': 'rocket-pool',
  'act': 'achain',
  'pork': 'pork',
  'sigma': 'sigma',
  'wen': 'wen-4',
  'billy': 'billy',
  'ponke': 'ponke',
  'retardio': 'retardio',
  'higher': 'higher',
  'mother': 'mother-iggy',
  'daddy': 'daddy-tate',
  'eliza': 'elizas-world',
  'virtual': 'virtuals-protocol',
  'ai16z': 'ai16z',
  'zerebro': 'zerebro',
  'griffain': 'griffain',
  'fartcoin': 'fartcoin',
  'chillguy': 'just-a-chill-guy',
  'ban': 'banana-gun',
  'luce': 'luce',
  'chud': 'chud',
  
  // DeFi tokens
  'cake': 'pancakeswap-token',
  'mdx': 'mdex',
  'dydx': 'dydx',
  'gmx': 'gmx',
  'joe': 'trader-joe',
  'png': 'pangolin',
  'quick': 'quickswap',
  'alpha': 'alpha-finance',
  'xvs': 'venus',
  'for': 'forta',
  'spell': 'spell-token',
  'ice': 'ice-token',
  'time': 'wonderland',
  'klima': 'klima-dao',
  'ohm': 'olympus',
  'fxs': 'frax-share',
  'cvx': 'convex-finance',
  'badger': 'badger-dao',
  'fox': 'shapeshift-fox-token',
  'tribe': 'tribe-2',
  'fei': 'fei-usd',
  'alcx': 'alchemix',
  'mim': 'magic-internet-money',
  'frax': 'frax',
  'lusd': 'liquity-usd',
  'rai': 'rai',
  'ftt': 'ftx-token',
  'srm': 'serum',
  'ray': 'raydium',
  'orca': 'orca',
  'cope': 'cope',
  'rope': 'rope-token',
  'step': 'step-finance',
  'media': 'media-network',
  'maps': 'maps',
  'like': 'likecoin',
  'sam': 'samoyedcoin',
  'ninja': 'ninja-protocol',
  'grape': 'grape-2',
  'basis': 'basis-cash',
  'mith': 'mithril',
  'port': 'port-finance',
  'tulip': 'tulip-protocol',
  'slrs': 'solaris',
  'sbr': 'saber',
  'mer': 'mercurial',
  'larix': 'larix',
  'slim': 'solanium',
  'aleph': 'aleph',
  'kuro': 'kurobi',
  'sunny': 'sunny-aggregator',
  'crema': 'crema-finance',
  'cwar': 'cryowar-token',
  'real': 'real-realm',
  'prism': 'prism-protocol',
  'polis': 'star-atlas-dao',
  'atlas': 'star-atlas',
  'dfl': 'defi-land',
  'slnd': 'solend',
  'mngo': 'mango-markets',
  'jet': 'jet-protocol',
  'psyfi': 'psychedelic',
  'apys': 'apyswap',
  'zbc': 'zebec-protocol',
  'mean': 'mean-finance',
  'hub': 'hubble',
  'uri': 'uri-finance',
  'dxl': 'dexlab',
  'rope': 'rope-token',
  'upfi': 'upfi-network'
};

export async function fetchUsdPrice(ticker) {
  const input = ticker.toLowerCase().trim();
  
  // Handle stablecoins at fixed $1.00 (override mapping)
  if (input === 'usdt' || input === 'usdc') return 1.0;
  
  // Try ticker mapping first, fallback to raw input
  const coinId = TICKER_MAP[input] || input;
  
  try {
    const q = encodeURIComponent(coinId);
    const { data } = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${q}&vs_currencies=usd`, { timeout: 8000 });
    const k = Object.keys(data)[0];
    if (!k || data[k]?.usd == null) throw new Error(`price not found for ${ticker}`);
    return Number(data[k].usd);
  } catch (error) {
    // If mapping failed, try the raw ticker as backup
    if (coinId !== input) {
      try {
        const q = encodeURIComponent(input);
        const { data } = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${q}&vs_currencies=usd`, { timeout: 8000 });
        const k = Object.keys(data)[0];
        if (k && data[k]?.usd != null) {
          return Number(data[k].usd);
        }
      } catch {}
    }
    throw new Error(`price not found for ${ticker}. try common tickers like btc, eth, sol, doge, shib, pepe`);
  }
}