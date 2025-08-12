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

/** Resolve a single query (ticker or name) to a CoinGecko ID */
export async function resolveCoinId(query) {
  const q = String(query).trim().toLowerCase();

  // Fast path: canonical mapping
  if (CANONICAL[q]) return CANONICAL[q];

  // If user explicitly typed "weth"/"wbtc", allow it
  if (q === "weth" || q === "wbtc" || q === "steth") return q;

  try {
    // Search CoinGecko
    const { data } = await axios.get("https://api.coingecko.com/api/v3/search", {
      params: { query: q },
      headers: { "User-Agent": "shumi-bot/1.0" },
      timeout: 5000,
    });

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
    const { data } = await axios.get("https://api.coingecko.com/api/v3/search", {
      params: { query: q },
      headers: { "User-Agent": "shumi-bot/1.0" },
      timeout: 5000,
    });
    
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