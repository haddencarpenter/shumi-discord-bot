import 'dotenv/config';
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { fetchUsdPrice, fetchCoinData } from './price-enhanced-smart.js';
import { parseInputTokens, getPricesWithFallback, formatPriceForDiscord } from './price-cg-service.js';
import { query } from './db.js';
import { normalizeTicker } from './util/tickers.js';
import { version, shortVersion, startedAt } from './version.js';
import smartResolver from './smart-resolver-v2.js';

const enableAuto = (process.env.SHUMI_AUTOPROFILE || 'off') === 'on';

const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent
  ] 
});

const rateLimits = new Map();

function checkRateLimit(userId) {
  const now = Date.now();
  const userLimits = rateLimits.get(userId) || [];
  const recentActions = userLimits.filter(t => now - t < 30000);
  if (recentActions.length >= 5) return false;
  recentActions.push(now);
  rateLimits.set(userId, recentActions);
  return true;
}

function formatPrice(price) {
  if (price >= 1000) return price.toFixed(2);
  if (price >= 1) return price.toFixed(4);
  if (price >= 0.001) return price.toFixed(6);
  if (price >= 0.000001) return price.toFixed(8);
  if (price >= 0.000000001) return price.toFixed(10);
  return price.toExponential(3); // For extremely small values like 1e-12
}

function getIsoWeek(d) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(),0,1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

function startOfIsoWeek(d){const x=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()));const k=(x.getUTCDay()+6)%7;x.setUTCDate(x.getUTCDate()-k);x.setUTCHours(0,0,0,0);return x;}
function endOfIsoWeek(d){const s=startOfIsoWeek(d);const e=new Date(s);e.setUTCDate(s.getUTCDate()+7);e.setUTCHours(0,0,0,0);return e;}

async function ensureUser(discordId, username = 'Unknown') {
  const { rows } = await query(
    'INSERT INTO users(discord_id, discord_username) VALUES($1, $2) ON CONFLICT(discord_id) DO UPDATE SET discord_username=$2 RETURNING id',
    [discordId, username]
  );
  return rows[0].id;
}

async function ensureCurrentWeek() {
  const now = new Date();
  const week = getIsoWeek(now);
  const start = startOfIsoWeek(now).toISOString();
  const end = endOfIsoWeek(now).toISOString();
  
  const { rows } = await query(
    'INSERT INTO competitions(week_number,start_at,end_at) VALUES($1,$2,$3) ON CONFLICT(week_number) DO UPDATE SET week_number=$1 RETURNING id',
    [week, start, end]
  );
  return { competition_id: rows[0].id };
}

async function upsertEntry(compId, userId) {
  const { rows } = await query(
    'INSERT INTO entries(competition_id,user_id) VALUES($1,$2) ON CONFLICT(competition_id,user_id) DO UPDATE SET competition_id=$1 RETURNING id',
    [compId, userId]
  );
  return rows[0].id;
}

export async function startDiscord() {
  // Warm resolver cache before starting Discord client
  const { loadCache } = await import('./resolve.js');
  await loadCache(true);
  
  client.once('ready', async () => {
    console.log('Bot connected as:', client.user.tag);
    
    // Conditionally initialize auto-profile features
    if (enableAuto) {
      const { initAutoProfile } = await import('./listeners/autoProfile.js');
      const { initImageProfileGuard } = await import('./listeners/imageProfileGuard.js');
      initAutoProfile(client);
      initImageProfileGuard(client);
      console.log('Auto-profile features: ENABLED');
    } else {
      console.log('Auto-profile features: DISABLED');
    }
  });

  const coreCommands = [
    new SlashCommandBuilder().setName('ping').setDescription('test if bot is alive'),
    new SlashCommandBuilder().setName('join').setDescription('join the current week'),
    new SlashCommandBuilder()
      .setName('enter')
      .setDescription('enter a trade: /enter btc long, /enter doge short')
      .addStringOption(o=>o.setName('command').setDescription('ticker and side (e.g. "btc long" or "doge short")').setRequired(true)),
    new SlashCommandBuilder()
      .setName('exit')
      .setDescription('exit a trade: /exit btc, /exit doge')
      .addStringOption(o=>o.setName('ticker').setDescription('ticker to exit').setRequired(true)),
    new SlashCommandBuilder()
      .setName('trade')
      .setDescription('enter or exit a trade (advanced)')
      .addStringOption(o=>o.setName('action').setDescription('enter or exit').setRequired(true).addChoices(
        { name:'enter', value:'enter' }, { name:'exit', value:'exit' }
      ))
      .addStringOption(o=>o.setName('ticker').setDescription('ticker like btc, eth, mog').setRequired(true))
      .addStringOption(o=>o.setName('side').setDescription('long or short').setRequired(false).addChoices(
        { name:'long', value:'long' }, { name:'short', value:'short' }
      ))
      .addStringOption(o=>o.setName('comment').setDescription('optional note')),
    new SlashCommandBuilder().setName('leaderboard').setDescription('weekly top 10'),
    new SlashCommandBuilder()
      .setName('positions')
      .setDescription('view open positions')
      .addStringOption(o=>o.setName('target').setDescription('user or all').setRequired(false)),
    new SlashCommandBuilder()
      .setName('price')
      .setDescription('get current prices')
      .addStringOption(o=>o.setName('tickers').setDescription('space-separated tickers (max 10)').setRequired(true)),
    new SlashCommandBuilder()
      .setName('resolver-stats')
      .setDescription('📊 Show smart resolver learning statistics'),
    new SlashCommandBuilder()
      .setName('resolver-relearn')
      .setDescription('🔄 Force relearn a ticker mapping')
      .addStringOption(o=>o.setName('ticker').setDescription('Ticker to relearn').setRequired(true)),
    new SlashCommandBuilder()
      .setName('resolver-ban')
      .setDescription('🚫 Ban a ticker from learning (admin only)')
      .addStringOption(o=>o.setName('ticker').setDescription('Ticker to ban').setRequired(true))
      .addStringOption(o=>o.setName('reason').setDescription('Ban reason').setRequired(false))
  ];

  // Only add autoprofile command if feature is enabled
  const autoCommands = enableAuto ? [
    new SlashCommandBuilder()
      .setName('autoprofile')
      .setDescription('Enable/disable Shumi auto-profile in this channel')
      .addStringOption(o => o.setName('state').setDescription('on or off').setRequired(true)
        .addChoices({name:'on', value:'on'}, {name:'off', value:'off'}))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
  ] : [];

  const commands = [...coreCommands, ...autoCommands].map(c=>c.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  
  if (process.env.DISCORD_GUILD_ID) {
    await rest.put(
      Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
      { body: commands }
    );
    console.log(`Registered ${commands.length} guild commands for GUILD_ID ${process.env.DISCORD_GUILD_ID}`);
  } else {
    await rest.put(
      Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
      { body: commands }
    );
    console.log(`Registered ${commands.length} global commands`);
  }

  // Handle text-based commands with "shumi" prefix
  const processed = new Set();
  client.on('messageCreate', async (message) => {
    try {
      if (message.author.bot) return;
      if (processed.has(message.id)) return; // Prevent duplicate processing
      processed.add(message.id);
      
      const text = message.content.toLowerCase().trim();
      if (!text.startsWith('shumi ')) return;
      
      const commandText = text.slice(6).trim();
      const parts = commandText.split(/\s+/);
      const command = parts[0];
      
      console.log(`[TEXT] user:${message.author.username} cmd:${command} args:${parts.slice(1).join(' ')}`);
      
      if (['price', 'enter', 'exit', 'trade', 'positions'].includes(command)) {
        if (!checkRateLimit(message.author.id)) {
          await message.reply('Rate limit: max 5 actions per 30 seconds. Please wait.');
          return;
        }
      }
      
      if (command === 'price' && parts.length > 1) {
        const tickers = parts.slice(1).join(' ');
        await handlePriceCommand(message, tickers);
      } else if (command === 'enter' && parts.length >= 2) {
        const ticker = parts[1];
        const side = parts[2] || 'long';
        await handleEnterCommand(message, ticker, side);
      } else if (command === 'exit' && parts.length >= 2) {
        const ticker = parts[1];
        await handleExitCommand(message, ticker);
      } else if (command === 'positions') {
        const target = parts[1] || null;
        await handlePositionsCommand(message, target);
      } else if (command === 'ping') {
        await message.reply('Pong! Shumi bot is alive and responding.');
      } else if (command === 'status') {
        await handleStatusCommand(message);
      } else if (command === 'join') {
        await handleJoinCommand(message);
      } else if (command === 'leaderboard') {
        await handleLeaderboardCommand(message);
      } else if (command === 'help') {
        await handleHelpCommand(message);
      } else if (command === 'whoami') {
        await message.reply(`Your Discord ID: ${message.author.id}`);
      } else if (command === 'debug' && message.author.id === '396270927811313665') {
        // Admin only debug command
        const subcommand = parts[1];
        console.log(`[DEBUG] Command received. Subcommand: "${subcommand}", Parts:`, parts);
        
        if (!subcommand) {
          await message.reply('Debug commands: `shumi debug [hype|lmeow|fartcoin|lido|ldo]`, `shumi debug fix [id] [price]`');
          return;
        }
        
        if (subcommand === 'hype' || subcommand === 'lmeow' || subcommand === 'fartcoin' || subcommand === 'lido' || subcommand === 'ldo') {
          const ticker = normalizeTicker(subcommand);
          console.log(`[DEBUG ticker] raw:${subcommand} → normalized:${ticker}`);
          const { rows } = await query(
            "SELECT id, ticker, entry_price, exit_price, pnl_pct, entry_time, exit_time, status FROM trades WHERE ticker=$1 ORDER BY id DESC LIMIT 3",
            [ticker]
          );
          if (!rows.length) {
            await message.reply(`No ${ticker.toUpperCase()} trades found`);
            return;
          }
          const debug = rows.map(r => `ID:${r.id} ${r.ticker} ${r.status} entry:$${r.entry_price} exit:$${r.exit_price || 'N/A'} pnl:${r.pnl_pct || 'N/A'}%`).join('\n');
          await message.reply(`\`\`\`${debug}\`\`\``);
        } else if (subcommand === 'fix' && parts[2] && parts[3]) {
          // Fix any trade PnL: shumi debug fix TRADE_ID CORRECT_ENTRY_PRICE
          const tradeId = parts[2];
          const correctEntryPrice = Number(parts[3]);
          
          if (isNaN(correctEntryPrice) || correctEntryPrice <= 0) {
            await message.reply('Invalid entry price. Use: shumi debug fix TRADE_ID PRICE');
            return;
          }
          
          // Get the trade details
          const { rows } = await query("SELECT * FROM trades WHERE id=$1", [tradeId]);
          if (!rows.length) {
            await message.reply('Trade not found');
            return;
          }
          
          const trade = rows[0];
          const oldEntryPrice = Number(trade.entry_price);
          const oldPnl = Number(trade.pnl_pct);
          
          // Calculate correct PnL
          const exitPrice = Number(trade.exit_price);
          let correctPnl;
          if (trade.side === 'long') {
            correctPnl = ((exitPrice - correctEntryPrice) / correctEntryPrice) * 100;
          } else {
            correctPnl = ((correctEntryPrice - exitPrice) / correctEntryPrice) * 100;
          }
          
          // Update the trade
          await query(
            "UPDATE trades SET entry_price=$1, pnl_pct=$2 WHERE id=$3",
            [correctEntryPrice, correctPnl, tradeId]
          );
          
          await message.reply(`Fixed ${trade.ticker.toUpperCase()} trade ${tradeId}:\nEntry: $${oldEntryPrice} → $${correctEntryPrice}\nPnL: ${oldPnl.toFixed(2)}% → ${correctPnl.toFixed(2)}%`);
        } else if (subcommand === 'fixfull' && parts[2] && parts[3] && parts[4]) {
          // Fix both entry and exit prices: shumi debug fixfull TRADE_ID ENTRY_PRICE EXIT_PRICE
          const tradeId = parts[2];
          const correctEntryPrice = Number(parts[3]);
          const correctExitPrice = Number(parts[4]);
          
          if (isNaN(correctEntryPrice) || correctEntryPrice <= 0 || isNaN(correctExitPrice) || correctExitPrice <= 0) {
            await message.reply('Invalid prices. Use: shumi debug fixfull TRADE_ID ENTRY_PRICE EXIT_PRICE');
            return;
          }
          
          // Get the trade details
          const { rows } = await query("SELECT * FROM trades WHERE id=$1", [tradeId]);
          if (!rows.length) {
            await message.reply('Trade not found');
            return;
          }
          
          const trade = rows[0];
          const oldEntryPrice = Number(trade.entry_price);
          const oldExitPrice = Number(trade.exit_price);
          const oldPnl = Number(trade.pnl_pct);
          
          // Calculate correct PnL
          let correctPnl;
          if (trade.side === 'long') {
            correctPnl = ((correctExitPrice - correctEntryPrice) / correctEntryPrice) * 100;
          } else {
            correctPnl = ((correctEntryPrice - correctExitPrice) / correctEntryPrice) * 100;
          }
          
          // Update the trade
          await query(
            "UPDATE trades SET entry_price=$1, exit_price=$2, pnl_pct=$3 WHERE id=$4",
            [correctEntryPrice, correctExitPrice, correctPnl, tradeId]
          );
          
          await message.reply(`Fixed ${trade.ticker.toUpperCase()} trade ${tradeId}:\nEntry: $${oldEntryPrice} → $${correctEntryPrice}\nExit: $${oldExitPrice} → $${correctExitPrice}\nPnL: ${oldPnl.toFixed(2)}% → ${correctPnl.toFixed(2)}%`);
        } else if (subcommand === 'delete' && parts[2]) {
          // Delete a trade entirely: shumi debug delete TRADE_ID
          const tradeId = parts[2];
          
          // Get the trade details first
          const { rows } = await query("SELECT * FROM trades WHERE id=$1", [tradeId]);
          if (!rows.length) {
            await message.reply('Trade not found');
            return;
          }
          
          const trade = rows[0];
          
          // Delete the trade
          await query("DELETE FROM trades WHERE id=$1", [tradeId]);
          
          await message.reply(`🗑️ Deleted ${trade.ticker.toUpperCase()} trade ${tradeId}:\nEntry: $${trade.entry_price}, Exit: $${trade.exit_price || 'N/A'}, PnL: ${Number(trade.pnl_pct || 0).toFixed(2)}%\n\n⚠️ This action cannot be undone!`);
        } else {
          console.log(`[DEBUG] Unknown subcommand: "${subcommand}"`);
          await message.reply(`Unknown debug subcommand: "${subcommand}". Try: hype, lmeow, fartcoin, lido, ldo, fix, fixfull, delete`);
        }
      } else if (command === 'debug') {
        // Non-admin attempting debug
        console.log(`[DEBUG] Non-admin attempt by ${message.author.id}`);
        await message.reply(`Debug commands are admin-only. Your ID: ${message.author.id}`);
      } else {
        await message.reply('Unknown command. Try `shumi help` to see all available commands.');
      }
    } catch (err) {
      console.error('[TEXT ERROR]', err);
      await message.reply('Error occurred. Try again later.').catch(() => {});
    }
  });

  // Handle slash commands
  client.on('interactionCreate', async (i) => {
    try {
      if (!i.isChatInputCommand()) return;
      
      const ticker = i.options.getString('ticker') || i.options.getString('tickers') || '';
      console.log(`[SLASH] user:${i.user.username} cmd:${i.commandName} ticker:${ticker}`);
      
      if (i.commandName === 'ping') {
        await i.reply({ content: 'Pong! Bot is alive and responding.' });
        return;
      }
      
      if (['trade', 'join', 'enter', 'exit'].includes(i.commandName)) {
        if (!checkRateLimit(i.user.id)) {
          await i.reply({ content: 'Rate limit: max 5 actions per 30 seconds. Please wait.', flags: 64 });
          return;
        }
      }

      if (i.commandName === 'join') {
        const { competition_id } = await ensureCurrentWeek();
        const userId = await ensureUser(i.user.id, i.user.username);
        await upsertEntry(competition_id, userId);
        await i.reply({ content: 'joined this week' });
      }

      if (i.commandName === 'trade') {
        const action = i.options.getString('action');
        const ticker = i.options.getString('ticker').toLowerCase();
        const side = i.options.getString('side') || 'long';
        const comment = i.options.getString('comment') || '';
        const nowIso = new Date().toISOString();
        
        let price;
        try {
          price = await fetchUsdPrice(ticker);
          console.log(`Price fetched: ${ticker} = $${price}`);
        } catch (err) {
          await i.reply({ content: `ticker not found. try common tickers like btc, eth, sol, doge, shib, pepe`, flags: 64 });
          return;
        }
        
        const { competition_id } = await ensureCurrentWeek();
        const userId = await ensureUser(i.user.id, i.user.username);
        const entryId = await upsertEntry(competition_id, userId);

        if (action === 'enter') {
          const existingTrade = await query(
            'SELECT id, side FROM trades WHERE entry_id=$1 AND ticker=$2 AND status=\'open\'',
            [entryId, ticker]
          );
          if (existingTrade.rows.length > 0) {
            await i.reply({ 
              content: `You already have an open ${existingTrade.rows[0].side} position on ${ticker.toUpperCase()}. Close it first with \`/exit ${ticker}\` to enter a new trade.`, 
              flags: 64 
            });
            return;
          }
          
          const { rows } = await query(
            'INSERT INTO trades(entry_id,ticker,side,entry_price,entry_time,comment,status) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
            [entryId, ticker, side, price, nowIso, comment, 'open']
          );
          const tradeId = rows[0].id;
          
          const sideEmoji = side === 'long' ? '📈' : '📉';
          const sideColor = side === 'long' ? 0x00ff00 : 0xff6600;
          
          const embed = new EmbedBuilder()
            .setTitle('Trade Entered')
            .setColor(sideColor)
            .addFields(
              { name:'Ticker', value:ticker.toUpperCase(), inline:true },
              { name:'Side', value:`${sideEmoji} ${side.toUpperCase()}`, inline:true },
              { name:'Entry Price', value:`$${formatPrice(price)}`, inline:true },
              { name:'Trade ID', value:`#${tradeId}`, inline:true }
            )
            .setFooter({ text: `${i.user.username} • ${nowIso}` });
          await i.reply({ embeds:[embed] });
          return;
        }

        if (action === 'exit') {
          const { rows } = await query(
            `SELECT id, entry_price, side FROM trades
             WHERE entry_id=$1 AND ticker=$2 AND status='open'
             ORDER BY id DESC LIMIT 1`, [entryId, ticker]
          );
          if (!rows.length) {
            await i.reply({ content:'no open trade for that ticker', flags: 64 });
            return;
          }
          const t = rows[0];
          
          let pnlPct;
          if (t.side === 'long') {
            pnlPct = ((price - Number(t.entry_price)) / Number(t.entry_price)) * 100;
          } else {
            pnlPct = ((Number(t.entry_price) - price) / Number(t.entry_price)) * 100;
          }
          
          await query(
            `UPDATE trades SET exit_price=$1, exit_time=$2, pnl_pct=$3, status='closed' WHERE id=$4`,
            [price, nowIso, pnlPct, t.id]
          );
          
          const sideEmoji = t.side === 'long' ? '📈' : '📉';
          const profitColor = pnlPct >= 0 ? 0x00ff00 : 0xff0000;
          
          const embed = new EmbedBuilder()
            .setTitle('Trade Closed')
            .setColor(profitColor)
            .addFields(
              { name:'Ticker', value:ticker.toUpperCase(), inline:true },
              { name:'Side', value:`${sideEmoji} ${t.side.toUpperCase()}`, inline:true },
              { name:'Exit Price', value:`$${formatPrice(price)}`, inline:true },
              { name:'P&L', value:`${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%`, inline:true }
            )
            .setFooter({ text: `${i.user.username} • Trade #${t.id}` });
          await i.reply({ embeds:[embed] });
          return;
        }
      }

      // Similar handlers for 'enter' and 'exit' commands
      // (Implementation similar to trade command but simplified)

      if (i.commandName === 'positions') {
        await i.deferReply();
        
        const target = i.options.getString('target');
        const { competition_id } = await ensureCurrentWeek();
        
        if (!target) {
          const userId = await ensureUser(i.user.id, i.user.username);
          const entryResult = await query('SELECT id FROM entries WHERE competition_id=$1 AND user_id=$2', [competition_id, userId]);
          if (!entryResult.rows.length) {
            await i.editReply({ content: 'No positions found' });
            return;
          }
          
          const entryId = entryResult.rows[0].id;
          const { rows } = await query(`SELECT * FROM trades WHERE entry_id=$1 AND status='open' ORDER BY id DESC`, [entryId]);
          
          if (!rows.length) {
            await i.editReply({ content: `${i.user.username}'s positions: None` });
            return;
          }

          const positionsWithPnl = [];
          for (let j = 0; j < rows.length; j++) {
            const r = rows[j];
            try {
              const currentPrice = await fetchUsdPrice(r.ticker);
              const entryPrice = Number(r.entry_price);
              const side = r.side || 'long';
              
              let pnlPct;
              if (side === 'long') {
                pnlPct = ((currentPrice - entryPrice) / entryPrice) * 100;
              } else {
                pnlPct = ((entryPrice - currentPrice) / entryPrice) * 100;
              }
              
              // Debug logging for extreme P&L values
              if (Math.abs(pnlPct) > 1000) {
                console.log(`[P&L DEBUG] ${r.ticker}: entry=$${entryPrice} current=$${currentPrice} pnl=${pnlPct.toFixed(2)}%`);
              }
              
              // Cap extreme P&L values (likely data errors)
              if (Math.abs(pnlPct) > 1000) {
                pnlPct = pnlPct > 0 ? 999.99 : -999.99;
              }
              
              positionsWithPnl.push({ ...r, currentPrice, pnlPct });
            } catch (err) {
              console.log(`Failed to fetch price for ${r.ticker}: ${err.message}`);
              positionsWithPnl.push({ ...r, currentPrice: null, pnlPct: 0 });
            }
            
            if (j < rows.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
          
          const embed = new EmbedBuilder()
            .setTitle(`${i.user.username}'s Open Positions`)
            .setColor(0x0099ff)
            .setDescription(positionsWithPnl.map(r => {
              const sideSymbol = (r.side || 'long') === 'long' ? 'L' : 'S';
              const entryPrice = formatPrice(Number(r.entry_price));
              
              let pnlText = '';
              if (r.currentPrice !== null) {
                const pnlColor = r.pnlPct >= 0 ? '🟢' : '🔴';
                const pnlSign = r.pnlPct >= 0 ? '+' : '';
                pnlText = ` ${pnlColor}${pnlSign}${r.pnlPct.toFixed(2)}%`;
              } else {
                pnlText = ' ⏳';
              }
              
              return `${sideSymbol} **${r.ticker.toUpperCase()}** $${entryPrice}${pnlText}`;
            }).join('\n'))
            .setFooter({ text: `Total: ${rows.length} open positions • Live P&L` });
          
          await i.editReply({ embeds: [embed] });
        }
      }

      if (i.commandName === 'price') {
        await i.deferReply();
        
        const tickersInput = i.options.getString('tickers');
        const tickers = tickersInput.split(/\s+/).slice(0, 6);
        
        const results = [];
        
        for (const ticker of tickers) {
          try {
            const coinData = await fetchCoinData(ticker);
            const price = formatPrice(coinData.price);
            const change = coinData.change24h >= 0 ? `+${coinData.change24h.toFixed(2)}%` : `${coinData.change24h.toFixed(2)}%`;
            const changeEmoji = coinData.change24h >= 0 ? '📈' : '📉';
            
            // Format with coin name for disambiguation  
            const displayName = coinData.coinName 
              ? `**${ticker.toUpperCase()}** (${coinData.coinName})`
              : `**${ticker.toUpperCase()}**`;
            
            let result = `${displayName} $${price} ${changeEmoji} ${change}`;
            
            if (coinData.marketCap) {
              const mcap = coinData.marketCap >= 1e9 
                ? `$${(coinData.marketCap / 1e9).toFixed(1)}B` 
                : `$${(coinData.marketCap / 1e6).toFixed(0)}M`;
              result += ` • ${mcap}`;
            }
            
            results.push(result);
          } catch (err) {
            // Check if it's a single letter or very short input
            if (ticker.length <= 2) {
              results.push(`**${ticker.toUpperCase()}** is too ambiguous. Please type the full ticker name (e.g., $SONIC, $SOL, $SHIB)`);
            } else {
              results.push(`**${ticker.toUpperCase()}** not found`);
            }
          }
          
          if (tickers.length > 1) {
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        }
        
        await i.editReply({ content: results.join('\n') });
      }

      if (i.commandName === 'leaderboard') {
        await i.deferReply();
        const { competition_id } = await ensureCurrentWeek();
        
        // Get closed trades leaderboard
        const { rows: closedRows } = await query(
          `SELECT e.user_id, SUM(COALESCE(t.pnl_pct,0)) as total
           FROM trades t JOIN entries e ON e.id=t.entry_id
           WHERE e.competition_id=$1 AND t.status='closed'
           GROUP BY e.user_id ORDER BY total DESC LIMIT 10`,
          [competition_id]
        );
        
        // Get all open positions with details for P&L calculation
        const { rows: openPositions } = await query(
          `SELECT t.ticker, t.entry_price, t.side, u.discord_username, e.user_id
           FROM trades t 
           JOIN entries e ON e.id = t.entry_id
           JOIN users u ON u.id = e.user_id
           WHERE e.competition_id=$1 AND t.status='open'`,
          [competition_id]
        );
        
        // Also get user position counts for fallback display
        const { rows: userCounts } = await query(
          `SELECT u.discord_username, COUNT(t.id) as position_count
           FROM trades t 
           JOIN entries e ON e.id = t.entry_id
           JOIN users u ON u.id = e.user_id
           WHERE e.competition_id=$1 AND t.status='open'
           GROUP BY u.discord_username`,
          [competition_id]
        );
        
        // Calculate unrealized P&L for each user
        const userUnrealizedPnl = {};
        const userPositions = {};
        const userFallbackCounts = {};
        
        // Store fallback counts
        userCounts.forEach(row => {
          userFallbackCounts[row.discord_username] = row.position_count;
        });
        
        if (openPositions.length > 0) {
          // Get unique tickers and batch resolve to coin IDs
          const uniqueTickers = [...new Set(openPositions.map(p => p.ticker))];
          const tickerPrices = {};
          
            // Import smart price service with fallback logic
  const { default: smartPriceService } = await import('./smart-price-service.js');
          
                     // Use hybrid approach: Symbol index first, smart resolver API fallback
           const resolvedTickers = [];
           const { resolveSymbolToId } = await import('./symbol-index.js');
          
          // Phase 1: Resolve using symbol index (instant, no API calls)
          for (const ticker of uniqueTickers) {
            const indexResult = resolveSymbolToId(ticker);
            if (indexResult) {
              resolvedTickers.push({ ticker, coinId: indexResult.coinId });
              console.log(`[DEBUG] Index resolved ${ticker} → ${indexResult.coinId}`);
            } else {
              resolvedTickers.push({ ticker, coinId: null });
              console.log(`[DEBUG] ${ticker} not in symbol index (top 300), skipping API resolution for leaderboard`);
            }
          }
          
          // Phase 2: For critical failures only, use API (but limit to top 5 missing)
          const unresolved = resolvedTickers.filter(r => !r.coinId).slice(0, 5); // Limit API calls
          if (unresolved.length > 0) {
            console.log(`[DEBUG] Attempting API resolution for ${unresolved.length} critical tickers...`);
            for (let i = 0; i < unresolved.length; i++) {
              const tickerData = unresolved[i];
              try {
                if (i > 0) {
                  await new Promise(resolve => setTimeout(resolve, 3000)); // 3 second delay
                }
                
                                 const coinId = await smartResolver.resolve(tickerData.ticker);
                if (coinId) {
                  // Update in resolvedTickers array
                  const tickerIndex = resolvedTickers.findIndex(r => r.ticker === tickerData.ticker);
                  if (tickerIndex !== -1) {
                    resolvedTickers[tickerIndex].coinId = coinId;
                    console.log(`[DEBUG] API resolved ${tickerData.ticker} → ${coinId}`);
                  }
                }
              } catch (err) {
                console.log(`[DEBUG] API resolution failed for ${tickerData.ticker}:`, err.message);
              }
            }
          }
          const tickerToCoinId = {};
          const validCoinIds = [];
          
          // Build mapping
          resolvedTickers.forEach(r => {
            if (r.coinId) {
              tickerToCoinId[r.ticker] = r.coinId;
              validCoinIds.push(r.coinId);
            }
          });
          
          // Use smart price service with intelligent fallback
          const prices = await smartPriceService.getSmartPrices(validCoinIds);
          
          // Map prices back to tickers
          validCoinIds.forEach((coinId, index) => {
            // Find which ticker this coinId belongs to
            const ticker = Object.keys(tickerToCoinId).find(t => tickerToCoinId[t] === coinId);
            if (ticker && prices[index]) {
              tickerPrices[ticker] = prices[index].price;
            } else if (ticker) {
              tickerPrices[ticker] = null;
            }
          });
          
          // Calculate P&L and duration bonus for each position
          for (const pos of openPositions) {
            const currentPrice = tickerPrices[pos.ticker];
            if (!currentPrice) {
              console.log(`[DEBUG] No price for ${pos.ticker}, skipping position`);
              continue;
            }
            
            const entryPrice = Number(pos.entry_price);
            const side = pos.side || 'long';
            
            // Calculate P&L
            let pnlPct;
            if (side === 'long') {
              pnlPct = ((currentPrice - entryPrice) / entryPrice) * 100;
            } else {
              pnlPct = ((entryPrice - currentPrice) / entryPrice) * 100;
            }
            
            // Calculate duration bonus (1% per day, max 7%)
            const entryTime = new Date(pos.entry_time);
            const now = new Date();
            const daysHeld = Math.max(0, (now - entryTime) / (1000 * 60 * 60 * 24));
            const durationBonus = Math.min(daysHeld * 1, 7); // 1% per day, max 7%
            
            // Calculate final score
            const finalScore = pnlPct + durationBonus;
            
            // Initialize user data if needed
            if (!userUnrealizedPnl[pos.discord_username]) {
              userUnrealizedPnl[pos.discord_username] = [];
              userPositions[pos.discord_username] = [];
            }
            
            userUnrealizedPnl[pos.discord_username].push(finalScore);
            const sideSymbol = (pos.side === 'short') ? 'S' : 'L';
            const bonusIndicator = durationBonus > 0 ? ' *' : '';
            userPositions[pos.discord_username].push(`${sideSymbol} ${pos.ticker.toUpperCase()} ${finalScore >= 0 ? '+' : ''}${finalScore.toFixed(2)}%${bonusIndicator}`);
          }
        }
        
        let description = '';
        
        if (closedRows.length > 0) {
          const closedLines = await Promise.all(closedRows.map(async (r, idx) => {
            const u = await query('SELECT discord_username FROM users WHERE id=$1', [r.user_id]);
            return `${idx+1}. **${u.rows[0].discord_username}** ${Number(r.total).toFixed(2)}%`;
          }));
          description += `**Leaderboard:**\n${closedLines.join('\n')}\n\n`;
        }
        
        // Display live positions - either with P&L or fallback to count
        if (Object.keys(userFallbackCounts).length > 0) {
          const liveLines = Object.keys(userFallbackCounts).map((username, idx) => {
            // Check if we have P&L data for this user
            if (userPositions[username] && userPositions[username].length > 0) {
              const pnlArray = userUnrealizedPnl[username];
              const totalPnl = pnlArray.reduce((sum, pnl) => sum + pnl, 0) / pnlArray.length;
              const totalText = ` | Total: ${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}%`;
              return `${idx+1}. **${username}**: ${userPositions[username].join(' | ')}${totalText}`;
            } else {
              // Fallback to simple position count
              const count = userFallbackCounts[username];
              return `${idx+1}. **${username}**: ${count} position${count > 1 ? 's' : ''}`;
            }
          });
          
          description += `**Live Positions:**\n${liveLines.join('\n')}`;
        }
        
        if (!closedRows.length && Object.keys(userFallbackCounts).length === 0) {
          await i.editReply({ content: 'No participants yet this week. Use `shumi join` to get started!' });
          return;
        }
        
        // Calculate countdown for embed title
        const now = new Date();
        const nextMonday = new Date(now);
        const daysUntilMonday = (7 - now.getUTCDay() + 1) % 7 || 7;
        nextMonday.setUTCDate(now.getUTCDate() + daysUntilMonday);
        nextMonday.setUTCHours(0, 0, 0, 0);
        
        const timeLeft = nextMonday.getTime() - now.getTime();
        const daysLeft = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
        const hoursLeft = Math.floor((timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutesLeft = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
        
        const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][nextMonday.getUTCDay()];
        const timeStr = `${String(nextMonday.getUTCHours()).padStart(2, '0')}:${String(nextMonday.getUTCMinutes()).padStart(2, '0')}:${String(nextMonday.getUTCSeconds()).padStart(2, '0')}`;
        const countdownStr = daysLeft > 0 ? `${daysLeft}d ${hoursLeft}h ${minutesLeft}m` : `${hoursLeft}h ${minutesLeft}m`;
        
        const embed = new EmbedBuilder()
          .setTitle(`Week ${getIsoWeek(new Date())} Competition`)
          .setColor(0xffd700)
          .setDescription(`⏰ Ends: ${dayName} ${timeStr} (in ${countdownStr})\n\n${description}`)
          .setFooter({ text: 'Close trades to appear in rankings • Live P&L in shumi positions' });
        
        await i.editReply({ embeds: [embed] });
      }

      if (i.commandName === 'resolver-stats') {
        await i.deferReply();
        
        const stats = await smartResolver.getStats();
        
        if (stats.error) {
          await i.editReply(`❌ Stats unavailable: ${stats.error}`);
          return;
        }
        
        const cacheHitRate = stats.totalCacheHits > 0 ? 
          ((stats.totalCacheHits / (stats.totalCacheHits + stats.recentFailures)) * 100).toFixed(1) : 0;
        
        const embed = new EmbedBuilder()
          .setTitle('🧠 Smart Resolver v2 Statistics')
          .setColor(0x00ff88)
          .setDescription(
            `**Learning Status:**\n` +
            `📚 Learned Mappings: **${stats.learnedMappings}**\n` +
            `🚫 Banned Mappings: **${stats.bannedMappings}**\n` +
            `🆕 Recent Learnings (24h): **${stats.recentLearnings}**\n` +
            `❌ Active Failures (in backoff): **${stats.activeFallures}**\n\n` +
            
            `**Performance:**\n` +
            `🎯 Cache Hit Rate: **${cacheHitRate}%**\n` +
            `📊 Total Cache Hits: **${stats.totalCacheHits.toLocaleString()}**\n` +
            `💾 Memory Cache: **${stats.memoryCacheSize}** entries\n` +
            `⏳ Hit Buffer: **${stats.hitBufferSize}** pending\n\n` +
            
            `**Security:**\n` +
            `🛡️ Poisoning Protection: **Active**\n` +
            `🔥 Warmup: **${stats.warmupComplete ? 'Complete' : 'Pending'}**\n` +
            `🤖 Learning: **Active with validation**`
          )
          .setFooter({ text: 'V2: Enhanced with anti-poisoning • Blocks wrapped/staked/stable coins' });
        
        await i.editReply({ embeds: [embed] });
      }

      if (i.commandName === 'resolver-relearn') {
        await i.deferReply();
        
        const ticker = i.options.getString('ticker');
        console.log(`[ADMIN] Force relearning ticker: ${ticker}`);
        
        const result = await smartResolver.forceRelearn(ticker);
        
        if (result) {
          await i.editReply(`✅ Successfully relearned: **${ticker.toUpperCase()}** → **${result}**`);
        } else {
          await i.editReply(`❌ Failed to relearn **${ticker.toUpperCase()}** - ticker may not exist on CoinGecko`);
        }
      }

      if (i.commandName === 'resolver-ban') {
        await i.deferReply();
        
        // Admin only command
        if (i.user.id !== '396270927811313665') {
          await i.editReply(`❌ This command is admin-only. Your ID: ${i.user.id}`);
          return;
        }
        
        const ticker = i.options.getString('ticker');
        const reason = i.options.getString('reason') || 'admin_banned';
        
        console.log(`[ADMIN] Banning ticker: ${ticker} (${reason})`);
        
        const success = await smartResolver.forceBan(ticker, reason);
        
        if (success) {
          await i.editReply(`🚫 Successfully banned: **${ticker.toUpperCase()}** (${reason})`);
        } else {
          await i.editReply(`❌ Failed to ban **${ticker.toUpperCase()}** - invalid ticker`);
        }
      }

      if (i.commandName === 'autoprofile') {
        if (!enableAuto) {
          await i.reply({ content: 'Auto-profile features are currently disabled.', flags: 64 });
          return;
        }
        const enabled = i.options.getString('state') === 'on';
        await query(`
          INSERT INTO channel_settings (channel_id, autoprofile_enabled)
          VALUES ($1, $2)
          ON CONFLICT (channel_id) DO UPDATE SET autoprofile_enabled=EXCLUDED.autoprofile_enabled, updated_at=NOW()
        `, [i.channelId, enabled]);
        
        await i.reply({ 
          content: `Auto-profile **${enabled ? 'enabled' : 'disabled'}** for <#${i.channelId}>.`, 
          flags: 64 
        });
      }
    } catch (err) {
      console.error('[ERROR]', err);
      if (i.isRepliable()) await i.reply({ content:'error occurred. try again later.', flags: 64 }).catch(()=>{});
    }
  });

  await client.login(process.env.DISCORD_TOKEN);
  console.log('Bot is running!');
}

// Handler functions for text-based commands
async function handlePriceCommand(message, tickersInput) {
  const reply = await message.reply('Fetching prices...');
  const tickers = tickersInput.split(/\s+/).slice(0, 6);
  const results = [];
  let method = 'unknown';
  let source = 'unknown';
  
  // Batch fetch all prices at once for efficiency
  if (tickers.length > 1) {
    try {
      // Use the existing batching system for maximum API efficiency
      const { getPrices } = await import('./cg-batcher.js');
      
      // First, resolve tickers to coin IDs using the existing resolver
      const resolvePromises = tickers.map(async ticker => {
        try {
          const coinId = await smartResolver.resolve(ticker);
          return { ticker, coinId };
        } catch (err) {
          console.log(`[DEBUG] Failed to resolve ${ticker}:`, err.message);
          return { ticker, coinId: null };
        }
      });
      
      const resolvedTickers = await Promise.all(resolvePromises);
      const tickerToCoinId = {};
      const validCoinIds = [];
      
      // Build mapping of ticker -> coinId
      resolvedTickers.forEach(r => {
        if (r.coinId) {
          tickerToCoinId[r.ticker] = r.coinId;
          validCoinIds.push(r.coinId);
        }
      });
      
      // Use smart price service with intelligent fallback
      const { default: smartPriceService } = await import('./smart-price-service.js');
      const prices = await smartPriceService.getSmartPrices(validCoinIds);
      
      // Map prices back to tickers and fetch additional data
      const tickerData = {};
      validCoinIds.forEach((coinId, index) => {
        const ticker = Object.keys(tickerToCoinId).find(t => tickerToCoinId[t] === coinId);
        if (ticker && prices[index]) {
          tickerData[ticker] = { price: prices[index].price };
        }
      });
      
      // Fetch additional data (24h change, market cap) for resolved tickers
      for (const ticker of tickers) {
        if (tickerData[ticker]) {
          try {
            const coinData = await fetchCoinData(ticker);
            tickerData[ticker] = { ...tickerData[ticker], ...coinData };
            method = coinData.method || 'batch';
            source = coinData.source || 'coingecko-batch';
          } catch (err) {
            console.log(`[DEBUG] Failed to fetch additional data for ${ticker}:`, err.message);
          }
        }
      }
      
      // Build results from batch data
      for (const ticker of tickers) {
        if (tickerData[ticker] && tickerData[ticker].price) {
          const data = tickerData[ticker];
          const price = formatPrice(data.price);
          const change = data.change24h >= 0 ? `+${data.change24h.toFixed(2)}%` : `${data.change24h.toFixed(2)}%`;
          const changeEmoji = data.change24h >= 0 ? '📈' : '📉';
          
          // Format with coin name for disambiguation
          const displayName = data.coinName 
            ? `**${ticker.toUpperCase()}** (${data.coinName})`
            : `**${ticker.toUpperCase()}**`;
          
          let result = `${displayName} $${price} ${changeEmoji} ${change}`;
          if (data.marketCap) {
            const mcap = data.marketCap >= 1e9 
              ? `$${(data.marketCap / 1e9).toFixed(1)}B` 
              : `$${(data.marketCap / 1e6).toFixed(0)}M`;
            result += ` • ${mcap}`;
          }
          
          // Show if data is stale
          if (data.isStale) {
            result += ` ⏰${data.ageMinutes}m old`;
          }
          
          results.push(result);
        } else {
          // Fallback to individual fetch for failed tickers
          try {
            const coinData = await fetchCoinData(ticker);
            const price = formatPrice(coinData.price);
            const change = coinData.change24h >= 0 ? `+${coinData.change24h.toFixed(2)}%` : `${coinData.change24h.toFixed(2)}%`;
            const changeEmoji = coinData.change24h >= 0 ? '📈' : '📉';
            
            // Format with coin name for disambiguation
            const displayName = coinData.coinName 
              ? `**${ticker.toUpperCase()}** (${coinData.coinName})`
              : `**${ticker.toUpperCase()}**`;
            
            let result = `${displayName} $${price} ${changeEmoji} ${change}`;
            if (coinData.marketCap) {
              const mcap = coinData.marketCap >= 1e9 
                ? `$${(coinData.marketCap / 1e9).toFixed(1)}B` 
                : `$${(coinData.marketCap / 1e6).toFixed(0)}M`;
              result += ` • ${mcap}`;
            }
            
            // Show if data is stale
            if (coinData.isStale) {
              result += ` ⏰${coinData.ageMinutes}m old`;
            }
            
            results.push(result);
            method = coinData.method || 'individual';
            source = coinData.source || 'coingecko';
          } catch (err) {
            if (err.message.includes('429') || err.message.includes('rate limit')) {
              results.push(`**${ticker.toUpperCase()}** rate limited (try again in 1 min)`);
            } else if (ticker.length <= 2) {
              results.push(`**${ticker.toUpperCase()}** is too ambiguous. Please type the full ticker name (e.g., $SONIC, $SOL, $SHIB)`);
            } else {
              results.push(`**${ticker.toUpperCase()}** not found`);
            }
          }
        }
      }
    } catch (err) {
      console.log('[DEBUG] Batch price fetch failed, falling back to individual calls:', err.message);
      // Fallback to original individual approach
      for (const ticker of tickers) {
        try {
          const coinData = await fetchCoinData(ticker);
          const price = formatPrice(coinData.price);
          const change = coinData.change24h >= 0 ? `+${coinData.change24h.toFixed(2)}%` : `${coinData.change24h.toFixed(2)}%`;
          const changeEmoji = coinData.change24h >= 0 ? '📈' : '📉';
          
          // Capture method/source from first successful fetch
          if (method === 'unknown' && coinData.method) method = coinData.method;
          if (source === 'unknown' && coinData.source) source = coinData.source;
          
          // Format with coin name for disambiguation
          const displayName = coinData.coinName 
            ? `**${ticker.toUpperCase()}** (${coinData.coinName})`
            : `**${ticker.toUpperCase()}**`;
          
          let result = `${displayName} $${price} ${changeEmoji} ${change}`;
          if (coinData.marketCap) {
            const mcap = coinData.marketCap >= 1e9 
              ? `$${(coinData.marketCap / 1e9).toFixed(1)}B` 
              : `$${(coinData.marketCap / 1e6).toFixed(0)}M`;
            result += ` • ${mcap}`;
          }
          
          // Show if data is stale
          if (coinData.isStale) {
            result += ` ⏰${coinData.ageMinutes}m old`;
          }
          
          results.push(result);
        } catch (err) {
          if (err.message.includes('429') || err.message.includes('rate limit')) {
            results.push(`**${ticker.toUpperCase()}** rate limited (try again in 1 min)`);
          } else if (ticker.length <= 2) {
            results.push(`**${ticker.toUpperCase()}** is too ambiguous. Please type the full ticker name (e.g., $SONIC, $SOL, $SHIB)`);
          } else {
            results.push(`**${ticker.toUpperCase()}** not found`);
          }
        }
        if (tickers.length > 1) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
    }
  } else {
    // Single ticker - use individual fetch
    const ticker = tickers[0];
    try {
      const coinData = await fetchCoinData(ticker);
      const price = formatPrice(coinData.price);
      const change = coinData.change24h >= 0 ? `+${coinData.change24h.toFixed(2)}%` : `${coinData.change24h.toFixed(2)}%`;
      const changeEmoji = coinData.change24h >= 0 ? '📈' : '📉';
      
      // Capture method/source from first successful fetch
      if (method === 'unknown' && coinData.method) method = coinData.method;
      if (source === 'unknown' && coinData.source) source = coinData.source;
      
      // Format with coin name for disambiguation
      const displayName = coinData.coinName 
        ? `**${ticker.toUpperCase()}** (${coinData.coinName})`
        : `**${ticker.toUpperCase()}**`;
      
      let result = `${displayName} $${price} ${changeEmoji} ${change}`;
      if (coinData.marketCap) {
        const mcap = coinData.marketCap >= 1e9 
          ? `$${(coinData.marketCap / 1e9).toFixed(1)}B` 
          : `$${(coinData.marketCap / 1e6).toFixed(0)}M`;
        result += ` • ${mcap}`;
      }
      
      // Show if data is stale
      if (coinData.isStale) {
        result += ` ⏰${coinData.ageMinutes}m old`;
      }
      
      results.push(result);
    } catch (err) {
      if (err.message.includes('429') || err.message.includes('rate limit')) {
        results.push(`**${ticker.toUpperCase()}** rate limited (try again in 1 min)`);
      } else if (ticker.length <= 2) {
        results.push(`**${ticker.toUpperCase()}** is too ambiguous. Please type the full ticker name (e.g., $SONIC, $SOL, $SHIB)`);
      } else {
        results.push(`**${ticker.toUpperCase()}** not found`);
      }
    }
  }
  
  // Clean user-facing output (no technical details)
  await reply.edit(results.join('\n'));
}

async function handleEnterCommand(message, ticker, side) {
  if (!['long', 'short'].includes(side)) {
    await message.reply(`Side must be "long" or "short". Usage: \`shumi enter ${ticker} long\``);
    return;
  }
  
  const reply = await message.reply(`Entering ${side} position on ${ticker.toUpperCase()}...`);
  
  try {
    const coinData = await fetchCoinData(ticker);
    const price = coinData.price;
    const { competition_id } = await ensureCurrentWeek();
    const userId = await ensureUser(message.author.id, message.author.username);
    const entryId = await upsertEntry(competition_id, userId);

    const existingTrade = await query(
      'SELECT id, side FROM trades WHERE entry_id=$1 AND ticker=$2 AND status=\'open\'',
      [entryId, ticker.toLowerCase()]
    );
    if (existingTrade.rows.length > 0) {
      await reply.edit(`You already have an open ${existingTrade.rows[0].side} position on ${ticker.toUpperCase()}. Close it first with \`shumi exit ${ticker}\`.`);
      return;
    }

    const { rows } = await query(
      'INSERT INTO trades(entry_id,ticker,side,entry_price,entry_time,comment,status) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [entryId, ticker.toLowerCase(), side, price, new Date().toISOString(), '', 'open']
    );

    // Clean position entry confirmation
    await reply.edit(`**${side.toUpperCase()}** position entered on **${ticker.toUpperCase()}** at $${formatPrice(price)} (Trade #${rows[0].id})`);
  } catch (err) {
    await reply.edit(`Failed to enter trade: ${err.message}`);
  }
}

async function handleExitCommand(message, ticker) {
  const reply = await message.reply(`Exiting position on ${ticker.toUpperCase()}...`);
  
  try {
    const coinData = await fetchCoinData(ticker);
    const price = coinData.price;
    const { competition_id } = await ensureCurrentWeek();
    const userId = await ensureUser(message.author.id, message.author.username);
    const entryId = await upsertEntry(competition_id, userId);

    const { rows } = await query(
      `SELECT id, entry_price, side FROM trades WHERE entry_id=$1 AND ticker=$2 AND status='open' ORDER BY id DESC LIMIT 1`,
      [entryId, ticker.toLowerCase()]
    );
    
    if (!rows.length) {
      await reply.edit(`No open trade found for ${ticker.toUpperCase()}.`);
      return;
    }

    const t = rows[0];
    let pnlPct;
    if ((t.side || 'long') === 'long') {
      pnlPct = ((price - Number(t.entry_price)) / Number(t.entry_price)) * 100;
    } else {
      pnlPct = ((Number(t.entry_price) - price) / Number(t.entry_price)) * 100;
    }

    await query(
      `UPDATE trades SET exit_price=$1, exit_time=$2, pnl_pct=$3, status='closed' WHERE id=$4`,
      [price, new Date().toISOString(), pnlPct, t.id]
    );

    // Clean position exit confirmation
    const pnlColor = pnlPct >= 0 ? '🟢' : '🔴';
    await reply.edit(`**${(t.side || 'long').toUpperCase()}** position closed on **${ticker.toUpperCase()}** at $${formatPrice(price)} ${pnlColor}${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%`);
  } catch (err) {
    await reply.edit(`Failed to exit trade: ${err.message}`);
  }
}

async function handlePositionsCommand(message, target) {
  const reply = await message.reply('Loading positions...');
  
  try {
    const { competition_id } = await ensureCurrentWeek();
    
    if (!target) {
      const userId = await ensureUser(message.author.id, message.author.username);
      const entryResult = await query('SELECT id FROM entries WHERE competition_id=$1 AND user_id=$2', [competition_id, userId]);
      if (!entryResult.rows.length) {
        await reply.edit('No positions found');
        return;
      }
      
      const entryId = entryResult.rows[0].id;
      const { rows } = await query(`SELECT * FROM trades WHERE entry_id=$1 AND status='open' ORDER BY id DESC`, [entryId]);
      
      if (!rows.length) {
        await reply.edit(`${message.author.username}'s positions: None`);
        return;
      }

      // Batch fetch all prices at once for efficiency
      const uniqueTickers = [...new Set(rows.map(r => r.ticker))];
      const tickerPrices = {};
      
      if (uniqueTickers.length > 0) {
        try {
          // Use the existing batching system for maximum API efficiency
          const { getPrices } = await import('./cg-batcher.js');
          
          // First, resolve tickers to coin IDs using the existing resolver
          const resolvePromises = uniqueTickers.map(async ticker => {
            try {
              const coinId = await smartResolver.resolve(ticker);
              return { ticker, coinId };
            } catch (err) {
              console.log(`[DEBUG] Failed to resolve ${ticker}:`, err.message);
              return { ticker, coinId: null };
            }
          });
          
          const resolvedTickers = await Promise.all(resolvePromises);
          const tickerToCoinId = {};
          const validCoinIds = [];
          
          // Build mapping of ticker -> coinId
          resolvedTickers.forEach(r => {
            if (r.coinId) {
              tickerToCoinId[r.ticker] = r.coinId;
              validCoinIds.push(r.coinId);
            }
          });
          
          // Use smart price service with intelligent fallback
          const { default: smartPriceService } = await import('./smart-price-service.js');
          const prices = await smartPriceService.getSmartPrices(validCoinIds);
          
          // Map prices back to tickers
          validCoinIds.forEach((coinId, index) => {
            const ticker = Object.keys(tickerToCoinId).find(t => tickerToCoinId[t] === coinId);
            if (ticker && prices[index]) {
              tickerPrices[ticker] = prices[index].price;
            }
          });
        } catch (err) {
          console.log('[DEBUG] Batch price fetch failed, falling back to individual calls:', err.message);
        }
      }
      
      const positions = [];
      let method = 'unknown';
      let source = 'unknown';
      
      for (const r of rows) {
        try {
          let currentPrice;
          
          // Try batch price first, fallback to individual fetch
          if (tickerPrices[r.ticker]) {
            currentPrice = tickerPrices[r.ticker];
            method = 'batch';
            source = 'coingecko-batch';
          } else {
            const coinData = await fetchCoinData(r.ticker);
            currentPrice = coinData.price;
            method = coinData.method || 'individual';
            source = coinData.source || 'coingecko';
          }
          
          const entryPrice = Number(r.entry_price);
          const side = r.side || 'long';
          
          let pnlPct;
          if (side === 'long') {
            pnlPct = ((currentPrice - entryPrice) / entryPrice) * 100;
          } else {
            pnlPct = ((entryPrice - currentPrice) / entryPrice) * 100;
          }
          
          // Debug logging for extreme P&L values
          if (Math.abs(pnlPct) > 1000) {
            console.log(`[P&L DEBUG] ${r.ticker}: entry=$${entryPrice} current=$${currentPrice} pnl=${pnlPct.toFixed(2)}%`);
          }
          
          // Cap extreme P&L values (likely data errors)
          if (Math.abs(pnlPct) > 1000) {
            pnlPct = pnlPct > 0 ? 999.99 : -999.99;
          }
          
          const sideSymbol = side === 'long' ? 'L' : 'S';
          const pnlColor = pnlPct >= 0 ? '🟢' : '🔴';
          const pnlSign = pnlPct >= 0 ? '+' : '';
          
          positions.push(`${sideSymbol} **${r.ticker.toUpperCase()}** $${formatPrice(entryPrice)} ${pnlColor}${pnlSign}${pnlPct.toFixed(2)}%`);
        } catch (err) {
          const sideSymbol = (r.side || 'long') === 'long' ? 'L' : 'S';
          positions.push(`${sideSymbol} **${r.ticker.toUpperCase()}** $${formatPrice(Number(r.entry_price))} ⏳`);
        }
      }
      
      // Clean positions display
      await reply.edit(`**${message.author.username}'s Open Positions**\n${positions.join('\n')}\nTotal: ${rows.length} open positions • Live P&L`);
    } else {
      // Handle "positions all" - show everyone's positions
      const allTrades = await query(`
        SELECT t.*, u.discord_username, e.user_id 
        FROM trades t 
        JOIN entries e ON e.id = t.entry_id 
        JOIN users u ON u.id = e.user_id 
        WHERE e.competition_id = $1 AND t.status = 'open' 
        ORDER BY u.discord_username, t.id DESC
      `, [competition_id]);
      
      if (!allTrades.rows.length) {
        await reply.edit('No open positions found for anyone this week.');
        return;
      }
      
      // Batch fetch all prices at once for efficiency
      const uniqueTickers = [...new Set(allTrades.rows.map(t => t.ticker))];
      const tickerPrices = {};
      
      if (uniqueTickers.length > 0) {
        try {
          // Use the existing batching system for maximum API efficiency
          const { getPrices } = await import('./cg-batcher.js');
          
          // First, resolve tickers to coin IDs using the existing resolver
          const resolvePromises = uniqueTickers.map(async ticker => {
            try {
              const coinId = await smartResolver.resolve(ticker);
              return { ticker, coinId };
            } catch (err) {
              console.log(`[DEBUG] Failed to resolve ${ticker}:`, err.message);
              return { ticker, coinId: null };
            }
          });
          
          const resolvedTickers = await Promise.all(resolvePromises);
          const tickerToCoinId = {};
          const validCoinIds = [];
          
          // Build mapping of ticker -> coinId
          resolvedTickers.forEach(r => {
            if (r.coinId) {
              tickerToCoinId[r.ticker] = r.coinId;
              validCoinIds.push(r.coinId);
            }
          });
          
          // Use smart price service with intelligent fallback
          const { default: smartPriceService } = await import('./smart-price-service.js');
          const prices = await smartPriceService.getSmartPrices(validCoinIds);
          
          // Map prices back to tickers
          validCoinIds.forEach((coinId, index) => {
            const ticker = Object.keys(tickerToCoinId).find(t => tickerToCoinId[t] === coinId);
            if (ticker && prices[index]) {
              tickerPrices[ticker] = prices[index].price;
            }
          });
        } catch (err) {
          console.log('[DEBUG] Batch price fetch failed, falling back to individual calls:', err.message);
        }
      }
      
      const userPositions = {};
      let method = 'unknown';
      let source = 'unknown';
      
      for (const trade of allTrades.rows) {
        if (!userPositions[trade.discord_username]) {
          userPositions[trade.discord_username] = [];
        }
        
        try {
          let currentPrice;
          
          // Try batch price first, fallback to individual fetch
          if (tickerPrices[trade.ticker]) {
            currentPrice = tickerPrices[trade.ticker];
            method = 'batch';
            source = 'coingecko-batch';
          } else {
            const coinData = await fetchCoinData(trade.ticker);
            currentPrice = coinData.price;
            method = coinData.method || 'individual';
            source = coinData.source || 'coingecko';
          }
          
          const entryPrice = Number(trade.entry_price);
          const side = trade.side || 'long';
          
          let pnlPct;
          if (side === 'long') {
            pnlPct = ((currentPrice - entryPrice) / entryPrice) * 100;
          } else {
            pnlPct = ((entryPrice - currentPrice) / entryPrice) * 100;
          }
          
          // Debug logging for extreme P&L values
          if (Math.abs(pnlPct) > 1000) {
            console.log(`[P&L DEBUG] ${trade.ticker}: entry=$${entryPrice} current=$${currentPrice} pnl=${pnlPct.toFixed(2)}%`);
          }
          
          // Cap extreme P&L values (likely data errors)
          if (Math.abs(pnlPct) > 1000) {
            pnlPct = pnlPct > 0 ? 999.99 : -999.99;
          }
          
          const sideSymbol = side === 'long' ? 'L' : 'S';
          const pnlColor = pnlPct >= 0 ? '🟢' : '🔴';
          const pnlSign = pnlPct >= 0 ? '+' : '';
          
          userPositions[trade.discord_username].push(`${sideSymbol} **${trade.ticker.toUpperCase()}** $${formatPrice(entryPrice)} ${pnlColor}${pnlSign}${pnlPct.toFixed(2)}%`);
        } catch (err) {
          const sideSymbol = (trade.side || 'long') === 'long' ? 'L' : 'S';
          userPositions[trade.discord_username].push(`${sideSymbol} **${trade.ticker.toUpperCase()}** $${formatPrice(Number(trade.entry_price))} ⏳`);
        }
      }
      
      const allPositionsText = Object.entries(userPositions)
        .map(([username, positions]) => `**${username}:**\n${positions.join('\n')}`)
        .join('\n\n');
      
      // Clean all positions display
      await reply.edit(`**Everyone's Open Positions**\n\n${allPositionsText}`);
    }
  } catch (err) {
    await reply.edit('Error loading positions. Try again later.');
  }
}

async function handleJoinCommand(message) {
  try {
    const { competition_id } = await ensureCurrentWeek();
    const userId = await ensureUser(message.author.id, message.author.username);
    
    // Check if already joined
    const existingEntry = await query(
      'SELECT id FROM entries WHERE competition_id=$1 AND user_id=$2',
      [competition_id, userId]
    );
    
    if (existingEntry.rows.length > 0) {
      await message.reply('You\'re already in this week\'s competition!');
      return;
    }
    
    await upsertEntry(competition_id, userId);
    await message.reply('Joined this week\'s competition!');
  } catch (err) {
    console.error('Join command error:', err.message);
    console.error('Full error:', err);
    await message.reply(`Failed to join competition: ${err.message}`);
  }
}

async function handleLeaderboardCommand(message) {
  try {
    console.log('[DEBUG] Leaderboard command started');
    const reply = await message.reply('Loading leaderboard...');
    const { competition_id } = await ensureCurrentWeek();
    console.log('[DEBUG] Competition ID:', competition_id);
    
    // Get closed trades leaderboard
    const { rows: closedRows } = await query(
      `SELECT e.user_id, SUM(COALESCE(t.pnl_pct,0)) as total
       FROM trades t JOIN entries e ON e.id=t.entry_id
       WHERE e.competition_id=$1 AND t.status='closed'
       GROUP BY e.user_id ORDER BY total DESC LIMIT 10`,
      [competition_id]
    );
    
    // Get all open positions with details for P&L calculation
    const { rows: openPositions } = await query(
      `SELECT t.ticker, t.entry_price, t.side, u.discord_username, e.user_id
       FROM trades t 
       JOIN entries e ON e.id = t.entry_id
       JOIN users u ON u.id = e.user_id
       WHERE e.competition_id=$1 AND t.status='open'`,
      [competition_id]
    );
    
    // Also get user position counts for fallback display
    const { rows: userCounts } = await query(
      `SELECT u.discord_username, COUNT(t.id) as position_count
       FROM trades t 
       JOIN entries e ON e.id = t.entry_id
       JOIN users u ON u.id = e.user_id
       WHERE e.competition_id=$1 AND t.status='open'
       GROUP BY u.discord_username`,
      [competition_id]
    );
    
    // Calculate unrealized P&L for each user
    const userUnrealizedPnl = {};
    const userPositions = {};
    const userFallbackCounts = {};
    
    // Store fallback counts
    userCounts.forEach(row => {
      userFallbackCounts[row.discord_username] = row.position_count;
    });
    
    if (openPositions.length > 0) {
      // Get unique tickers for price fetching
      const uniqueTickers = [...new Set(openPositions.map(p => p.ticker))];
      const tickerPrices = {};
      
      console.log('[DEBUG] Fetching prices for', uniqueTickers.length, 'unique tickers...');
      
      // Use the existing fetchCoinData function for each ticker
      // This is simpler and more reliable than dynamic imports
      const pricePromises = uniqueTickers.map(async ticker => {
        try {
          // Import the working function we know exists
          const { fetchCoinData } = await import('./price-enhanced-smart.js');
          const coinData = await fetchCoinData(ticker);
          return { ticker, price: coinData.price };
        } catch (err) {
          console.log(`[DEBUG] Failed to get price for ${ticker}:`, err.message);
          return { ticker, price: null };
        }
      });
      
      const priceResults = await Promise.all(pricePromises);
      
      // Build price mapping
      priceResults.forEach(result => {
        if (result.price) {
          tickerPrices[result.ticker] = result.price;
          console.log(`[DEBUG] Price for ${result.ticker}: $${result.price}`);
        }
      });
      
      console.log('[DEBUG] Starting P&L calculations for', openPositions.length, 'positions');
      
      // Calculate P&L for each position
      for (const pos of openPositions) {
        const currentPrice = tickerPrices[pos.ticker];
        if (!currentPrice) {
          console.log(`[DEBUG] No price for ${pos.ticker}, skipping position`);
          continue;
        }
        
        const entryPrice = Number(pos.entry_price);
        const side = pos.side || 'long';
        
        let pnlPct;
        if (side === 'long') {
          pnlPct = ((currentPrice - entryPrice) / entryPrice) * 100;
        } else {
          pnlPct = ((entryPrice - currentPrice) / entryPrice) * 100;
        }
        
        // Initialize user data if needed
        if (!userUnrealizedPnl[pos.discord_username]) {
          userUnrealizedPnl[pos.discord_username] = [];
          userPositions[pos.discord_username] = [];
        }
        
        userUnrealizedPnl[pos.discord_username].push(pnlPct);
        const sideSymbol = (pos.side === 'short') ? 'S' : 'L';
        userPositions[pos.discord_username].push(`${sideSymbol} ${pos.ticker.toUpperCase()} ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%`);
      }
    }
    
    // Calculate next Monday 00:00 UTC for countdown
    const now = new Date();
    const nextMonday = new Date(now);
    const daysUntilMonday = (7 - now.getUTCDay() + 1) % 7 || 7; // 0=Sunday, 1=Monday, etc.
    nextMonday.setUTCDate(now.getUTCDate() + daysUntilMonday);
    nextMonday.setUTCHours(0, 0, 0, 0);
    
    // Calculate time remaining
    const timeLeft = nextMonday.getTime() - now.getTime();
    const daysLeft = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
    const hoursLeft = Math.floor((timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutesLeft = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
    
    // Format countdown
    const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][nextMonday.getUTCDay()];
    const timeStr = `${String(nextMonday.getUTCHours()).padStart(2, '0')}:${String(nextMonday.getUTCMinutes()).padStart(2, '0')}:${String(nextMonday.getUTCSeconds()).padStart(2, '0')}`;
    const countdownStr = daysLeft > 0 ? `${daysLeft}d ${hoursLeft}h ${minutesLeft}m` : `${hoursLeft}h ${minutesLeft}m`;
    
    let response = `**Week ${getIsoWeek(new Date())} Competition**\n⏰ Ends: ${dayName} ${timeStr} (in ${countdownStr})\n\n`;
    
    if (closedRows.length > 0) {
      const closedLines = await Promise.all(closedRows.map(async (r, idx) => {
        const u = await query('SELECT discord_username FROM users WHERE id=$1', [r.user_id]);
        return `${idx+1}. **${u.rows[0].discord_username}** ${Number(r.total).toFixed(2)}%`;
      }));
      response += `**Leaderboard:**\n${closedLines.join('\n')}\n\n`;
    }
    
    console.log('[DEBUG] Building display with', Object.keys(userFallbackCounts).length, 'users');
    console.log('[DEBUG] P&L data available for:', Object.keys(userUnrealizedPnl).length, 'users');
    
    // Display live positions - either with P&L or fallback to count
    if (Object.keys(userFallbackCounts).length > 0) {
      const liveLines = Object.keys(userFallbackCounts).map((username, idx) => {
        // Check if we have P&L data for this user
        if (userPositions[username] && userPositions[username].length > 0) {
          const pnlArray = userUnrealizedPnl[username];
          const totalScore = pnlArray.reduce((sum, score) => sum + score, 0) / pnlArray.length;
          const totalText = ` | Total: ${totalScore >= 0 ? '+' : ''}${totalScore.toFixed(2)}%`;
          console.log(`[DEBUG] Score line for ${username}:`, userPositions[username].join(' | ') + totalText);
          return `${idx+1}. **${username}**: ${userPositions[username].join(' | ')}${totalText}`;
        } else {
          // Fallback to simple position count with explanation
          const count = userFallbackCounts[username];
          console.log(`[DEBUG] Fallback line for ${username}:`, `${count} position${count > 1 ? 's' : ''} (prices loading)`);
          return `${idx+1}. **${username}**: ${count} position${count > 1 ? 's' : ''} (prices loading...)`;
        }
      });
      
      response += `**Live Positions:**\n${liveLines.join('\n')}\n\n`;
    }
    
    if (!closedRows.length && Object.keys(userFallbackCounts).length === 0) {
      await reply.edit('No participants yet this week. Use `shumi join` to get started!');
      return;
    }
    
    response += `Close trades to appear in rankings • Live P&L + duration bonus in \`shumi positions\`\n* = duration bonus applied • Only top 300 coins shown for performance`;
    await reply.edit(response);
  } catch (err) {
    console.error('Leaderboard error:', err);
    await reply.edit('Failed to load leaderboard.');
  }
}

async function handleStatusCommand(message) {
  const uptime = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  const uptimeHours = Math.floor(uptime / 3600);
  const uptimeMinutes = Math.floor((uptime % 3600) / 60);
  
  const statusText = `**🤖 Shumi Bot Status**

**Version:** \`${version}\`
**Started:** ${new Date(startedAt).toLocaleString()}
**Uptime:** ${uptimeHours}h ${uptimeMinutes}m
**Process:** Single instance (advisory lock active)
**Status:** All systems operational

**Health:** All systems operational 🟢`;

  await message.reply(statusText);
}

async function handleHelpCommand(message) {
  const helpText = `**🍄 Shumi Trading Bot - Core Commands**

**Pro Tip:** Use cashtags like \`$BTC $ETH $SOL\` for faster, more reliable results!

**Competition:**
\`shumi join\` - Join this week's trading competition
\`shumi leaderboard\` - View weekly rankings

**Trading:**
\`shumi enter btc long\` - Enter a long position  
\`shumi enter doge short\` - Enter a short position
\`shumi exit btc\` - Close your position
\`shumi positions\` - View your open positions with live P&L
\`shumi positions all\` - View everyone's positions

**Prices:**
\`shumi price $BTC $ETH $SOL\` - Get current prices (up to 6 coins)
\`shumi price btc eth doge\` - Plain text also works

**Other:**
\`shumi ping\` - Test if bot is responsive
\`shumi help\` - Show this help message

**Rules:**
• One position per ticker (no averaging)
• Shorts profit when prices fall
• Rate limit: 5 actions per 30 seconds
• Competition resets weekly (Monday 00:00 UTC)

**Scoring System:**
• **P&L:** Basic profit/loss from entry to current price
• **Duration Bonus:** +1% per day held (max 7% for full week)
• **Final Score:** P&L + Duration Bonus
• **Asterisk (*):** Indicates duration bonus applied

**Supported symbols:** All coins available on CoinGecko (thousands of tokens)`;

  await message.reply(helpText);
}