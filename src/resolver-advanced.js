// resolver-advanced.js
import axios from 'axios';

// Type definitions as JSDoc comments for clarity
/**
 * @typedef {Object} ResolveFlags
 * @property {boolean} include_wrapped
 * @property {boolean} include_staked
 * @property {boolean} include_bridged
 * @property {boolean} include_stablecoins
 * @property {boolean} force_exact
 */

/**
 * @typedef {Object} CoinCandidate
 * @property {string} id
 * @property {string} symbol
 * @property {string} name
 * @property {string[]} [categories]
 * @property {number} [market_cap_rank]
 */

/**
 * @typedef {Object} ResolveResult
 * @property {'pair'|'coin'|'none'} type
 * @property {string} [baseId]
 * @property {string} [quote]
 * @property {string} [id]
 * @property {string} [reason]
 */

const CANONICAL = {
  // Major cryptocurrencies
  btc:'bitcoin', xbt:'bitcoin', eth:'ethereum', sol:'solana', link:'chainlink',
  ada:'cardano', avax:'avalanche-2', bnb:'binancecoin', doge:'dogecoin', trx:'tron',
  pol:'polygon-ecosystem-token', matic:'polygon-ecosystem-token', ltc:'litecoin',
  uni:'uniswap', arb:'arbitrum', op:'optimism', ldo:'lido-dao', dot:'polkadot',
  atom:'cosmos', xrp:'ripple', algo:'algorand', near:'near', ftm:'fantom',
  xlm:'stellar', vet:'vechain', icp:'internet-computer', fil:'filecoin',
  apt:'aptos', sui:'sui', sei:'sei-network', inj:'injective-protocol',
  tia:'celestia', syn:'synapse-2', multi:'multichain', any:'anyswap',
  pengu:'pudgy-penguins', // Pudgy Penguins NFT token
  
  // Single-letter tickers (comprehensive mapping to avoid ambiguity)
  w:'wormhole',           // Wormhole governance token
  x:'x',                  // X token (if exists, or can map to specific project)
  z:'zcash',              // Zcash (ZEC actually, but Z might be used)
  t:'threshold-network-token', // Threshold Network Token
  n:'numeraire',          // Numeraire (NMR, but N used sometimes)
  s:'synthetix-network-token', // Synthetix (SNX, but S sometimes used)
  r:'revain',             // Revain token
  q:'quant-network',      // Quant (QNT, but Q sometimes used)
  p:'protocol',           // Protocol tokens (can be ambiguous, may need specific)
  o:'origin-protocol',    // Origin Protocol (OGN)
  m:'mirror-protocol',    // Mirror Protocol
  l:'chainlink',          // Link (alternative ticker)
  k:'kyber-network-crystal', // Kyber (KNC)
  j:'jupiter',            // Jupiter (JUP, newer)
  i:'internet-computer',  // Internet Computer (ICP alternative)
  h:'helium',             // Helium (HNT)
  g:'the-graph',          // The Graph (GRT)
  f:'fetch-ai',           // Fetch.ai (FET)
  e:'enjincoin',          // Enjin Coin (ENJ)
  d:'dogecoin',           // Dogecoin (alternative)
  c:'celsius-degree-token', // Celsius (CEL)
  b:'bancor',             // Bancor Network Token
  a:'aave',               // Aave (alternative to AAVE)
  
  // Stablecoins and major tokens (in case of single letter usage)
  u:'uniswap',            // Uniswap (UNI alternative)
  v:'vechain',            // VeChain (VET alternative)
  y:'yearn-finance',      // Yearn.finance (YFI)
};

const QUOTES = [
  'usdt','usdc','busd','fdusd','tusd','dai','pyusd','gusd','usde','usdp',
  'usdd','usdj','gho','crvusd','lusd','eurt','eurc','xsgd'
];

const STABLES_CORE = new Set([
  'tether','usdt','usd-coin','usdc','dai','tusd','usdp','paxos-standard','gusd','frax',
  'lusd','fdusd','pyusd','usdd','usdj','ust','terrausd','ustc','gho','crvusd','susd',
  'eurt','eurc','eure','xsgd','usde','ageur','cusd'
]);

const BLOCKED_IDS = new Set([
  'weth','wrapped-ether','wrapped-bitcoin','wbtc','binance-wrapped-btc',
  'binance-peg-ethereum','binance-peg-bitcoin','wrapped-steth','staked-ether','steth',
  'coinbase-wrapped-staked-eth','wrapped-avax','wrapped-bnb','wrapped-matic','wmatic',
  'wrapped-fantom','wrapped-solana','wsol','ethereum-wormhole','bitcoin-wormhole',
  'solana-wormhole','polygon-bridged-usdc','arbitrum-bridged-usdc','optimism-bridged-eth',
  'bridged-usdc','bridged-usdt','bridged-dai','multichain-bridged-usdc',
  'multichain-bridged-btc','multichain-bridged-eth','synapse-bridged-usdc',
  'synapse-bridged-usdt','anyswap-eth','anyswap-btc','anyswap-bnb'
]);

const PROTECTED_PROTOCOLS = new Set(['wormhole','synapse-2','synapse protocol','multichain','anyswap']);

const BANNED_SUBSTRINGS = new RegExp(
  String.raw`\b(wrapped|wsteth|steth|weth|wbtc|binance-peg|pegged|bridged|wormhole-| -wormhole|multichain-bridged|anyswap-| -anyswap|synapse-bridged|restaked|re-staked|rsteth|oseth|cbeth|reth|frxeth|sfrxeth|ankreth|stsol|wstsol)\b`,
  'i'
);

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
      timeout: 8000
    };
  } else {
    // Free API configuration
    return {
      baseURL: 'https://api.coingecko.com/api/v3',
      headers: {
        'User-Agent': 'shumi-bot/1.0'
      },
      timeout: 5000
    };
  }
}

/**
 * Default CoinGecko search implementation using Pro API
 * @param {string} query
 * @returns {Promise<CoinCandidate[]>}
 */
async function defaultSearch(query) {
  try {
    const config = getCoinGeckoConfig();
    const { data } = await axios.get(`${config.baseURL}/search`, {
      params: { query },
      headers: config.headers,
      timeout: config.timeout
    });
    
    return (data?.coins || []).map(c => ({
      id: c.id,
      symbol: c.symbol,
      name: c.name,
      market_cap_rank: c.market_cap_rank,
      categories: c.categories || []
    }));
  } catch (error) {
    console.error(`Search error for "${query}":`, error.message);
    return [];
  }
}

/**
 * Main resolver function
 * @param {string} rawQuery
 * @param {Object} opts
 * @param {Function} [opts.search] - Custom search function
 * @param {Function} [opts.fetchById] - Optional enrichment function
 * @returns {Promise<ResolveResult>}
 */
export async function resolveQuery(rawQuery, opts = {}) {
  const search = opts.search || defaultSearch;
  const q = rawQuery.trim();
  const lower = q.toLowerCase().replace(/\s+/g, '');
  const flags = detectFlags(q);

  // 1) pair detection
  const pair = parsePair(lower);
  if (pair) {
    const baseId = resolveCanonical(pair.base);
    if (baseId) {
      return { type: 'pair', baseId, quote: pair.quote.toUpperCase() };
    }
    
    const cands = await search(pair.base);
    const picked = pickBest(cands, { ...flags, include_stablecoins: false });
    return picked 
      ? { type: 'pair', baseId: picked.id, quote: pair.quote.toUpperCase() }
      : { type: 'none', reason: 'base_not_found' };
  }

  // 2) canonical fast-path
  const canon = resolveCanonical(lower);
  if (canon) {
    return { type: 'coin', id: canon };
  }

  // 3) search + filters
  const cands = await search(q);
  const picked = pickBest(cands, flags);
  return picked 
    ? { type: 'coin', id: picked.id }
    : { type: 'none', reason: 'no_match' };
}

/**
 * Parse trading pair from string
 * @param {string} s
 * @returns {{base: string, quote: string} | null}
 */
function parsePair(s) {
  // supports btcusdt, eth/usdc, ondo-usdt, xrp:usdt, kasusdt
  const re = new RegExp(`^([a-z0-9._-]{2,})(?:[/:-]?)(${QUOTES.join('|')})`, 'i');
  const m = s.match(re);
  return m ? { base: m[1], quote: m[2] } : null;
}

/**
 * Resolve canonical ticker mapping
 * @param {string} s
 * @returns {string | null}
 */
function resolveCanonical(s) {
  return CANONICAL[s] || null;
}

/**
 * Detect user intent flags from query
 * @param {string} q
 * @returns {ResolveFlags}
 */
function detectFlags(q) {
  const s = q.toLowerCase();
  const wrapped = /(wbtc|weth|wrapped|wormhole-| -wormhole|bridg(ed|e)\b)/i.test(s);
  const staked = /(staked|restaked|oseth|reth|cbeth|ankreth|stsol|wstsol|lst|lrt)/i.test(s);
  const stables = /(stable\s*coin|usdc\b|usdt\b|dai\b|gho\b|crvusd\b|lusd\b)/i.test(s);
  
  return {
    include_wrapped: wrapped,
    include_staked: staked,
    include_bridged: /bridg(ed|e)\b/i.test(s),
    include_stablecoins: stables,
    force_exact: /\bexact\b|\bforce\b/.test(s)
  };
}

/**
 * Pick best candidate from search results
 * @param {CoinCandidate[]} cands
 * @param {ResolveFlags} flags
 * @returns {CoinCandidate | null}
 */
function pickBest(cands, flags) {
  const scored = [];
  
  for (const c of cands) {
    if (BLOCKED_IDS.has(c.id)) continue;

    let score = 0;

    // pattern penalties
    const hay = `${c.id} ${c.symbol} ${c.name}`.toLowerCase();
    if (BANNED_SUBSTRINGS.test(hay)) score -= 4;
    if (c.categories?.some(cat => /LST|LRT|bridged|wrapped/i.test(cat))) score -= 3;
    if (/\b(usd|eur|gbp|jpy|try|mxn)\b/i.test(hay)) score -= 2;
    if (/^(eth|sol).*(e|we|st|wst)$/.test(c.symbol.toLowerCase())) score -= 2;

    // protected protocol bonus
    for (const p of PROTECTED_PROTOCOLS) {
      if (hay.includes(p)) {
        score += 3;
        break;
      }
    }

    // chain-native hint bonus
    if (isCoreL1L2(hay)) score += 2;

    // stablecoin guard
    if (!flags.include_stablecoins && isStableCore(c)) continue;

    // allow wrapped/staked/bridged only if flagged or exact
    const isDerived = BANNED_SUBSTRINGS.test(hay) || 
                      c.categories?.some(cat => /LST|LRT|bridged|wrapped/i.test(cat));
    if (isDerived && !(flags.include_wrapped || flags.include_staked || 
                       flags.include_bridged || flags.force_exact)) {
      // let it compete but with the penalties already applied
    }

    // small rank tiebreak
    if (typeof c.market_cap_rank === 'number') {
      score += Math.max(0, 200 - c.market_cap_rank) * 0.01;
    }

    scored.push({ c, score });
  }

  if (!scored.length) return null;

  // prefer non-derivative on near ties
  scored.sort((a, b) => b.score - a.score || nameTiebreak(a.c, b.c));
  const top = scored[0];

  // if next is within 1 point and is non-stable vs stable, prefer non-stable
  if (scored.length > 1 && Math.abs(top.score - scored[1].score) <= 1) {
    const aStable = isStableCore(top.c);
    const bStable = isStableCore(scored[1].c);
    if (aStable && !bStable) return scored[1].c;
    if (!aStable && bStable) return top.c;
  }

  return top.c;
}

/**
 * Check if coin is a stablecoin
 * @param {CoinCandidate} c
 * @returns {boolean}
 */
function isStableCore(c) {
  const id = c.id.toLowerCase();
  const sym = c.symbol.toLowerCase();
  const nm = c.name.toLowerCase();
  return STABLES_CORE.has(id) || STABLES_CORE.has(sym) || STABLES_CORE.has(nm);
}

/**
 * Check if coin is a core L1/L2 chain
 * @param {string} hay
 * @returns {boolean}
 */
function isCoreL1L2(hay) {
  return /\b(bitcoin|ethereum|solana|avalanche|binance|arbitrum|optimism|polkadot|cosmos|celestia|aptos|sui|near|fantom|tron|stellar|vechain|kaspa|internet-computer)\b/.test(hay);
}

/**
 * Name tiebreaker for sorting
 * @param {CoinCandidate} a
 * @param {CoinCandidate} b
 * @returns {number}
 */
function nameTiebreak(a, b) {
  // prefer exact symbol match length and alphabetical as final fallback
  return a.symbol.length - b.symbol.length || a.id.localeCompare(b.id);
}

// Export additional utilities for testing
export { 
  CANONICAL, 
  QUOTES, 
  STABLES_CORE, 
  BLOCKED_IDS,
  getCoinGeckoConfig,
  detectFlags,
  parsePair,
  resolveCanonical,
  pickBest,
  isStableCore
};