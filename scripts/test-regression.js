#!/usr/bin/env node
/**
 * Regression Guard Test
 * Prevents deployment of code that breaks critical token resolutions
 * Run before each deploy: node scripts/test-regression.js
 */

import assert from 'assert';
import { resolveCoinId } from '../src/resolve.js';

console.log('🛡️ Running Regression Guard Tests...');
console.log('===================================\n');

const criticalMappings = [
  { input: 'sd', expected: 'stader', description: 'SD → Stader (critical fix)' },
  { input: 'btc', expected: 'bitcoin', description: 'BTC → Bitcoin' },
  { input: 'eth', expected: 'ethereum', description: 'ETH → Ethereum' },
  { input: 'sol', expected: 'solana', description: 'SOL → Solana' },
  { input: 'w', expected: 'wormhole', description: 'W → Wormhole' },
  { input: 'uni', expected: 'uniswap', description: 'UNI → Uniswap' }
];

let passed = 0;
let failed = 0;

for (const test of criticalMappings) {
  try {
    const result = await resolveCoinId(test.input);
    assert.strictEqual(result, test.expected, 
      `${test.input} should resolve to ${test.expected}, got ${result}`);
    
    console.log(`✅ ${test.description}`);
    passed++;
  } catch (error) {
    console.error(`❌ ${test.description}`);
    console.error(`   Error: ${error.message}`);
    failed++;
  }
}

console.log('\n📊 Regression Test Results:');
console.log('============================');
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);

if (failed > 0) {
  console.error('\n🚨 REGRESSION DETECTED!');
  console.error('❌ Critical token mappings are broken');
  console.error('❌ DEPLOY BLOCKED - Fix issues before deployment');
  process.exit(1);
}

console.log('\n🎯 All regression tests passed!');
console.log('✅ Safe to deploy');
process.exit(0);