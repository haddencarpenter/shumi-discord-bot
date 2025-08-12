// test-single-letters.js - Test single letter mappings
import 'dotenv/config';
import { resolveQuery } from './src/resolver-advanced.js';

console.log('🔤 Testing Single Letter Ticker Mappings');

async function testLetters() {
  const letters = ['w', 'x', 'z', 't', 'n', 's', 'q', 'h', 'g', 'f', 'a'];
  
  for (const letter of letters) {
    try {
      const resolution = await resolveQuery(letter);
      console.log(`✅ ${letter.toUpperCase()} → ${resolution.id}`);
    } catch (error) {
      console.log(`❌ ${letter.toUpperCase()} → Error: ${error.message}`);
    }
  }
}

testLetters();