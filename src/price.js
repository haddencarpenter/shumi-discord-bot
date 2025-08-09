import axios from 'axios';
export async function fetchUsdPrice(id) {
  // Handle stablecoins at fixed $1.00
  if (id.toLowerCase() === 'usdt' || id.toLowerCase() === 'usdc') return 1.0;
  
  const q = encodeURIComponent(String(id).toLowerCase());
  const { data } = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${q}&vs_currencies=usd`, { timeout: 8000 });
  const k = Object.keys(data)[0];
  if (!k || data[k]?.usd == null) throw new Error(`price not found for ${id}`);
  return Number(data[k].usd);
}