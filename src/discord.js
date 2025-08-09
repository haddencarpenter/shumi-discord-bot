import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { query } from './db.js';
import { fetchUsdPrice } from './price.js';

let client;

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
    new SlashCommandBuilder().setName('leaderboard').setDescription('weekly top 10')
  ].map(c=>c.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
  );

  client.on('interactionCreate', async (i) => {
    try {
      if (!i.isChatInputCommand()) return;
      if (i.commandName === 'join') {
        const { competition_id } = await ensureCurrentWeek();
        const userId = await ensureUser(i.user.id);
        await query('insert into entries(competition_id,user_id) values ($1,$2) on conflict do nothing', [competition_id, userId]);
        await i.reply({ content: 'joined this week ✅', ephemeral: true });
      }

      if (i.commandName === 'trade') {
        const action = i.options.getString('action');
        const ticker = i.options.getString('ticker');
        const comment = i.options.getString('comment') || '';
        const nowIso = new Date().toISOString();
        const price = await fetchUsdPrice(ticker);
        const { competition_id } = await ensureCurrentWeek();
        const userId = await ensureUser(i.user.id);
        const entryId = await upsertEntry(competition_id, userId);

        if (action === 'enter') {
          const { rows } = await query(
            'insert into trades(entry_id,ticker,entry_price,entry_time,comment,status) values ($1,$2,$3,$4,$5,$6) returning id',
            [entryId, ticker, price, nowIso, comment, 'open']
          );
          const tradeId = rows[0].id;
          const embed = new EmbedBuilder().setTitle('trade entered').addFields(
            { name:'ticker', value:ticker, inline:true },
            { name:'price', value:`${price}`, inline:true },
            { name:'trade_id', value:String(tradeId), inline:true }
          ).setFooter({ text: nowIso });
          await i.reply({ embeds:[embed] });
          return;
        }

        if (action === 'exit') {
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
          await i.reply({ content:`exited ${ticker} at ${price}. pnl ${pnlPct.toFixed(2)}%` });
          return;
        }
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
        await i.reply({ content: lines.length ? lines.join('\n') : 'no results yet' });
      }
    } catch (err) {
      console.error(err);
      if (i.isRepliable()) await i.reply({ content:'error occurred. try again later.', ephemeral:true }).catch(()=>{});
    }
  });

  await client.login(process.env.DISCORD_TOKEN);
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