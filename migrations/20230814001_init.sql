-- Migration 001: Initialize Shumi Discord Bot tables
-- SAFE: Uses CREATE TABLE IF NOT EXISTS - never drops data

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  discord_id TEXT UNIQUE NOT NULL,
  discord_username TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS competitions (
  id SERIAL PRIMARY KEY,
  week_number INTEGER UNIQUE NOT NULL,
  start_at TIMESTAMP NOT NULL,
  end_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS entries (
  id SERIAL PRIMARY KEY,
  competition_id INTEGER NOT NULL REFERENCES competitions(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  joined_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (competition_id, user_id)
);

CREATE TABLE IF NOT EXISTS trades (
  id SERIAL PRIMARY KEY,
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  ticker TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('long','short')),
  entry_price NUMERIC NOT NULL,
  exit_price NUMERIC,
  entry_time TIMESTAMP NOT NULL DEFAULT NOW(),
  exit_time TIMESTAMP,
  pnl_pct NUMERIC,
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Auto-profile channel settings
CREATE TABLE IF NOT EXISTS channel_settings (
  channel_id TEXT PRIMARY KEY,
  autoprofile_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_trades_entry_id ON trades(entry_id);
CREATE INDEX IF NOT EXISTS idx_trades_status   ON trades(status);
CREATE INDEX IF NOT EXISTS idx_entries_competition_id ON entries(competition_id);