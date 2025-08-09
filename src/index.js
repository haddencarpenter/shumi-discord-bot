import 'dotenv/config';
import express from 'express';
import { startDiscord } from './discord.js';
import { scheduleDailyJob } from './sentiment.js';

(async () => {
  await startDiscord();
  scheduleDailyJob('0 14 * * *');
  const app = express();
  app.get('/health', (_,res)=>res.status(200).send('ok'));
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log('health on', port));
})();