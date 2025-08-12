import 'dotenv/config';
import { assertSingleResolver } from './startup-asserts.js';
import { version, startedAt } from './version.js';

assertSingleResolver();
console.log(`✅ bot starting version=${version} startedAt=${startedAt}`);

import express from 'express';
import { startDiscord } from './discord.js';
import { scheduleDailyJob } from './sentiment.js';
import { assertSingleInstance } from '../db/singleton.js';

(async () => {
  // Ensure single instance
  await assertSingleInstance();
  
  await startDiscord();
  scheduleDailyJob('0 14 * * *');
  const app = express();
  app.get('/health', (_,res)=>res.status(200).send('ok'));
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log('health on', port));
})();