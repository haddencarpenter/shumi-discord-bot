// Ticker normalization utility
// Maps common aliases to canonical ticker symbols

export const TICKER_ALIASES = {
  // Fix the LIDO confusion
  lido: 'ldo',
  ldo: 'ldo',
  
  // Keep original debug tickers
  hype: 'hype',
  lmeow: 'lmeow',
  fartcoin: 'fartcoin',
  
  // Add any other common confusions here
  // Example: 'wrapped-eth': 'weth',
};

export function normalizeTicker(raw) {
  if (!raw) return raw;
  const key = String(raw).trim().toLowerCase();
  return TICKER_ALIASES[key] || key; // fallback to the same key
}