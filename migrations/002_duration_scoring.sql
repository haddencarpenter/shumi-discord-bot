-- Migration 002: Add duration-based scoring system
-- SAFE: Adds new columns without affecting existing data

-- Add duration tracking to trades table
ALTER TABLE trades ADD COLUMN IF NOT EXISTS duration_bonus_pct NUMERIC DEFAULT 0;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS final_score NUMERIC;

-- Add scoring mode to competitions if not exists
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS scoring_mode TEXT DEFAULT 'duration_enhanced';

-- Update existing open positions to start duration tracking from today
UPDATE trades 
SET duration_bonus_pct = 0, final_score = pnl_pct 
WHERE status = 'open' AND duration_bonus_pct IS NULL;
