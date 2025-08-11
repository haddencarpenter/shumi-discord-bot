import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { query } from './db.js';
import { fetchUsdPrice } from './price.js';

let client;
const rateLimits = new Map(); // Track user rate limits

export async function startDiscord() {
  client = new Client({ intents: [GatewayIntentBits.Guilds] });
  client.once('ready', () => console.log('discord ready as', client.user.tag));

  const commands = [
    new SlashCommandBuilder().setName('join').setDescription('join the current week'),
    new SlashCommandBuilder()
      .setName('trade')
      .setDescription('enter or exit a trade')
      .addStringOption(o=>o.setName('action').setDescription('enter or exit').setRequired(true).addChoices(
        { name:'enter', value:'enter' }, { name:'exit', value:'exit' }
      ))
      .addStringOption(o=>o.setName('ticker').setDescription('coingecko id, e.g. bitcoin').setRequired(true))
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
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
  );
  console.log(`registered ${commands.length} guild commands for GUILD_ID ${process.env.GUILD_ID}`);

  client.on('interactionCreate', async (i) => {
    try {
      if (!i.isChatInputCommand()) return;
      
      // Log command usage
      const ticker = i.options.getString('ticker') || i.options.getString('tickers') || '';
      console.log(`[CMD] user:${i.user.id} cmd:${i.commandName} ticker:${ticker}`);
      
      // Rate limiting check for write operations
      if (['trade', 'join'].includes(i.commandName)) {
        if (!checkRateLimit(i.user.id)) {
          await i.reply({ content: '⚠️ Rate limit: max 5 actions per 30 seconds. Please wait.', ephemeral: true });
          return;
        }
      }

      if (i.commandName === 'join') {
        const { competition_id } = await ensureCurrentWeek();
        const userId = await ensureUser(i.user.id);
        await query('insert into entries(competition_id,user_id) values ($1,$2) on conflict do nothing', [competition_id, userId]);
        await i.reply({ content: 'joined this week ✅' }); // Made public
      }

      if (i.commandName === 'trade') {
        const action = i.options.getString('action');
        const ticker = i.options.getString('ticker').toLowerCase();
        const comment = i.options.getString('comment') || '';
        const nowIso = new Date().toISOString();
        
        let price;
        try {
          price = await fetchUsdPrice(ticker);
        } catch (err) {
          await i.reply({ content: `ticker not found. use coingecko ids like bitcoin, ethereum`, ephemeral: true });
          return;
        }
        
        const { competition_id } = await ensureCurrentWeek();
        const userId = await ensureUser(i.user.id);
        const entryId = await upsertEntry(competition_id, userId);

        if (action === 'enter') {
          // Always allow new trades (multiple concurrent trades support)
          const { rows } = await query(
            'insert into trades(entry_id,ticker,entry_price,entry_time,comment,status) values ($1,$2,$3,$4,$5,$6) returning id',
            [entryId, ticker, price, nowIso, comment, 'open']
          );
          const tradeId = rows[0].id;
          const embed = new EmbedBuilder()
            .setTitle('Trade Entered')
            .setColor(0x00ff00)
            .addFields(
              { name:'Ticker', value:ticker.toUpperCase(), inline:true },
              { name:'Price', value:`$${price.toFixed(2)}`, inline:true },
              { name:'Trade ID', value:`#${tradeId}`, inline:true }
            )
            .setFooter({ text: `${i.user.username} • ${nowIso}` });
          await i.reply({ embeds:[embed] }); // Made public
          return;
        }

        if (action === 'exit') {
          // Close most recent open trade for this ticker
          const { rows } = await query(
            `select id, entry_price from trades
             where entry_id=$1 and ticker=$2 and status='open'
             order by id desc limit 1`, [entryId, ticker]
          );
          if (!rows.length) {
            await i.reply({ content:'no open trade for that ticker', ephemeral:true });
            return;
          }
          const t = rows[0];
          const pnlPct = ((price - Number(t.entry_price)) / Number(t.entry_price)) * 100;
          await query(
            `update trades set exit_price=$1, exit_time=$2, pnl_pct=$3, status='closed' where id=$4`,
            [price, nowIso, pnlPct, t.id]
          );
          
          const embed = new EmbedBuilder()
            .setTitle('Trade Closed')
            .setColor(pnlPct >= 0 ? 0x00ff00 : 0xff0000)
            .addFields(
              { name:'Ticker', value:ticker.toUpperCase(), inline:true },
              { name:'Exit Price', value:`$${price.toFixed(2)}`, inline:true },
              { name:'P&L', value:`${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%`, inline:true }
            )
            .setFooter({ text: `${i.user.username} • Trade #${t.id}` });
          await i.reply({ embeds:[embed] }); // Made public
          return;
        }
      }

      if (i.commandName === 'positions') {
        const target = i.options.getString('target');
        const { competition_id } = await ensureCurrentWeek();
        
        let targetUserId;
        let title = 'Open Positions';
        
        if (!target) {
          // Show caller's positions
          targetUserId = await ensureUser(i.user.id);
          title = `${i.user.username}'s Open Positions`;
        } else if (target === 'all') {
          // Show all positions
          const { rows } = await query(
            `select t.*, u.discord_id, e.user_id
             from trades t 
             join entries e on e.id=t.entry_id
             join users u on u.id=e.user_id
             where e.competition_id=$1 and t.status='open'
             order by e.user_id, t.id desc
             limit 100`, [competition_id]
          );
          
          if (rows.length > 50) {
            // Create text attachment for large results
            const content = rows.map(r => 
              `<@${r.discord_id}> | ${r.ticker} | $${r.entry_price} | ${r.entry_time} | #${r.id}`
            ).join('\n');
            const buffer = Buffer.from(content, 'utf-8');
            const attachment = new AttachmentBuilder(buffer, { name: 'positions.txt' });
            await i.reply({ 
              content: `Found ${rows.length} open positions (showing in attachment)`,
              files: [attachment]
            });
            return;
          }
          
          const grouped = {};
          rows.forEach(r => {
            if (!grouped[r.discord_id]) grouped[r.discord_id] = [];
            grouped[r.discord_id].push(`${r.ticker} $${r.entry_price} #${r.id}`);
          });
          
          const lines = Object.entries(grouped).map(([did, trades]) => 
            `<@${did}>: ${trades.join(', ')}`
          );
          
          await i.reply({ content: lines.length ? `**All Open Positions**\n${lines.join('\n')}` : 'No open positions' });
          return;
        } else {
          // Parse user mention
          const userMatch = target.match(/^<@!?(\d+)>$/);
          if (userMatch) {
            const discordId = userMatch[1];
            const userResult = await query('select id from users where discord_id=$1', [discordId]);
            if (userResult.rows.length) {
              targetUserId = userResult.rows[0].id;
              title = `<@${discordId}>'s Open Positions`;
            }
          }
        }
        
        if (targetUserId) {
          const entryResult = await query(
            'select id from entries where competition_id=$1 and user_id=$2',
            [competition_id, targetUserId]
          );
          
          if (!entryResult.rows.length) {
            await i.reply({ content: 'No positions found' });
            return;
          }
          
          const entryId = entryResult.rows[0].id;
          const { rows } = await query(
            `select * from trades where entry_id=$1 and status='open' order by id desc`,
            [entryId]
          );
          
          if (!rows.length) {
            await i.reply({ content: `${title}: None` });
            return;
          }
          
          const embed = new EmbedBuilder()
            .setTitle(title)
            .setColor(0x0099ff)
            .setDescription(rows.map(r => 
              `**${r.ticker.toUpperCase()}** - Entry: $${r.entry_price} - ${new Date(r.entry_time).toISOString()} - ID: #${r.id}`
            ).join('\n'))
            .setFooter({ text: `Total: ${rows.length} open positions` });
          
          await i.reply({ embeds: [embed] });
        }
      }

      if (i.commandName === 'price') {
        const tickersInput = i.options.getString('tickers');
        const tickers = tickersInput.split(/\s+/).slice(0, 10); // Max 10
        
        const prices = await Promise.all(tickers.map(async ticker => {
          try {
            const price = await fetchUsdPrice(ticker);
            return `**${ticker.toUpperCase()}** $${price.toFixed(2)}`;
          } catch (err) {
            return `**${ticker.toUpperCase()}** not found`;
          }
        }));
        
        await i.reply({ content: prices.join('\n') });
      }

      if (i.commandName === 'leaderboard') {
        const { competition_id } = await ensureCurrentWeek();
        const { rows } = await query(
          `select e.user_id, sum(coalesce(t.pnl_pct,0)) as total
           from trades t join entries e on e.id=t.entry_id
           where e.competition_id=$1 and t.status='closed'
           group by e.user_id order by total desc nulls last limit 10`,
          [competition_id]
        );
        const lines = await Promise.all(rows.map(async (r, idx) => {
          const u = await query('select discord_id from users where id=$1', [r.user_id]);
          return `#${idx+1} <@${u.rows[0].discord_id}> — ${Number(r.total).toFixed(2)}%`;
        }));
        
        const embed = new EmbedBuilder()
          .setTitle('📊 Weekly Leaderboard')
          .setColor(0xffd700)
          .setDescription(lines.length ? lines.join('\n') : 'No results yet')
          .setFooter({ text: `Week ${getIsoWeek(new Date())}` });
        
        await i.reply({ embeds: [embed] }); // Made public
      }
    } catch (err) {
      console.error('[ERROR]', err);
      if (i.isRepliable()) await i.reply({ content:'error occurred. try again later.', ephemeral:true }).catch(()=>{});
    }
  });

  await client.login(process.env.DISCORD_TOKEN);
}

function checkRateLimit(userId) {
  const now = Date.now();
  const userLimits = rateLimits.get(userId) || [];
  
  // Remove entries older than 30 seconds
  const recentActions = userLimits.filter(t => now - t < 30000);
  
  if (recentActions.length >= 5) {
    return false; // Rate limit exceeded
  }
  
  recentActions.push(now);
  rateLimits.set(userId, recentActions);
  return true;
}

async function ensureUser(discordId) {
  const { rows } = await query(
    'insert into users(discord_id) values($1) on conflict (discord_id) do update set discord_id=excluded.discord_id returning id',
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
    `insert into competitions(week_number,start_at,end_at)
     values ($1,$2,$3)
     on conflict (week_number) do update set start_at=excluded.start_at, end_at=excluded.end_at
     returning id`,
    [week, start, end]
  );
  return { competition_id: rows[0].id };
}

async function upsertEntry(compId, userId) {
  const { rows } = await query(
    `insert into entries(competition_id,user_id) values ($1,$2)
     on conflict (competition_id,user_id) do update set joined_at = least(entries.joined_at, now())
     returning id`, [compId, userId]
  );
  return rows[0].id;
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