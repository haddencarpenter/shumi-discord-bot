// Check what data fetchCoinData returns
import { fetchCoinData } from './src/price-enhanced-smart.js';

console.log('Testing what data fetchCoinData returns...\n');

try {
  const coinData = await fetchCoinData('btc');
  console.log('BTC data structure:');
  console.log(JSON.stringify(coinData, null, 2));
} catch (error) {
  console.error('Error:', error.message);
}

