-- Migration 003: Smart resolution learning system
-- Enhanced with chain context, contract awareness, and poisoning prevention

-- Enhanced canonical mapping table (CREATE IF NOT EXISTS for safety)
CREATE TABLE IF NOT EXISTS ticker_mappings (
  ticker             VARCHAR(64) PRIMARY KEY,  -- normalized user input (base only)
  coingecko_id       VARCHAR(128) NOT NULL,
  contract_address   VARCHAR(128),             -- null for non-erc20 or CEX-only
  chain              VARCHAR(32),              -- 'eth','sol','bsc', etc
  source             VARCHAR(32)  NOT NULL,    -- 'coingecko','admin','warmup','vote'
  confidence_score   INTEGER      NOT NULL DEFAULT 70,  -- 0..100
  hit_count          INTEGER      NOT NULL DEFAULT 0,
  last_used          TIMESTAMP    NOT NULL DEFAULT NOW(),
  created_at         TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMP    NOT NULL DEFAULT NOW(),
  expires_at         TIMESTAMP,                -- optional TTL for revalidation
  is_banned          BOOLEAN      NOT NULL DEFAULT false,
  ban_reason         VARCHAR(128)              -- why it was banned
);

-- Enhanced failures with backoff and context
CREATE TABLE IF NOT EXISTS failed_resolutions (
  ticker           VARCHAR(64) PRIMARY KEY,
  failure_count    INTEGER      NOT NULL DEFAULT 1,
  last_reason      VARCHAR(64),                 -- 'ratelimit','not_found','ambiguous','wrapped','banned'
  last_status      INTEGER,
  last_failed      TIMESTAMP    NOT NULL DEFAULT NOW(),
  retry_after      TIMESTAMP,                   -- do not retry before this
  chain_hint       VARCHAR(32)                  -- chain context when failed
);

-- Ticker aliases for common variations
CREATE TABLE IF NOT EXISTS ticker_aliases (
  alias            VARCHAR(64) PRIMARY KEY,     -- e.g., 'bitcoin', 'btc', 'Ƀ'
  ticker           VARCHAR(64) NOT NULL         -- normalized canonical ticker key
);

-- Unique constraint for contract addresses
CREATE UNIQUE INDEX idx_ticker_mappings_contract_unique ON ticker_mappings(contract_address, chain) WHERE contract_address IS NOT NULL;

-- Performance indexes
CREATE INDEX idx_ticker_mappings_ticker ON ticker_mappings(ticker) WHERE is_banned = false;
CREATE INDEX idx_ticker_mappings_hits ON ticker_mappings(hit_count DESC) WHERE is_banned = false;
CREATE INDEX idx_ticker_mappings_expired ON ticker_mappings(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_failed_resolutions_retry ON failed_resolutions(retry_after) WHERE retry_after IS NOT NULL;

-- Seed with SAFE, high-confidence mappings (no wrapped/stable coins)
INSERT INTO ticker_mappings (ticker, coingecko_id, confidence_score, hit_count, source) VALUES
-- Major L1s (safe, unambiguous)
('btc', 'bitcoin', 100, 1000, 'warmup'),
('eth', 'ethereum', 100, 1000, 'warmup'),
('sol', 'solana', 100, 800, 'warmup'),
('ada', 'cardano', 100, 500, 'warmup'),
('dot', 'polkadot', 100, 400, 'warmup'),
('avax', 'avalanche-2', 100, 400, 'warmup'),
('atom', 'cosmos', 100, 350, 'warmup'),
('algo', 'algorand', 100, 300, 'warmup'),

-- Major DeFi (original tokens only)
('uni', 'uniswap', 100, 300, 'warmup'),
('link', 'chainlink', 100, 350, 'warmup'),
('aave', 'aave', 100, 250, 'warmup'),
('comp', 'compound-governance-token', 100, 200, 'warmup'),
('mkr', 'maker', 100, 200, 'warmup'),
('crv', 'curve-dao-token', 100, 200, 'warmup'),

-- Popular memes (unambiguous)
('doge', 'dogecoin', 100, 600, 'warmup'),
('shib', 'shiba-inu', 100, 400, 'warmup'),
('pepe', 'pepe', 100, 300, 'warmup'),

-- Exchange tokens (original only)
('bnb', 'binancecoin', 100, 200, 'warmup'),
('okb', 'okb', 100, 150, 'warmup')

ON CONFLICT (ticker) DO NOTHING;

-- Common aliases
INSERT INTO ticker_aliases (alias, ticker) VALUES
('bitcoin', 'btc'),
('ethereum', 'eth'),
('solana', 'sol'),
('cardano', 'ada'),
('polkadot', 'dot'),
('avalanche', 'avax'),
('dogecoin', 'doge'),
('uniswap', 'uni'),
('chainlink', 'link')
ON CONFLICT (alias) DO NOTHING;

-- Ban dangerous patterns from learning
INSERT INTO ticker_mappings (ticker, coingecko_id, confidence_score, hit_count, source, is_banned, ban_reason) VALUES
-- Wrapped coins
('wbtc', 'wrapped-bitcoin', 0, 0, 'admin', true, 'wrapped_token'),
('weth', 'weth', 0, 0, 'admin', true, 'wrapped_token'),
('wsol', 'wrapped-solana', 0, 0, 'admin', true, 'wrapped_token'),

-- Stablecoins (too ambiguous across chains)
('usdc', 'usd-coin', 0, 0, 'admin', true, 'stablecoin_ambiguous'),
('usdt', 'tether', 0, 0, 'admin', true, 'stablecoin_ambiguous'),
('dai', 'dai', 0, 0, 'admin', true, 'stablecoin_ambiguous'),
('busd', 'binance-usd', 0, 0, 'admin', true, 'stablecoin_ambiguous'),

-- Staked derivatives
('steth', 'staked-ether', 0, 0, 'admin', true, 'staked_derivative'),
('reth', 'rocket-pool-eth', 0, 0, 'admin', true, 'staked_derivative')

ON CONFLICT (ticker) DO UPDATE SET 
  is_banned = EXCLUDED.is_banned,
  ban_reason = EXCLUDED.ban_reason;
