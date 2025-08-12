// discord-integration-example.js
// Example of how to integrate the advanced resolver into your Discord bot

import { fetchAdvancedPrice, fetchAdvancedPrices } from './src/price-advanced.js';

// Example Discord command handler using the advanced resolver
export async function handlePriceCommand(message, args) {
  const query = args.join(' ').trim();
  
  if (!query) {
    return message.reply('Please provide a ticker or trading pair. Examples: `btc`, `eth/usdt`, `matic price`');
  }

  try {
    const result = await fetchAdvancedPrice(query);
    
    if (result.type === 'pair') {
      // Trading pair response
      const embed = {
        color: result.change24h >= 0 ? 0x00ff00 : 0xff0000,
        title: `${result.baseSymbol}/${result.quote} Price`,
        description: result.displayText,
        fields: [
          { name: 'Asset', value: result.baseName, inline: true },
          { name: '24h Change', value: `${result.change24h > 0 ? '+' : ''}${result.change24h.toFixed(2)}%`, inline: true },
          { name: 'Volume (24h)', value: result.volume24h ? `$${formatNumber(result.volume24h)}` : 'N/A', inline: true }
        ],
        timestamp: new Date().toISOString()
      };
      
      return message.reply({ embeds: [embed] });
    }
    
    if (result.type === 'coin') {
      // Single coin response
      const embed = {
        color: result.change24h >= 0 ? 0x00ff00 : 0xff0000,
        title: `${result.name} (${result.symbol}) Price`,
        description: result.displayText,
        fields: [
          { name: '24h Change', value: `${result.change24h > 0 ? '+' : ''}${result.change24h.toFixed(2)}%`, inline: true },
          { name: 'Market Cap', value: result.marketCap ? `$${formatNumber(result.marketCap)}` : 'N/A', inline: true },
          { name: 'Volume (24h)', value: result.volume24h ? `$${formatNumber(result.volume24h)}` : 'N/A', inline: true }
        ],
        timestamp: new Date().toISOString()
      };
      
      return message.reply({ embeds: [embed] });
    }
    
  } catch (error) {
    return message.reply(`❌ ${error.message}`);
  }
}

// Example batch price command
export async function handlePricesCommand(message, args) {
  if (args.length === 0) {
    return message.reply('Please provide one or more tickers. Example: `!prices btc eth sol matic`');
  }

  const typing = message.channel.sendTyping();
  
  try {
    const results = await fetchAdvancedPrices(args);
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    if (successful.length === 0) {
      return message.reply('❌ Could not find prices for any of the requested assets.');
    }
    
    const fields = successful.map(r => ({
      name: r.data.symbol || r.query.toUpperCase(),
      value: r.data.displayText,
      inline: true
    }));
    
    const embed = {
      color: 0x0099ff,
      title: `Prices for ${successful.length} Asset${successful.length > 1 ? 's' : ''}`,
      fields: fields.slice(0, 25), // Discord limit
      timestamp: new Date().toISOString()
    };
    
    if (failed.length > 0) {
      embed.footer = {
        text: `Failed to fetch: ${failed.map(f => f.query).join(', ')}`
      };
    }
    
    return message.reply({ embeds: [embed] });
    
  } catch (error) {
    return message.reply(`❌ Error fetching prices: ${error.message}`);
  } finally {
    typing.catch(() => {}); // Stop typing indicator
  }
}

// Utility function for number formatting
function formatNumber(num) {
  if (num >= 1e12) return (num / 1e12).toFixed(2) + 'T';
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  return num.toFixed(2);
}

// Example integration with your existing Discord bot structure
export function setupAdvancedPriceCommands(client) {
  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    
    const content = message.content.toLowerCase().trim();
    const args = content.split(/\s+/);
    const command = args[0];
    
    // Handle price commands
    if (command === '!price' || command === '!p') {
      return handlePriceCommand(message, args.slice(1));
    }
    
    if (command === '!prices' || command === '!portfolio') {
      return handlePricesCommand(message, args.slice(1));
    }
    
    // Handle natural language price queries
    if (content.includes('price of ') || content.includes('how much is ')) {
      const query = content
        .replace(/^.*(?:price of|how much is)\s+/i, '')
        .replace(/[\?\.!]*$/, '');
      
      if (query.length > 1) {
        return handlePriceCommand(message, [query]);
      }
    }
    
    // Handle trading pair shorthand (btcusdt, eth/usdc, etc.)
    const pairPattern = /^([a-z0-9.-]{2,})[\/:=]?(usdt|usdc|busd|dai|bnb|eth|btc)$/i;
    const pairMatch = content.match(pairPattern);
    if (pairMatch) {
      return handlePriceCommand(message, [content]);
    }
  });
}

/* 
Usage in your main bot file:

import { setupAdvancedPriceCommands } from './discord-integration-example.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

// Set up the advanced price commands
setupAdvancedPriceCommands(client);

client.login(process.env.DISCORD_TOKEN);
*/