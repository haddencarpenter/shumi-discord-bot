// src/resolve.js
import axios from "axios";

/** Canonical map for top tickers (fast path) */
const CANONICAL = {
  btc: "bitcoin",
  xbt: "bitcoin",
  eth: "ethereum",
  sol: "solana",
  link: "chainlink",
  ada: "cardano",
  avax: "avalanche-2",
  bnb: "binancecoin",
  doge: "dogecoin",
  trx: "tron",
  matic: "polygon-ecosystem-token",  // POL (ex-MATIC) - the main Polygon token
  pol: "polygon-ecosystem-token",     // Same token, different ticker
  ltc: "litecoin",
  uni: "uniswap",
  arb: "arbitrum",
  op: "optimism",
  ldo: "lido-dao",
  dot: "polkadot",
  atom: "cosmos",
  xrp: "ripple",
  algo: "algorand",
  near: "near",
  ftm: "fantom",
  xlm: "stellar",
  vet: "vechain",
  icp: "internet-computer",
  fil: "filecoin",
  apt: "aptos",
  sui: "sui",
  sei: "sei-network",
  inj: "injective-protocol",
  tia: "celestia",
  w: "wormhole",  // Wormhole governance token
  syn: "synapse-2",  // Synapse protocol token
  multi: "multichain",  // Multichain (formerly Anyswap) token
  any: "anyswap",  // Old Anyswap token
  sd: "stader",  // Stader token - fixes SD disambiguation issue
  bio: "bio-protocol",  // Bio Protocol - fixes BIO disambiguation issue
  spx: "spx6900",  // SPX6900
  pendle: "pendle",  // Pendle
  cvx: "convex-finance",  // Convex Finance
  omni: "omni-network",  // Omni Network (modern) not the old Mastercoin
  mavia: "heroes-of-mavia",  // Heroes of Mavia
  // add more as you see fit
};

/** Hard blocklist of IDs you never want */
const STATIC_BLOCKED_IDS = new Set([
  "weth", "wrapped-ether", "wrapped-bitcoin", "wbtc", "binance-wrapped-btc",
  "binance-peg-ethereum", "binance-peg-bitcoin", "wrapped-steth", "wrapped-solana", "wsol",
  "staked-ether", "steth", "coinbase-wrapped-staked-eth",
  "solana-wormhole", "ethereum-wormhole", "bitcoin-wormhole",
  "wrapped-avax", "wrapped-bnb", "wrapped-matic", "wmatic", "matic-wormhole", "wrapped-fantom",
  "bridged-usdc", "bridged-usdt", "bridged-dai",
  "multichain-bridged-usdc", "multichain-bridged-btc", "multichain-bridged-eth",
  "synapse-bridged-usdc", "synapse-bridged-usdt", 
  "anyswap-eth", "anyswap-btc", "anyswap-bnb",
  "polygon-bridged-usdc", "arbitrum-bridged-usdc", "optimism-bridged-eth",
]);

/** Extra blocklist via env (comma-separated CoinGecko IDs) */
const ENV_BLOCKED = (process.env.SHUMI_CG_BLOCKLIST || "")
  .split(",")
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);
const BLOCKED_IDS = new Set([...STATIC_BLOCKED_IDS, ...ENV_BLOCKED]);

/** Heuristic text rules to exclude wrapped/bridged variants */
function looksWrappedOrPegged(name) {
  const s = name.toLowerCase();
  
  // Special cases: These are legitimate protocol tokens, not wrapped versions
  const legitimateProtocolNames = [
    "wormhole",
    "synapse-2", 
    "synapse protocol",
    "multichain",
    "anyswap"
  ];
  
  // If it's exactly a protocol name, it's not wrapped
  if (legitimateProtocolNames.some(protocol => s === protocol)) {
    return false;
  }
  
  return (
    s.includes("wrapped") ||
    s.includes("wbtc") ||
    s.includes("weth") ||
    s.includes("peg") ||
    s.includes("pegged") ||
    s.includes("bridged") ||
    s.includes("-wormhole") ||  // bridged tokens like "solana-wormhole"
    s.includes("wormhole-") ||   // "wormhole-bridged-usdc"
    s.includes("binance-peg") ||
    s.includes("multichain-bridged") ||  // More specific
    s.includes("anyswap-") ||  // Anyswap-bridged tokens
    s.includes("-anyswap") ||
    s.includes("synapse-bridged") ||  // Synapse-bridged tokens
    s.includes("staked") ||
    s.includes("wsteth") ||
    s.includes("wrapped-staked")
  );
}

/** Score candidates: prefer native, big mcap, exact symbol/name */
function scoreCandidate(q, c) {
  let score = 0;
  const ql = q.toLowerCase();
  
  // Exact matches get huge boost
  if (c.symbol?.toLowerCase() === ql) score += 50;
  if (c.name?.toLowerCase() === ql) score += 40;
  
  // Market cap rank bonus (higher rank = lower number = better)
  if (typeof c.market_cap_rank === "number") {
    score += Math.max(0, 100 - c.market_cap_rank);
  }
  
  // Penalize wrapped/pegged variants heavily
  if (looksWrappedOrPegged(c.name || "") || looksWrappedOrPegged(c.id || "")) {
    score -= 100;
  }
  
  // Bonus for coins that are likely "native" versions
  if (c.id && !c.id.includes("-") && !c.id.includes("wrapped")) {
    score += 10;
  }
  
  return score;
}

// Rate limiting for CoinGecko API calls
let lastApiCall = 0;
const MIN_INTERVAL_MS = 2000; // 2 seconds between calls (more conservative)

async function rateLimitedApiCall(url) {
  const now = Date.now();
  const timeSince = now - lastApiCall;
  
  if (timeSince < MIN_INTERVAL_MS) {
    const waitTime = MIN_INTERVAL_MS - timeSince;
    console.log(`[RATE_LIMIT] Waiting ${waitTime}ms before next API call`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  
  lastApiCall = Date.now();
  
  try {
    // Add API key headers if using Pro API
    const headers = {};
    if (process.env.COINGECKO_API_KEY && url.includes('pro-api.coingecko.com')) {
      headers['x-cg-pro-api-key'] = process.env.COINGECKO_API_KEY;
    }
    
    const response = await fetch(url, { headers });
    
    if (response.status === 429) {
      // Rate limited - wait 1 minute and retry
      const retryDelay = 60000; // 60 seconds (1 minute)
      console.log(`[RATE_LIMIT] 429 received, waiting ${retryDelay}ms before retry`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      return await fetch(url, { headers }); // Retry once with headers
    }
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    // Check if response contains "Throttled" text instead of JSON
    const responseText = await response.text();
    if (responseText.trim()?.includes('Throttled')) {
      console.log(`[RATE_LIMIT] Received "Throttled" response: "${responseText.trim()}", waiting 60s before retry`);
      await new Promise(resolve => setTimeout(resolve, 60000)); // Wait 1 minute
      
      // Retry the request after waiting
      console.log(`[RATE_LIMIT] Retrying request after throttling wait`);
      const retryHeaders = {};
      if (process.env.COINGECKO_API_KEY && url.includes('pro-api.coingecko.com')) {
        retryHeaders['x-cg-pro-api-key'] = process.env.COINGECKO_API_KEY;
      }
      const retryResponse = await fetch(url, { headers: retryHeaders });
      const retryText = await retryResponse.text();
      
      // If still throttled, throw error to prevent infinite retry
      if (retryText.trim()?.includes('Throttled')) {
        throw new Error('Rate limited - still throttled after 60s wait');
      }
      
      // Return the successful retry response
      return {
        ok: true,
        status: retryResponse.status,
        json: () => Promise.resolve(JSON.parse(retryText)),
        text: () => Promise.resolve(retryText)
      };
    }
    
    // Create a new response object with the text
    return {
      ok: true,
      status: response.status,
      json: async () => JSON.parse(responseText)
    };
  } catch (error) {
    console.error(`[API_ERROR] ${url}:`, error.message);
    throw error;
  }
}

/** Resolve a single query (ticker or name) to a CoinGecko ID */
export async function resolveCoinId(query) {
  const q = String(query).trim().toLowerCase();

  // Fast path: canonical mapping
  if (CANONICAL[q]) return CANONICAL[q];

  // If user explicitly typed "weth"/"wbtc", allow it
  if (q === "weth" || q === "wbtc" || q === "steth") return q;

  try {
    // Search CoinGecko with rate limiting (Pro API if available)
    const baseUrl = process.env.COINGECKO_API_KEY 
      ? 'https://pro-api.coingecko.com/api/v3'
      : 'https://api.coingecko.com/api/v3';
    const searchUrl = `${baseUrl}/search?query=${encodeURIComponent(q)}`;
    const response = await rateLimitedApiCall(searchUrl);
    const data = await response.json();

    const coins = (data?.coins || [])
      .map(c => ({
        id: c.id,
        name: c.name,
        symbol: c.symbol,
        market_cap_rank: c.market_cap_rank ?? 9999,
      }))
      // hard exclude IDs we hate
      .filter(c => !BLOCKED_IDS.has(c.id))
      // soft exclude obviously wrapped variants unless user asked for them
      .filter(c => {
        // If user explicitly asked for wrapped version, allow it
        if (q.startsWith("w") && (q === "weth" || q === "wbtc" || q === "wrapped")) {
          return true;
        }
        return !(looksWrappedOrPegged(c.name) || looksWrappedOrPegged(c.id));
      });

    if (!coins.length) return null;

    // Sort by score (highest first)
    coins.sort((a, b) => scoreCandidate(q, b) - scoreCandidate(q, a));
    
    return coins[0].id;
  } catch (error) {
    console.error(`Error resolving coin ID for "${query}":`, error.message);
    return null;
  }
}

/** Resolve many tickers -> ids (keeps order; null for misses) */
export async function resolveMany(queries) {
  const out = [];
  for (const q of queries) {
    try { 
      const id = await resolveCoinId(q);
      out.push(id);
    } catch { 
      out.push(null);
    }
  }
  return out;
}

/** Debug function to see what the resolver would pick */
export async function debugResolve(query) {
  const q = String(query).trim().toLowerCase();
  
  // Check canonical first
  if (CANONICAL[q]) {
    return {
      query: query,
      resolved_id: CANONICAL[q],
      method: "canonical_map",
      candidates: []
    };
  }
  
  try {
    // Use Pro API if available
    const baseUrl = process.env.COINGECKO_API_KEY 
      ? 'https://pro-api.coingecko.com/api/v3'
      : 'https://api.coingecko.com/api/v3';
    const searchUrl = `${baseUrl}/search?query=${encodeURIComponent(q)}`;
    const response = await rateLimitedApiCall(searchUrl);
    const data = await response.json();
    
    const allCandidates = (data?.coins || []).slice(0, 10).map(c => ({
      id: c.id,
      name: c.name,
      symbol: c.symbol,
      market_cap_rank: c.market_cap_rank ?? 9999,
      blocked: BLOCKED_IDS.has(c.id),
      looks_wrapped: looksWrappedOrPegged(c.name || "") || looksWrappedOrPegged(c.id || ""),
      score: scoreCandidate(q, c)
    }));
    
    const filtered = allCandidates
      .filter(c => !c.blocked)
      .filter(c => !c.looks_wrapped);
    
    filtered.sort((a, b) => b.score - a.score);
    
    return {
      query: query,
      resolved_id: filtered[0]?.id || null,
      method: "search_and_filter",
      candidates: allCandidates,
      filtered: filtered,
      blocked_ids: Array.from(BLOCKED_IDS).slice(0, 10) // Show first 10 for debugging
    };
  } catch (error) {
    return {
      query: query,
      resolved_id: null,
      error: error.message
    };
  }
}

/** Warm the resolver cache with common tickers to prevent first-query delays */
export async function loadCache(verbose = false) {
  const commonTickers = ['btc', 'eth', 'sol', 'doge', 'shib', 'pepe', 'sd', 'matic', 'uni', 'link'];
  if (verbose) console.log('🔥 Warming resolver cache...');
  
  const results = await Promise.allSettled(
    commonTickers.map(async ticker => {
      const id = await resolveCoinId(ticker);
      if (verbose && id) console.log(`  ${ticker} → ${id}`);
      return { ticker, id };
    })
  );
  
  const successful = results.filter(r => r.status === 'fulfilled' && r.value.id).length;
  if (verbose) console.log(`Resolver cache warmed: ${successful}/${commonTickers.length} tickers`);
  
  return successful;
}

export { CANONICAL };