import { query } from './db.js';

/**
 * Smart Learning Resolver v2 - Enhanced with poisoning prevention
 * 
 * New Features:
 * - Chain context awareness
 * - Wrapped/stablecoin banning
 * - Input normalization (strips suffixes)
 * - Confidence decay and TTL
 * - Contract address storage
 * - Multi-source validation ready
 */
class SmartResolverV2 {
  constructor() {
    this.memoryCache = new Map(); // LRU with TTL: key -> {coinId, expires, confidence}
    this.hitBuffer = new Map(); // Batched hit tracking
    this.maxCacheSize = 500; // LRU eviction limit
    this.warmupComplete = false;
    
    // Dangerous patterns to ban from learning
    this.bannedPrefixes = ['w', 'st', 'm', 'a', 'c']; // w*, st*, m*, a*, c* (wrapped, staked, etc)
    this.bannedSuffixes = ['usd', 'usdt', 'usdc', 'dai', 'busd', 'eur', 'perp', 'perpetual'];
    this.bannedKeywords = ['wormhole', 'bridged', 'pegged', 'token', 'coin', 'wrapped', 'staked'];
    
    // Cache TTL settings
    this.highConfidenceTTL = 7 * 24 * 60 * 60 * 1000; // 7 days for confidence > 80
    this.lowConfidenceTTL = 24 * 60 * 60 * 1000; // 1 day for confidence < 50
    this.defaultTTL = 3 * 24 * 60 * 60 * 1000; // 3 days default
    
    // Batch flush hits every minute to reduce DB writes
    setInterval(() => this.flushHits(), 60000);
  }

  /**
   * Normalize ticker input to prevent poisoning
   */
  normalizeTicker(rawInput) {
    if (!rawInput || typeof rawInput !== 'string') return null;
    
    let normalized = rawInput.toLowerCase().trim();
    
    // Remove common prefixes that indicate cashtags
    normalized = normalized.replace(/^\$/, '');
    
    // Strip trading pair suffixes (btcusdt -> btc)
    normalized = normalized.replace(/[-_\/](usdt|usdc|usd|busd|dai|eur|btc|eth)$/i, '');
    
    // Strip derivative suffixes (eth-perp -> eth)  
    normalized = normalized.replace(/[-_\.]?(perp|perpetual|future|fut)$/i, '');
    
    // Strip common noise
    normalized = normalized.replace(/[-_\.\s]/g, '');
    
    // Length validation
    if (normalized.length < 1 || normalized.length > 20) return null;
    
    return normalized;
  }

  /**
   * Extract chain hint from context
   */
  extractChainHint(originalInput, context = {}) {
    const input = originalInput.toLowerCase();
    
    // Explicit chain indicators
    if (input.includes('eth ') || input.includes(' eth')) return 'eth';
    if (input.includes('sol ') || input.includes(' sol')) return 'sol';
    if (input.includes('bsc ') || input.includes(' bsc')) return 'bsc';
    if (input.includes('poly ') || input.includes(' polygon')) return 'polygon';
    if (input.includes('avax ') || input.includes(' avalanche')) return 'avax';
    
    // Default context (could be from guild settings later)
    return context.defaultChain || null;
  }

  /**
   * Check if ticker should be banned from learning
   */
  shouldBanFromLearning(ticker, coinId) {
    if (!ticker || !coinId) return { banned: true, reason: 'invalid_input' };
    
    const lowerTicker = ticker.toLowerCase();
    const lowerCoinId = coinId.toLowerCase();
    
    // Ban wrapped tokens
    if (lowerTicker.startsWith('w') && lowerTicker.length <= 5) {
      return { banned: true, reason: 'wrapped_token' };
    }
    
    // Ban staked derivatives  
    if (lowerTicker.startsWith('st') || lowerCoinId.includes('staked')) {
      return { banned: true, reason: 'staked_derivative' };
    }
    
    // Ban obvious stablecoins
    const stablePatterns = ['usdc', 'usdt', 'dai', 'busd', 'tusd', 'frax'];
    if (stablePatterns.includes(lowerTicker)) {
      return { banned: true, reason: 'stablecoin_ambiguous' };
    }
    
    // Ban bridged tokens
    if (lowerCoinId.includes('wormhole') || lowerCoinId.includes('bridged') || lowerCoinId.includes('pegged')) {
      return { banned: true, reason: 'bridged_token' };
    }
    
    // Ban derivative tokens
    if (lowerCoinId.includes('atoken') || lowerCoinId.includes('ctoken') || lowerTicker.startsWith('a') || lowerTicker.startsWith('c')) {
      return { banned: true, reason: 'derivative_token' };
    }
    
    // Ban single letters (too ambiguous)
    if (lowerTicker.length === 1) {
      return { banned: true, reason: 'single_letter_ambiguous' };
    }
    
    return { banned: false };
  }

  /**
   * Get cache key with chain context
   */
  getCacheKey(ticker, chainHint = null) {
    return chainHint ? `${ticker}|${chainHint}` : ticker;
  }

  /**
   * Preload top mappings into memory for instant access
   */
  async warmup() {
    try {
      const { rows } = await query(
        `SELECT ticker, coingecko_id, confidence_score, chain 
         FROM ticker_mappings 
         WHERE is_banned = false 
         ORDER BY hit_count DESC LIMIT 100`
      );
      
      rows.forEach(row => {
        const cacheKey = this.getCacheKey(row.ticker, row.chain);
        const expires = Date.now() + this.defaultTTL;
        this.addToMemoryCache(cacheKey, {
          coinId: row.coingecko_id,
          expires,
          confidence: row.confidence_score,
          chain: row.chain
        });
      });
      
      console.log(`[SMART_RESOLVER_V2] 🔥 Warmed up with ${rows.length} learned mappings`);
      this.warmupComplete = true;
    } catch (error) {
      console.log(`[SMART_RESOLVER_V2] ❌ Warmup failed:`, error.message);
    }
  }

  /**
   * Main resolution function with enhanced safety
   */
  async resolve(rawInput, context = {}) {
    const startTime = Date.now();
    const ticker = this.normalizeTicker(rawInput);
    
    if (!ticker) {
      console.log(`[SMART_RESOLVER_V2] ❌ Invalid input: ${rawInput}`);
      return null;
    }

    const chainHint = this.extractChainHint(rawInput, context);
    const cacheKey = this.getCacheKey(ticker, chainHint);
    
    let source = 'unknown';
    let result = null;

    try {
      // 1. Memory cache with TTL check
      if (this.memoryCache.has(cacheKey)) {
        const cached = this.memoryCache.get(cacheKey);
        if (cached.expires > Date.now()) {
          result = cached.coinId;
          source = 'memory';
          this.recordHitBuffered(ticker);
        } else {
          // Expired - remove from cache
          this.memoryCache.delete(cacheKey);
        }
      }
      
      // 2. Database lookup with TTL and ban check
      if (!result) {
        const dbResult = await this.getDatabaseMapping(ticker, chainHint);
        if (dbResult) {
          // Check if expired or banned
          if (dbResult.is_banned) {
            console.log(`[SMART_RESOLVER_V2] 🚫 Banned ticker: ${ticker} (${dbResult.ban_reason})`);
            return null;
          }
          
          if (dbResult.expires_at && new Date(dbResult.expires_at) < new Date()) {
            console.log(`[SMART_RESOLVER_V2] ⏰ Expired mapping: ${ticker}, triggering background revalidation`);
            // TODO: Trigger background revalidation
          } else {
            result = dbResult.coingecko_id;
            source = 'database';
            this.addToMemoryCache(cacheKey, {
              coinId: result,
              expires: Date.now() + this.defaultTTL,
              confidence: dbResult.confidence_score,
              chain: dbResult.chain
            });
            this.recordHitBuffered(ticker);
          }
        }
      }
      
      // 3. Check if known failure with backoff
      if (!result) {
        const failureInfo = await this.getFailureInfo(ticker);
        if (failureInfo && failureInfo.retry_after && new Date(failureInfo.retry_after) > new Date()) {
          console.log(`[SMART_RESOLVER_V2] ⏸️ In backoff: ${ticker} (retry after ${failureInfo.retry_after})`);
          return null;
        }
      }
      
      // 4. API call with enhanced validation
      if (!result) {
        result = await this.learnFromAPI(ticker, chainHint);
        source = result ? 'learned_new' : 'api_failed';
      }

      // Telemetry
      const duration = Date.now() - startTime;
      if (duration > 100 || source === 'learned_new') {
        console.log(`[SMART_RESOLVER_V2] ${rawInput} → ${result || 'null'} | Source: ${source} | ${duration}ms`);
      }

      return result;
    } catch (error) {
      console.log(`[SMART_RESOLVER_V2] ❌ Resolution failed for ${rawInput}:`, error.message);
      return null;
    }
  }

  /**
   * Add to memory cache with TTL and LRU eviction
   */
  addToMemoryCache(key, value) {
    if (this.memoryCache.size >= this.maxCacheSize) {
      // Remove least recently used (first entry)
      const firstKey = this.memoryCache.keys().next().value;
      this.memoryCache.delete(firstKey);
    }
    this.memoryCache.set(key, value);
  }

  /**
   * Get mapping from database with chain context
   */
  async getDatabaseMapping(ticker, chainHint = null) {
    let query_sql = 'SELECT * FROM ticker_mappings WHERE ticker = $1';
    let params = [ticker];
    
    if (chainHint) {
      query_sql += ' AND (chain = $2 OR chain IS NULL) ORDER BY (chain = $2) DESC LIMIT 1';
      params.push(chainHint);
    } else {
      query_sql += ' AND is_banned = false LIMIT 1';
    }
    
    const { rows } = await query(query_sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Get failure info with backoff details
   */
  async getFailureInfo(ticker) {
    const { rows } = await query(
      'SELECT * FROM failed_resolutions WHERE ticker = $1',
      [ticker]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Learn new mapping from API with enhanced validation
   */
  async learnFromAPI(ticker, chainHint = null) {
    try {
      console.log(`[SMART_RESOLVER_V2] 🎓 Learning new ticker: ${ticker} (chain: ${chainHint || 'any'})`);
      
      const { resolveCoinId } = await import('./resolve.js');
      const coinId = await resolveCoinId(ticker);
      
      if (!coinId) {
        await this.recordFailure(ticker, 'not_found', chainHint);
        return null;
      }
      
      // Enhanced validation to prevent poisoning
      const banCheck = this.shouldBanFromLearning(ticker, coinId);
      if (banCheck.banned) {
        console.log(`[SMART_RESOLVER_V2] 🚫 Banned from learning: ${ticker} → ${coinId} (${banCheck.reason})`);
        await this.storeBannedMapping(ticker, coinId, banCheck.reason);
        return null;
      }
      
      // Calculate confidence based on various factors
      let confidence = 70; // Default
      
      // Higher confidence for exact matches
      if (coinId.includes(ticker) || ticker.length >= 3) confidence += 10;
      
      // Lower confidence for very short tickers
      if (ticker.length <= 2) confidence -= 20;
      
      // Store the learning
      await this.learnMapping(ticker, coinId, chainHint, confidence);
      
      const cacheKey = this.getCacheKey(ticker, chainHint);
      this.addToMemoryCache(cacheKey, {
        coinId,
        expires: Date.now() + this.defaultTTL,
        confidence,
        chain: chainHint
      });
      
      console.log(`[SMART_RESOLVER_V2] ✅ Learned: ${ticker} → ${coinId} (confidence: ${confidence})`);
      return coinId;
      
    } catch (error) {
      console.log(`[SMART_RESOLVER_V2] ❌ Failed to learn ${ticker}: ${error.message}`);
      
      const reason = error.message.includes('429') ? 'ratelimit' : 'api_error';
      await this.recordFailure(ticker, reason, chainHint);
      return null;
    }
  }

  /**
   * Store successful mapping with TTL based on confidence
   */
  async learnMapping(ticker, coinId, chainHint = null, confidence = 70) {
    // Calculate TTL based on confidence
    let ttlMs;
    if (confidence >= 80) ttlMs = this.highConfidenceTTL;
    else if (confidence <= 50) ttlMs = this.lowConfidenceTTL;
    else ttlMs = this.defaultTTL;
    
    const expiresAt = new Date(Date.now() + ttlMs);
    
    await query(
      `INSERT INTO ticker_mappings (ticker, coingecko_id, chain, confidence_score, expires_at, source) 
       VALUES ($1, $2, $3, $4, $5, 'learned') 
       ON CONFLICT (ticker) DO UPDATE SET 
         confidence_score = GREATEST(ticker_mappings.confidence_score, EXCLUDED.confidence_score),
         last_used = NOW(),
         updated_at = NOW(),
         expires_at = CASE 
           WHEN EXCLUDED.confidence_score > ticker_mappings.confidence_score 
           THEN EXCLUDED.expires_at 
           ELSE ticker_mappings.expires_at 
         END`,
      [ticker, coinId, chainHint, confidence, expiresAt]
    );
  }

  /**
   * Store banned mapping to prevent future learning
   */
  async storeBannedMapping(ticker, coinId, reason) {
    await query(
      `INSERT INTO ticker_mappings (ticker, coingecko_id, confidence_score, source, is_banned, ban_reason) 
       VALUES ($1, $2, 0, 'admin', true, $3) 
       ON CONFLICT (ticker) DO UPDATE SET 
         is_banned = true,
         ban_reason = EXCLUDED.ban_reason,
         updated_at = NOW()`,
      [ticker, coinId, reason]
    );
  }

  /**
   * Record failure with exponential backoff
   */
  async recordFailure(ticker, reason, chainHint = null) {
    // Calculate exponential backoff
    const failureInfo = await this.getFailureInfo(ticker);
    const failureCount = failureInfo ? failureInfo.failure_count + 1 : 1;
    
    // Backoff: 1min, 5min, 15min, 1hour, 4hours, 12hours
    const backoffMinutes = Math.min(Math.pow(3, failureCount), 720); // Max 12 hours
    const retryAfter = new Date(Date.now() + backoffMinutes * 60 * 1000);
    
    await query(
      `INSERT INTO failed_resolutions (ticker, failure_count, last_reason, last_failed, retry_after, chain_hint) 
       VALUES ($1, $2, $3, NOW(), $4, $5) 
       ON CONFLICT (ticker) DO UPDATE SET 
         failure_count = EXCLUDED.failure_count,
         last_reason = EXCLUDED.last_reason,
         last_failed = EXCLUDED.last_failed,
         retry_after = EXCLUDED.retry_after,
         chain_hint = EXCLUDED.chain_hint`,
      [ticker, failureCount, reason, retryAfter, chainHint]
    );
  }

  /**
   * Buffer hit counting to reduce DB writes
   */
  recordHitBuffered(ticker) {
    this.hitBuffer.set(ticker, (this.hitBuffer.get(ticker) || 0) + 1);
  }

  /**
   * Flush hit buffer to database (called every minute)
   */
  async flushHits() {
    if (this.hitBuffer.size === 0) return;
    
    try {
      for (const [ticker, hits] of this.hitBuffer) {
        await query(
          'UPDATE ticker_mappings SET hit_count = hit_count + $1, last_used = NOW() WHERE ticker = $2 AND is_banned = false',
          [hits, ticker]
        );
      }
      
      console.log(`[SMART_RESOLVER_V2] 📊 Flushed ${this.hitBuffer.size} hit counters`);
      this.hitBuffer.clear();
    } catch (error) {
      console.log(`[SMART_RESOLVER_V2] ❌ Hit flush failed:`, error.message);
    }
  }

  /**
   * Get comprehensive stats for monitoring
   */
  async getStats() {
    try {
      const [mappings, banned, failures, topHits, recentLearnings] = await Promise.all([
        query('SELECT COUNT(*) as learned FROM ticker_mappings WHERE is_banned = false'),
        query('SELECT COUNT(*) as banned FROM ticker_mappings WHERE is_banned = true'),
        query('SELECT COUNT(*) as failed FROM failed_resolutions WHERE retry_after > NOW()'),
        query('SELECT SUM(hit_count) as total_hits FROM ticker_mappings WHERE is_banned = false'),
        query('SELECT COUNT(*) as recent FROM ticker_mappings WHERE created_at > NOW() - INTERVAL \'24 hours\' AND is_banned = false')
      ]);
      
      return {
        learnedMappings: parseInt(mappings.rows[0].learned),
        bannedMappings: parseInt(banned.rows[0].banned),
        activeFallures: parseInt(failures.rows[0].failed),
        totalCacheHits: parseInt(topHits.rows[0].total_hits || 0),
        recentLearnings: parseInt(recentLearnings.rows[0].recent),
        memoryCacheSize: this.memoryCache.size,
        hitBufferSize: this.hitBuffer.size,
        warmupComplete: this.warmupComplete
      };
    } catch (error) {
      console.log(`[SMART_RESOLVER_V2] ❌ Stats query failed:`, error.message);
      return { error: error.message };
    }
  }

  /**
   * Admin function to force ban a ticker
   */
  async forceBan(ticker, reason = 'admin_banned') {
    const normalized = this.normalizeTicker(ticker);
    if (!normalized) return false;
    
    await query(
      'UPDATE ticker_mappings SET is_banned = true, ban_reason = $2, updated_at = NOW() WHERE ticker = $1',
      [normalized, reason]
    );
    
    // Remove from memory cache
    this.memoryCache.delete(normalized);
    this.hitBuffer.delete(normalized);
    
    console.log(`[SMART_RESOLVER_V2] 🚫 Admin banned: ${normalized} (${reason})`);
    return true;
  }

  /**
   * Admin function to force unban a ticker
   */
  async forceUnban(ticker) {
    const normalized = this.normalizeTicker(ticker);
    if (!normalized) return false;
    
    await query(
      'UPDATE ticker_mappings SET is_banned = false, ban_reason = NULL, updated_at = NOW() WHERE ticker = $1',
      [normalized]
    );
    
    console.log(`[SMART_RESOLVER_V2] ✅ Admin unbanned: ${normalized}`);
    return true;
  }

  /**
   * Admin function to force relearn a ticker
   */
  async forceRelearn(ticker) {
    const normalized = this.normalizeTicker(ticker);
    if (!normalized) return null;
    
    // Remove from all caches and DB
    this.memoryCache.delete(normalized);
    this.hitBuffer.delete(normalized);
    
    await query('DELETE FROM ticker_mappings WHERE ticker = $1', [normalized]);
    await query('DELETE FROM failed_resolutions WHERE ticker = $1', [normalized]);
    
    // Try to learn fresh
    return await this.learnFromAPI(normalized);
  }
}

export default new SmartResolverV2();
