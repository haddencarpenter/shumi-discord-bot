// Fix OMNI trades that used wrong coin (omni vs omni-network)
import 'dotenv/config';
import { query } from './src/db.js';
import axios from 'axios';

async function fixOmniTrades() {
  console.log('🔍 Finding OMNI trades that need fixing...\n');
  
  // Safety check
  if (process.env.DATABASE_URL?.includes('render.com')) {
    console.log('⚠️  This script is connecting to PRODUCTION database!');
    console.log('   Please be careful with EXECUTE commands.');
  }
  
  try {
    // 1. Find all OMNI trades (both open and closed)
    const trades = await query(`
      SELECT 
        t.id, u.discord_username, t.ticker, t.side, t.entry_price, t.exit_price, 
        t.entry_time, t.exit_time, t.status
      FROM trades t
      JOIN entries e ON t.entry_id = e.id
      JOIN users u ON e.user_id = u.id
      WHERE LOWER(t.ticker) = 'omni'
      ORDER BY t.entry_time DESC
    `);
    
    const tradesData = trades.rows || trades;
    console.log(`Found ${tradesData.length} OMNI trades:`);
    
    if (!tradesData || tradesData.length === 0) {
      console.log('No OMNI trades found to fix.');
      return;
    }
    
    tradesData.forEach((trade, i) => {
      const status = trade.status?.toUpperCase() || 'UNKNOWN';
      const entryPrice = trade.entry_price ? `$${trade.entry_price}` : 'N/A';
      const exitPrice = trade.exit_price ? `$${trade.exit_price}` : 'N/A';
      console.log(`  ${i + 1}. ${trade.discord_username} - ${trade.side} ${status} | Entry: ${entryPrice} | Exit: ${exitPrice}`);
    });
    
    // (This check is now above)
    
    // 2. Get current prices for both OMNI coins
    console.log('\n📊 Getting current prices for comparison...');
    
    const baseUrl = process.env.COINGECKO_API_KEY 
      ? 'https://pro-api.coingecko.com/api/v3'
      : 'https://api.coingecko.com/api/v3';
    
    const headers = {};
    if (process.env.COINGECKO_API_KEY) {
      headers['x-cg-pro-api-key'] = process.env.COINGECKO_API_KEY;
    }
    
    const priceResponse = await axios.get(`${baseUrl}/simple/price`, {
      params: {
        ids: 'omni,omni-network',
        vs_currencies: 'usd',
        include_market_cap: true
      },
      headers
    });
    
    const wrongOmniPrice = priceResponse.data.omni?.usd || 0;
    const correctOmniPrice = priceResponse.data['omni-network']?.usd || 0;
    
    console.log(`Wrong OMNI (omni): $${wrongOmniPrice} (MCap: $${(priceResponse.data.omni?.usd_market_cap / 1e6 || 0).toFixed(1)}M)`);
    console.log(`Correct OMNI (omni-network): $${correctOmniPrice} (MCap: $${(priceResponse.data['omni-network']?.usd_market_cap / 1e6 || 0).toFixed(1)}M)`);
    
    // 3. Calculate conversion ratio
    const conversionRatio = correctOmniPrice / wrongOmniPrice;
    console.log(`\n🔄 Conversion ratio: ${conversionRatio.toFixed(2)}x`);
    
    // 4. Show what the fix would do (preview)
    console.log('\n🔧 Preview of fixes:');
    const fixes = [];
    
    for (const trade of tradesData) {
      const entryPrice = trade.entry_price ? parseFloat(trade.entry_price) : null;
      const exitPrice = trade.exit_price ? parseFloat(trade.exit_price) : null;
      
      const fix = {
        id: trade.id,
        username: trade.discord_username,
        side: trade.side,
        oldEntryPrice: entryPrice,
        newEntryPrice: entryPrice ? (entryPrice * conversionRatio) : null,
        oldExitPrice: exitPrice,
        newExitPrice: exitPrice ? (exitPrice * conversionRatio) : null,
        isOpen: trade.status === 'open'
      };
      
      fixes.push(fix);
      
      const status = fix.isOpen ? 'OPEN' : 'CLOSED';
      console.log(`  ${fix.username} ${fix.side} ${status}:`);
      if (fix.oldEntryPrice) {
        console.log(`    Entry: $${fix.oldEntryPrice.toFixed(6)} → $${fix.newEntryPrice.toFixed(6)}`);
      }
      if (fix.oldExitPrice) {
        console.log(`    Exit:  $${fix.oldExitPrice.toFixed(6)} → $${fix.newExitPrice.toFixed(6)}`);
      }
    }
    
    // 5. Ask for confirmation (in real usage, you'd want manual confirmation)
    console.log(`\n⚠️  Ready to update ${fixes.length} OMNI trades.`);
    console.log('Add "EXECUTE" as argument to apply these changes.');
    
    if (process.argv.includes('EXECUTE')) {
      console.log('\n🚀 Applying fixes...');
      
      for (const fix of fixes) {
        const updates = [];
        const values = [];
        let paramIndex = 1;
        
        if (fix.newEntryPrice !== null) {
          updates.push(`entry_price = $${paramIndex++}`);
          values.push(fix.newEntryPrice);
        }
        
        if (fix.newExitPrice !== null) {
          updates.push(`exit_price = $${paramIndex++}`);
          values.push(fix.newExitPrice);
        }
        
        if (updates.length > 0) {
          values.push(fix.id);
          const updateQuery = `
            UPDATE trades 
            SET ${updates.join(', ')}
            WHERE id = $${paramIndex}
          `;
          
          await query(updateQuery, values);
          console.log(`✅ Updated trade ${fix.id} (${fix.username})`);
        }
      }
      
      console.log(`\n🎉 Successfully updated ${fixes.length} OMNI trades!`);
      console.log('All OMNI trades now use correct omni-network pricing.');
    }
    
  } catch (err) {
    console.error('Error:', err.message);
  }
}

fixOmniTrades();
