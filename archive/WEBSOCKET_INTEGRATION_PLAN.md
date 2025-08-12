# WebSocket Price Aggregator Integration Plan

## ✅ IMMEDIATE FIX COMPLETED
- **SD Resolution Fixed**: Added `sd: "stader"` to CANONICAL mapping in `src/resolve.js`
- **Test Results**: 100% success rate (6/6 tokens resolve correctly)
- **Live Status**: Fix is active in running Discord bot

---

## 📋 Phase 1: Enhanced Resolver Module

### 1.1 Database-Driven Canonical Mappings
**Goal**: Move from hardcoded CANONICAL to persistent storage

```sql
-- Migration: Add canonical_map table
CREATE TABLE IF NOT EXISTS canonical_map (
  alias TEXT PRIMARY KEY,
  coin_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_by TEXT -- Discord user ID who added it
);

-- Pre-populate with current CANONICAL mappings
INSERT INTO canonical_map (alias, coin_id) VALUES 
  ('btc', 'bitcoin'),
  ('eth', 'ethereum'),
  ('sd', 'stader'),
  -- ... etc
```

### 1.2 Admin Commands Implementation
```javascript
// Add to discord.js command handler
if (content.startsWith('shumi map add ')) {
  const [_, __, ___, alias, coinId] = content.split(' ');
  await putCanonical(alias, coinId);
  await message.reply(`✅ Mapped ${alias} → ${coinId}`);
}

if (content.startsWith('shumi map list')) {
  const mappings = await getCanonicalMappings();
  // Display current mappings
}
```

### 1.3 Enhanced resolveCoinId Function
```javascript
export async function resolveCoinId(query) {
  const q = String(query).trim().toLowerCase();

  // 1. Check persistent canonical_map (database)
  const dbMapping = await getCanonicalMapping(q);
  if (dbMapping) return { coinId: dbMapping, method: "canonical_db" };

  // 2. Check hardcoded whitelist (high-confidence mappings)
  if (CANONICAL[q]) return { coinId: CANONICAL[q], method: "canonical_static" };

  // 3. Fall back to CoinGecko search + scoring
  // ... existing logic
}
```

---

## 📋 Phase 2: Multi-Exchange WebSocket Aggregator

### 2.1 WebSocket Manager (`src/multi-exchange-websocket.js`)
```javascript
class MultiExchangeWebSocket {
  constructor() {
    this.exchanges = ['binance', 'bybit', 'kucoin', 'gate'];
    this.connections = new Map();
    this.priceData = new Map(); // symbol -> {price, exchange, timestamp}
  }

  async initialize() {
    for (const exchange of this.exchanges) {
      await this.connectExchange(exchange);
    }
  }

  connectExchange(exchange) {
    // Connect to each exchange's WebSocket
    // Subscribe to price streams for major pairs
    // Handle reconnection logic with exponential backoff
  }

  getPrice(symbol) {
    return this.priceData.get(symbol.toLowerCase());
  }
}
```

### 2.2 Price Service Integration (`src/price-service-integrated.js`)
```javascript
class PriceService {
  constructor() {
    this.websocket = new MultiExchangeWebSocket();
    this.coinGeckoService = new CoinGeckoService();
  }

  async getPrice(coinId) {
    // 1. Try WebSocket data first
    const wsPrice = this.websocket.getPrice(coinId);
    if (wsPrice && this.isRecentData(wsPrice)) {
      return {
        price: wsPrice.price,
        source: `${wsPrice.exchange}-realtime`,
        timestamp: wsPrice.timestamp
      };
    }

    // 2. Fallback to CoinGecko
    const cgPrice = await this.coinGeckoService.getPrice(coinId);
    return {
      price: cgPrice,
      source: 'coingecko-rest',
      timestamp: Date.now()
    };
  }
}
```

### 2.3 Symbol Mapping for WebSocket
```javascript
// Map CoinGecko IDs to exchange symbols
const SYMBOL_MAPPINGS = {
  'bitcoin': { binance: 'BTCUSDT', bybit: 'BTCUSDT', kucoin: 'BTC-USDT' },
  'ethereum': { binance: 'ETHUSDT', bybit: 'ETHUSDT', kucoin: 'ETH-USDT' },
  'stader': { binance: null, bybit: null, kucoin: 'SD-USDT' }, // SD only on KuCoin
  // ...
};
```

---

## 📋 Phase 3: Disambiguation Enhancement

### 3.1 Cross-Reference with Trading Pairs
```javascript
// In resolver: validate candidates against active trading pairs
function validateCandidates(candidates) {
  return candidates.filter(candidate => {
    const hasActivePair = Object.values(SYMBOL_MAPPINGS).some(mapping => 
      Object.values(mapping).includes(candidate.symbol + 'USDT')
    );
    return hasActivePair; // Prefer tokens that actually trade
  });
}
```

### 3.2 Real-Time Price Validation
```javascript
// Penalize candidates with no recent price data
function scoreWithRealTimeData(candidate, wsData) {
  let score = baseScore(candidate);
  
  if (wsData && wsData.timestamp > Date.now() - 60000) {
    score += 20; // Bonus for real-time data availability
  }
  
  return score;
}
```

---

## 📋 Phase 4: Testing Infrastructure

### 4.1 Updated Test Script (`test-ws-resolver.js`)
```javascript
// Once WebSocket implementation exists:
const testTokens = ['BTC', 'ETH', 'SOL', 'SD', 'ORDI', 'WIF'];

for (const token of testTokens) {
  const { coinId, method } = await resolveCoinId(token);
  const priceData = await priceService.getPrice(coinId);
  
  console.log(`${token} → ${coinId} (${method}) → $${priceData.price} [${priceData.source}]`);
  
  // PASS criteria: source ends with '-realtime' for major tokens
  if (!priceData.source.endsWith('-realtime') && ['BTC', 'ETH', 'SOL'].includes(token)) {
    console.warn(`⚠️ Major token ${token} not using realtime data`);
  }
}
```

---

## 🎯 Implementation Priority

1. **Phase 1** (Week 1): Database-driven canonical mappings + admin commands
2. **Phase 2** (Week 2-3): WebSocket aggregator for major exchanges  
3. **Phase 3** (Week 4): Enhanced disambiguation with trading pair validation
4. **Phase 4** (Ongoing): Comprehensive testing and monitoring

## 📊 Success Metrics

- **≥95% resolution accuracy** for top 100 tokens
- **≥80% real-time price coverage** for major tokens  
- **<100ms response time** for cached WebSocket prices
- **Zero incorrect SD-type disambiguation issues**

---

## 🚀 Current Status: Phase 0 Complete ✅

- SD resolution fixed via canonical mapping
- All test cases passing (6/6 = 100%)
- Ready to begin Phase 1 implementation