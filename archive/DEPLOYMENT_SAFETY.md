# 🛡️ Deployment Safety Guide

## Pre-Deployment Checklist

### 1. Regression Guard Test
```bash
npm run test:regression
```
**Must pass before any deployment!**

### 2. Critical Token Resolution Verification
The following mappings are **business critical** and must remain intact:

| Input | Expected Resolution | Impact if Broken |
|-------|-------------------|------------------|
| `sd` | `stader` | Users get wrong Stader price |
| `btc` | `bitcoin` | Bitcoin price fails |
| `eth` | `ethereum` | Ethereum price fails |
| `sol` | `solana` | Solana price fails |
| `w` | `wormhole` | Wormhole disambiguation fails |
| `uni` | `uniswap` | Uniswap price fails |

### 3. Manual Deployment Safety Commands
```bash
# Quick smoke test
npm run test:regression

# Full integration test (optional)
node test-current-resolver.js

# Database backup before major changes
npm run db:backup
```

### 4. Post-Deployment Verification
After deployment, verify in Discord:
```
shumi price sd    # Should show Stader price (~$0.83)
shumi price btc   # Should show Bitcoin price
shumi price w     # Should show Wormhole price
```

### 5. Rollback Plan
If regression detected after deployment:
1. **Immediate**: Revert `src/resolve.js` to last known good version
2. **Verify**: Run `npm run test:regression`
3. **Redeploy**: Push fixed version

### 6. Future WebSocket Integration Safety
When implementing WebSocket aggregator:
- **Keep regression tests passing** throughout development
- **Add WebSocket-specific tests** to regression suite
- **Test fallback behavior** when WebSocket is down
- **Verify price source tracking** (`-realtime` vs `coingecko-rest`)

---

## 🚨 Emergency Procedures

### If SD Resolution Breaks Again:
```bash
# 1. Quick fix - add to CANONICAL map in src/resolve.js:
sd: "stader",

# 2. Test immediately:
npm run test:regression

# 3. Verify in Discord:
shumi price sd
```

### If Multiple Mappings Break:
```bash
# 1. Check recent changes to src/resolve.js
git log --oneline -10 src/resolve.js

# 2. Revert to last working commit
git checkout <last-good-commit> src/resolve.js

# 3. Test and redeploy
npm run test:regression
```

---

## ✅ Current Status
- **SD Resolution**: ✅ Fixed and tested
- **Regression Guard**: ✅ Active and monitoring
- **Deployment Safety**: ✅ Scripts in place
- **WebSocket Ready**: ✅ Architecture planned