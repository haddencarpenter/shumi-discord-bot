import cron from 'node-cron';
export async function runSentimentJob(){ console.log('sentiment job @', new Date().toISOString()); }
export function scheduleDailyJob(expr='0 14 * * *'){ cron.schedule(expr, async ()=>{ try{ await runSentimentJob(); }catch(e){ console.error(e); } }, { timezone: process.env.TZ || 'UTC' }); }
if (import.meta.url === `file://${process.argv[1]}`) runSentimentJob().then(()=>process.exit(0));