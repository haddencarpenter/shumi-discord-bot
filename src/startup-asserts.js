// Ensures resolver-advanced is just re-exporting the unified resolver
import * as base from './resolve.js';
import * as adv from './resolver-advanced.js';

export function assertSingleResolver() {
  // both should point to the exact same function reference
  if (adv.resolveCoinId !== base.resolveCoinId) {
    console.error('[FATAL] resolver-advanced is not shimming resolve.js');
    process.exit(1);
  }
  console.log('✅ Single resolver verified (function identity check passed)');
}