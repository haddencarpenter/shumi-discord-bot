#!/usr/bin/env node
/**
 * WebSocket-Only SD Validation Test
 * Tests real-time WebSocket connections to KuCoin, Bybit, and Gate.io
 * Waits for 3 consecutive SD ticks from any exchange
 * Exits 0 only on success, 1 on timeout or failure
 */

import WebSocket from 'ws';

console.log('🔌 WebSocket-Only SD Validation Test');
console.log('====================================\n');

if (process.env.FORCE_REALTIME !== '1') {
  console.error('❌ FORCE_REALTIME=1 not set');
  console.error('This test requires FORCE_REALTIME=1 to prevent fallbacks');
  process.exit(1);
}

const TIMEOUT_MS = 60000; // 60 seconds
const REQUIRED_TICKS = 3;

let tickCount = 0;
let exchanges = {};
const startTime = Date.now();

function logTick(exchange, price, timestamp) {
  tickCount++;
  const source = `${exchange}-realtime`;
  console.log(`${source.padEnd(15)} price=${price} ts=${timestamp || Date.now()}`);
  
  if (!exchanges[exchange]) {
    exchanges[exchange] = 0;
  }
  exchanges[exchange]++;
  
  if (tickCount >= REQUIRED_TICKS) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✅ received ${tickCount} realtime SD ticks within ${elapsed}s`);
    console.log(`📊 Exchange breakdown: ${JSON.stringify(exchanges)}`);
    process.exit(0);
  }
}

function connectKuCoin() {
  return new Promise((resolve) => {
    console.log('🔌 Connecting to KuCoin WebSocket...');
    const ws = new WebSocket('wss://ws-api-spot.kucoin.com/endpoint');
    
    let connected = false;
    
    ws.on('open', () => {
      console.log('   ✅ KuCoin connected, subscribing to SD-USDT ticker...');
      
      const subscribeMessage = {
        id: Date.now(),
        type: 'subscribe',
        topic: '/market/ticker:SD-USDT',
        response: true
      };
      
      ws.send(JSON.stringify(subscribeMessage));
      connected = true;
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.type === 'message' && message.topic === '/market/ticker:SD-USDT') {
          const tickerData = message.data;
          logTick('kucoin', tickerData.price, tickerData.time);
        }
      } catch (error) {
        console.error('⚠️ KuCoin message parse error:', error.message);
      }
    });

    ws.on('error', (error) => {
      console.error('❌ KuCoin WebSocket error:', error.message);
      resolve();
    });

    ws.on('close', (code, reason) => {
      if (connected) {
        console.log(`⚠️ KuCoin WebSocket closed (code: ${code})`);
      }
      resolve();
    });
  });
}

function connectBybit() {
  return new Promise((resolve) => {
    console.log('🔌 Connecting to Bybit WebSocket...');
    const ws = new WebSocket('wss://stream.bybit.com/v5/public/spot');
    
    let connected = false;
    
    ws.on('open', () => {
      console.log('   ✅ Bybit connected, subscribing to SDUSDT ticker...');
      
      const subscribeMessage = {
        op: 'subscribe',
        args: ['tickers.SDUSDT']
      };
      
      ws.send(JSON.stringify(subscribeMessage));
      connected = true;
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.topic === 'tickers.SDUSDT' && message.data) {
          const tickerData = message.data;
          logTick('bybit', tickerData.lastPrice, tickerData.ts);
        }
      } catch (error) {
        console.error('⚠️ Bybit message parse error:', error.message);
      }
    });

    ws.on('error', (error) => {
      console.error('❌ Bybit WebSocket error:', error.message);
      resolve();
    });

    ws.on('close', (code, reason) => {
      if (connected) {
        console.log(`⚠️ Bybit WebSocket closed (code: ${code})`);
      }
      resolve();
    });
  });
}

function connectGate() {
  return new Promise((resolve) => {
    console.log('🔌 Connecting to Gate.io WebSocket...');
    const ws = new WebSocket('wss://api.gateio.ws/ws/v4/');
    
    let connected = false;
    
    ws.on('open', () => {
      console.log('   ✅ Gate.io connected, subscribing to SD_USDT ticker...');
      
      const subscribeMessage = {
        time: Math.floor(Date.now() / 1000),
        channel: 'spot.tickers',
        event: 'subscribe',
        payload: ['SD_USDT']
      };
      
      ws.send(JSON.stringify(subscribeMessage));
      connected = true;
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.channel === 'spot.tickers' && message.event === 'update' && message.result) {
          const tickerData = message.result;
          if (tickerData.currency_pair === 'SD_USDT') {
            logTick('gate', tickerData.last, Date.now());
          }
        }
      } catch (error) {
        console.error('⚠️ Gate.io message parse error:', error.message);
      }
    });

    ws.on('error', (error) => {
      console.error('❌ Gate.io WebSocket error:', error.message);
      resolve();
    });

    ws.on('close', (code, reason) => {
      if (connected) {
        console.log(`⚠️ Gate.io WebSocket closed (code: ${code})`);
      }
      resolve();
    });
  });
}

async function runTest() {
  console.log(`🎯 Waiting for ${REQUIRED_TICKS} SD ticks from any exchange within ${TIMEOUT_MS/1000}s...\n`);
  
  // Set timeout
  const timeoutHandle = setTimeout(() => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`\n❌ Timeout after ${elapsed}s`);
    console.error(`   Received ${tickCount}/${REQUIRED_TICKS} ticks`);
    console.error(`   Exchange breakdown: ${JSON.stringify(exchanges)}`);
    console.error('   WebSocket connections failed to deliver real-time SD data');
    process.exit(1);
  }, TIMEOUT_MS);
  
  // Connect to all exchanges in parallel
  const connections = [
    connectKuCoin(),
    connectBybit(), 
    connectGate()
  ];
  
  // Wait for all connections to complete or timeout
  await Promise.all(connections);
  
  // If we get here, all connections closed without getting enough ticks
  clearTimeout(timeoutHandle);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.error(`\n❌ All WebSocket connections closed after ${elapsed}s`);
  console.error(`   Received ${tickCount}/${REQUIRED_TICKS} ticks`);
  console.error(`   Exchange breakdown: ${JSON.stringify(exchanges)}`);
  process.exit(1);
}

runTest().catch(error => {
  console.error('💥 Test crashed:', error.message);
  process.exit(1);
});