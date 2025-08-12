import 'dotenv/config';

console.log(`
✅ Discord Bot Running Successfully!
==================================

Your bot is now online at: http://localhost:3000/health

📋 Available Commands:
---------------------
These commands work in your Discord server:

💰 Price Commands:
  shumi price btc         - Get Bitcoin price
  shumi price eth         - Get Ethereum price  
  shumi price sol         - Get Solana price
  shumi price [ticker]    - Get any crypto price

🏆 Trading Competition:
  shumi join              - Join the competition
  shumi enter btc long    - Open a long position
  shumi enter eth short   - Open a short position
  shumi exit btc          - Close a position
  shumi positions         - View your positions
  shumi positions all     - View everyone's positions
  shumi leaderboard       - Show top traders

🔧 Utility Commands:
  shumi help              - Show help message
  shumi status            - Bot status
  /price [ticker]         - Slash command for prices
  /join                   - Slash command to join
  /trade                  - Advanced trading interface

📌 Testing Tips:
----------------
1. Make sure your bot has the MESSAGE CONTENT INTENT enabled
2. The bot must be in your Discord server
3. Commands work in any channel the bot can see
4. Both text commands (shumi ...) and slash commands (/) work

🔍 Bot Status:
--------------
Name: ${process.env.DISCORD_CLIENT_ID ? 'Shumi' : 'Not configured'}
Guild: ${process.env.DISCORD_GUILD_ID || 'Not set'}
Environment: ${process.env.NODE_ENV || 'development'}

Press CTRL+C to stop the bot.
`);

// Keep the script running to show the info
setTimeout(() => {
  console.log('Test information displayed. Bot is still running in the background.');
}, 1000);