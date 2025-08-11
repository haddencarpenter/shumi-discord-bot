import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { fetchCoinData } from '../price-smart.js';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const query = (text, params) => pool.query(text, params);

const TICKER_RE = /\b([a-z]{2,10})(?:usdt|usd|perp)?\b/i;
const TF_RE = /\b(1m|3m|5m|15m|30m|45m|1h|2h|3h|4h|1d|3d|1w|1M)\b/i;
const SCORE_THRESHOLD = 70;

async function isEnabled(channelId) {
  const { rows } = await query('SELECT autoprofile_enabled FROM channel_settings WHERE channel_id=$1', [channelId]);
  return rows.length ? !!rows[0].autoprofile_enabled : true;
}

function score(msg) {
  if (!msg.attachments.size) return 0;
  const img = [...msg.attachments.values()].find(a => a.contentType?.startsWith('image/'));
  if (!img) return -100;
  
  const text = (msg.content || '') + ' ' + [...msg.attachments.values()].map(a => a.name).join(' ');
  let s = 0;
  
  if (TICKER_RE.test(text) && TF_RE.test(text)) s += 45;
  if (/tradingview|chart|screenshot/i.test(text)) s += 30;
  if (/(binance|coinbase|bybit|okx|kraken|[A-Z]{3,}USDT|PERP)/i.test(text)) s += 20;
  
  const ratio = img.width && img.height ? img.width / img.height : 0;
  if (ratio >= 1.3 && ratio <= 2.0) s += 15;
  if (/\.gif$/i.test(img.name || '')) s -= 40;
  
  return s;
}

export function initImageProfileGuard(client) {
  client.on('messageCreate', async (m) => {
    try {
      if (!m.guild || m.author.bot) return;
      if (!(await isEnabled(m.channelId))) return;
      const sc = score(m); 
      if (sc < SCORE_THRESHOLD) return;

      const text = (m.content || '') + ' ' + [...m.attachments.values()].map(a => a.name).join(' ');
      const raw = text.match(TICKER_RE)?.[1]?.toLowerCase() || '';
      const tf = text.match(TF_RE)?.[1]?.toLowerCase() || '4h';

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`ap_profile:${raw}:${tf}`)
          .setLabel(`Profile ${raw.toUpperCase()} ${tf}`)
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`ap_ignore`)
          .setLabel('Ignore')
          .setStyle(ButtonStyle.Secondary)
      );
      
      await m.reply({ 
        content: 'Chart detected. Quick CoinRotator profile?', 
        components: [row] 
      });
    } catch(e) { 
      console.error('[imageProfileGuard]', e); 
    }
  });

  // Button handler
  client.on('interactionCreate', async (i) => {
    try {
      if (!i.isButton()) return;
      if (i.customId === 'ap_ignore') return i.deferUpdate();
      if (!i.customId.startsWith('ap_profile:')) return;

      const [, ticker, tf] = i.customId.split(':');
      await i.update({ 
        content: `Profiling ${ticker.toUpperCase()} ${tf}…`, 
        components: [] 
      });

      const id = ticker.toLowerCase();
      const coinData = await fetchCoinData(id); 
      if (!coinData) return;
      
      const changeTxt = `${coinData.change24h >= 0 ? '▲' : '▼'} ${Math.abs(coinData.change24h).toFixed(2)}% 24h`;
      const embed = new EmbedBuilder()
        .setTitle(`${ticker.toUpperCase()} • CoinRotator`)
        .setURL(`https://coinrotator.app/coin/${id}`)
        .setDescription(`**Price:** ${coinData.price.toLocaleString()} • ${changeTxt}`);
        
      await i.followUp({ embeds: [embed] });
    } catch(e) { 
      console.error('[imageProfileGuard.btn]', e); 
    }
  });
}