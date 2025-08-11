import 'dotenv/config';
import { startDiscord } from './src/discord.js';

// Override db for local testing
import { query } from './src/db-local.js';
import fs from 'fs';

// Replace the db import in discord.js
const discordContent = fs.readFileSync('./src/discord.js', 'utf8');
const modifiedContent = discordContent.replace(
  "import { query } from './db.js';",
  "import { query } from './db-local.js';"
);
fs.writeFileSync('./src/discord-local.js', modifiedContent);

// Start Discord bot with local DB
console.log('🧪 Starting bot in LOCAL TEST MODE with SQLite...');
console.log('Make sure your .env has valid DISCORD_TOKEN, CLIENT_ID, GUILD_ID');

await startDiscord();