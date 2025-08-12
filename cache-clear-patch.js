// Quick patch to add to your Discord bot temporarily
// Add this to discord.js in the text command handler

if (command === 'clearcache' && message.author.id === '396270927811313665') {
  // Admin only - clear price caches
  const { clearPriceCache } = await import('./price-enhanced-smart.js');
  clearPriceCache();
  await message.reply('✅ Price cache cleared. Next price fetches will use fresh data.');
}