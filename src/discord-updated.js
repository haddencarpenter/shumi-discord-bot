import 'dotenv/config';
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { fetchUsdPrice, fetchCoinData } from './price-smart.js';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const query = (text, params) => pool.query(text, params);

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
  return price.toFixed(8);
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

async function ensureUser(discordId) {
  const { rows } = await query(
    'INSERT INTO users(discord_id) VALUES($1) ON CONFLICT(discord_id) DO UPDATE SET discord_id=$1 RETURNING id',
    [discordId]
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
  client.once('ready', () => {
    console.log('Bot connected as:', client.user.tag);
  });

  const commands = [
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
      .addStringOption(o=>o.setName('tickers').setDescription('space-separated tickers (max 10)').setRequired(true))
  ].map(c=>c.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  
  if (process.env.GUILD_ID) {
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log(`Registered ${commands.length} guild commands for GUILD_ID ${process.env.GUILD_ID}`);
  } else {
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log(`Registered ${commands.length} global commands`);
  }

  // Handle text-based commands with "shumi" prefix
  client.on('messageCreate', async (message) => {
    try {
      if (message.author.bot) return;
      
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
      } else if (command === 'join') {
        await handleJoinCommand(message);
      } else if (command === 'leaderboard') {
        await handleLeaderboardCommand(message);
      } else if (command === 'help') {
        await handleHelpCommand(message);
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
          await i.reply({ content: 'Rate limit: max 5 actions per 30 seconds. Please wait.', ephemeral: true });
          return;
        }
      }

      if (i.commandName === 'join') {
        const { competition_id } = await ensureCurrentWeek();
        const userId = await ensureUser(i.user.id);
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
          await i.reply({ content: `ticker not found. try common tickers like btc, eth, sol, doge, shib, pepe`, ephemeral: true });
          return;
        }
        
        const { competition_id } = await ensureCurrentWeek();
        const userId = await ensureUser(i.user.id);
        const entryId = await upsertEntry(competition_id, userId);

        if (action === 'enter') {
          const existingTrade = await query(
            'SELECT id, side FROM trades WHERE entry_id=$1 AND ticker=$2 AND status=\'open\'',
            [entryId, ticker]
          );
          if (existingTrade.rows.length > 0) {
            await i.reply({ 
              content: `You already have an open ${existingTrade.rows[0].side} position on ${ticker.toUpperCase()}. Close it first with \`/exit ${ticker}\` to enter a new trade.`, 
              ephemeral: true 
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
            await i.reply({ content:'no open trade for that ticker', ephemeral:true });
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
          const userId = await ensureUser(i.user.id);
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
            
            let result = `**${ticker.toUpperCase()}** $${price} ${changeEmoji}${change}`;
            
            if (coinData.marketCap) {
              const mcap = coinData.marketCap >= 1e9 
                ? `$${(coinData.marketCap / 1e9).toFixed(1)}B` 
                : `$${(coinData.marketCap / 1e6).toFixed(0)}M`;
              result += ` • ${mcap}`;
            }
            
            results.push(result);
          } catch (err) {
            results.push(`**${ticker.toUpperCase()}** not found`);
          }
          
          if (tickers.length > 1) {
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        }
        
        await i.editReply({ content: results.join('\n') });
      }

      if (i.commandName === 'leaderboard') {
        const { competition_id } = await ensureCurrentWeek();
        const { rows } = await query(
          `SELECT e.user_id, SUM(COALESCE(t.pnl_pct,0)) as total
           FROM trades t JOIN entries e ON e.id=t.entry_id
           WHERE e.competition_id=$1 AND t.status='closed'
           GROUP BY e.user_id ORDER BY total DESC LIMIT 10`,
          [competition_id]
        );
        
        if (!rows.length) {
          await i.reply({ content: 'No results yet' });
          return;
        }
        
        const lines = await Promise.all(rows.map(async (r, idx) => {
          const u = await query('SELECT discord_id FROM users WHERE id=$1', [r.user_id]);
          return `#${idx+1} <@${u.rows[0].discord_id}> — ${Number(r.total).toFixed(2)}%`;
        }));
        
        const embed = new EmbedBuilder()
          .setTitle('Weekly Leaderboard')
          .setColor(0xffd700)
          .setDescription(lines.join('\n'))
          .setFooter({ text: `Week ${getIsoWeek(new Date())}` });
        
        await i.reply({ embeds: [embed] });
      }
    } catch (err) {
      console.error('[ERROR]', err);
      if (i.isRepliable()) await i.reply({ content:'error occurred. try again later.', ephemeral:true }).catch(()=>{});
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
  
  for (const ticker of tickers) {
    try {
      const coinData = await fetchCoinData(ticker);
      const price = formatPrice(coinData.price);
      const change = coinData.change24h >= 0 ? `+${coinData.change24h.toFixed(2)}%` : `${coinData.change24h.toFixed(2)}%`;
      const changeEmoji = coinData.change24h >= 0 ? '📈' : '📉';
      
      let result = `**${ticker.toUpperCase()}** $${price} ${changeEmoji}${change}`;
      if (coinData.marketCap) {
        const mcap = coinData.marketCap >= 1e9 
          ? `$${(coinData.marketCap / 1e9).toFixed(1)}B` 
          : `$${(coinData.marketCap / 1e6).toFixed(0)}M`;
        result += ` • ${mcap}`;
      }
      results.push(result);
    } catch (err) {
      results.push(`**${ticker.toUpperCase()}** not found`);
    }
    if (tickers.length > 1) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  
  await reply.edit(results.join('\n'));
}

async function handleEnterCommand(message, ticker, side) {
  if (!['long', 'short'].includes(side)) {
    await message.reply(`Side must be "long" or "short". Usage: \`shumi enter ${ticker} long\``);
    return;
  }
  
  const reply = await message.reply(`Entering ${side} position on ${ticker.toUpperCase()}...`);
  
  try {
    const price = await fetchUsdPrice(ticker);
    const { competition_id } = await ensureCurrentWeek();
    const userId = await ensureUser(message.author.id);
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

    await reply.edit(`**${side.toUpperCase()}** position entered on **${ticker.toUpperCase()}** at $${formatPrice(price)} (Trade #${rows[0].id})`);
  } catch (err) {
    await reply.edit(`Failed to enter trade: ${err.message}`);
  }
}

async function handleExitCommand(message, ticker) {
  const reply = await message.reply(`Exiting position on ${ticker.toUpperCase()}...`);
  
  try {
    const price = await fetchUsdPrice(ticker);
    const { competition_id } = await ensureCurrentWeek();
    const userId = await ensureUser(message.author.id);
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
      const userId = await ensureUser(message.author.id);
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

      const positions = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
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
          
          const sideSymbol = side === 'long' ? 'L' : 'S';
          const pnlColor = pnlPct >= 0 ? '🟢' : '🔴';
          const pnlSign = pnlPct >= 0 ? '+' : '';
          
          positions.push(`${sideSymbol} **${r.ticker.toUpperCase()}** $${formatPrice(entryPrice)} ${pnlColor}${pnlSign}${pnlPct.toFixed(2)}%`);
        } catch (err) {
          const sideSymbol = (r.side || 'long') === 'long' ? 'L' : 'S';
          positions.push(`${sideSymbol} **${r.ticker.toUpperCase()}** $${formatPrice(Number(r.entry_price))} ⏳`);
        }
        
        if (i < rows.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      await reply.edit(`**${message.author.username}'s Open Positions**\n${positions.join('\n')}\nTotal: ${rows.length} open positions • Live P&L`);
    }
  } catch (err) {
    await reply.edit('Error loading positions. Try again later.');
  }
}

async function handleJoinCommand(message) {
  try {
    const { competition_id } = await ensureCurrentWeek();
    const userId = await ensureUser(message.author.id);
    await upsertEntry(competition_id, userId);
    await message.reply('Joined this week\'s competition!');
  } catch (err) {
    await message.reply('Failed to join competition.');
  }
}

async function handleLeaderboardCommand(message) {
  try {
    const { competition_id } = await ensureCurrentWeek();
    const { rows } = await query(
      `SELECT e.user_id, SUM(COALESCE(t.pnl_pct,0)) as total
       FROM trades t JOIN entries e ON e.id=t.entry_id
       WHERE e.competition_id=$1 AND t.status='closed'
       GROUP BY e.user_id ORDER BY total DESC LIMIT 10`,
      [competition_id]
    );
    
    if (!rows.length) {
      await message.reply('No results yet');
      return;
    }
    
    const lines = await Promise.all(rows.map(async (r, idx) => {
      const u = await query('SELECT discord_id FROM users WHERE id=$1', [r.user_id]);
      return `#${idx+1} <@${u.rows[0].discord_id}> — ${Number(r.total).toFixed(2)}%`;
    }));
    
    await message.reply(`**Weekly Leaderboard**\n${lines.join('\n')}\n\nWeek ${getIsoWeek(new Date())}`);
  } catch (err) {
    await message.reply('Failed to load leaderboard.');
  }
}

async function handleHelpCommand(message) {
  const helpText = `**🍄 Shumi Trading Bot Commands**

**Trading Commands:**
\`shumi price btc eth doge\` - Get current prices (up to 6 coins)
\`shumi enter arc long\` - Enter a long position  
\`shumi enter doge short\` - Enter a short position
\`shumi exit btc\` - Close your position on BTC
\`shumi positions\` - View your open positions with live P&L
\`shumi positions all\` - View everyone's positions

**Competition Commands:**
\`shumi join\` - Join this week's trading competition
\`shumi leaderboard\` - View weekly rankings

**Other Commands:**
\`shumi ping\` - Test if bot is responsive
\`shumi help\` - Show this help message

**Tips:**
• You can only have **one position per ticker** (no averaging down)
• **Short positions** profit when prices fall
• All prices show **live P&L** performance
• Rate limited to 5 actions per 30 seconds

**Competition Schedule:**
• Starts: Monday 00:00 UTC
• Ends: Sunday 23:59 UTC
• Resets automatically each week

**Competition Rules:**
Points = |P&L%| × 10 × TimeBonus × WinMultiplier
Good luck trading!`;

  await message.reply(helpText);
}