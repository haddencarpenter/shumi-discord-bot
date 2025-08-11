import { EmbedBuilder } from 'discord.js';
import { fetchCoinData } from '../price-cached.js';
import { query } from '../db.js';

const TRIGGER = /^\s*fc\s+([a-z0-9:_\/-]{2,15})(?:\s+(\d+[mhdw]|1m|5m|15m|30m|45m|1h|2h|3h|4h|1d|3d|1w|1M))?/i;
const MAP = { btc:'bitcoin', eth:'ethereum', sol:'solana', link:'chainlink' };
const cd = new Map();
const COOLDOWN_MS = 60_000;

function normalize(raw) {
  let t = raw.toLowerCase().replace(/[:/_-]/g,'').replace(/(perp|usdt|usd)$/i,'');
  return MAP[t] || t;
}

async function isEnabled(channelId) {
  const { rows } = await query('SELECT autoprofile_enabled FROM channel_settings WHERE channel_id=$1', [channelId]);
  return rows.length ? !!rows[0].autoprofile_enabled : true;
}

export function initAutoProfile(client) {
  client.on('messageCreate', async (m) => {
    try {
      if (!m.guild || m.author.id === client.user.id) return;
      if (!(await isEnabled(m.channelId))) return;
      const hit = m.content?.match(TRIGGER); 
      if (!hit) return;

      const raw = hit[1]; 
      const tf = (hit[2] || '4h').toLowerCase();
      const id = normalize(raw);

      const key = `${m.channelId}:${id}`, now = Date.now();
      if (cd.get(key) && now - cd.get(key) < COOLDOWN_MS) return;
      cd.set(key, now);

      const coinData = await fetchCoinData(id);
      if (!coinData) return;
      
      const changeTxt = `${coinData.change24h >= 0 ? '▲' : '▼'} ${Math.abs(coinData.change24h).toFixed(2)}% 24h`;
      const url = `https://coinrotator.app/coin/${id}`;

      const embed = new EmbedBuilder()
        .setTitle(`${raw.toUpperCase()} • CoinRotator`)
        .setURL(url)
        .setDescription(`**Price:** ${coinData.price.toLocaleString()} • ${changeTxt}\n${coinData.marketCap ? `**Mcap:** ${(coinData.marketCap/1e9).toFixed(1)}B\n` : ''}_Triggered:_ \`${m.content.slice(0,80)}${m.content.length>80?'…':''}\``)
        .setFooter({ text: `TF: ${tf} • Click title for details` });

      await m.reply({ embeds: [embed] });
    } catch(e) { 
      console.error('[autoProfile]', e); 
    }
  });
}