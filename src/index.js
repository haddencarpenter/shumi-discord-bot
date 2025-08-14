import 'dotenv/config';
import { assertSingleResolver } from './startup-asserts.js';
import { version, startedAt } from './version.js';

assertSingleResolver();
console.log(`bot starting version=${version} startedAt=${startedAt}`);

import express from 'express';
import { startDiscord } from './discord.js';
import { scheduleDailyJob } from './sentiment.js';
import { assertSingleInstance } from '../db/singleton.js';
import { buildSymbolIndex, scheduleIndexRefresh } from './symbol-index.js';
import smartResolver from './smart-resolver-v2.js';

(async () => {
  // Ensure single instance
  await assertSingleInstance();
  
  // Build symbol index from CoinGecko markets (top 300 coins)
  console.log('Building symbol index...');
  await buildSymbolIndex();
  
  // Schedule daily refresh of symbol index
  scheduleIndexRefresh();
  
  // Warm up smart resolver with learned mappings
  console.log('Warming up smart resolver...');
  await smartResolver.warmup();
  
  await startDiscord();
  scheduleDailyJob('0 14 * * *');
  const app = express();
  app.get('/health', (_,res)=>res.status(200).send('ok'));
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log('health on', port));
})();