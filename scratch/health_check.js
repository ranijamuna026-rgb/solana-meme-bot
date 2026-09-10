import fs from 'fs';
import { isGenuineMarketTrade } from '../src/paperTrader.js';
import { config } from '../src/config.js';

const raw = fs.readFileSync('./paper_trades_history.json', 'utf8');
const history = JSON.parse(raw);
const genuine = history.filter(isGenuineMarketTrade);
const legacy = history.filter(t => !isGenuineMarketTrade(t));

console.log('=== COLLECTOR HEALTH & PROGRESS ===');
console.log(`Total Historical Records : ${history.length}`);
console.log(`Genuine Market Trades    : ${genuine.length}`);
console.log(`Legacy/Test Records      : ${legacy.length}`);
console.log(`Target                   : 100`);
console.log(`Remaining                : ${100 - genuine.length}`);

console.log('\n=== ALL GENUINE MARKET TRADES ===');
genuine.forEach((t, i) => {
  console.log(`\nGenuine Trade #${i + 1} (${t.tradeId}):`);
  console.log(`  Symbol       : ${t.symbol}`);
  console.log(`  Mint         : ${t.tokenAddress}`);
  console.log(`  Entry Price  : $${t.entryPrice}`);
  console.log(`  Exit Price   : $${t.exitPrice}`);
  console.log(`  P&L USD      : $${t.pnl}`);
  console.log(`  P&L %        : ${t.pnlPercent}%`);
  console.log(`  Exit Reason  : ${t.exitReason}`);
  console.log(`  Duration     : ${t.holdDuration}`);
  console.log(`  Entry Time   : ${t.entryTime}`);
  console.log(`  Exit Time    : ${t.exitTime}`);
  console.log(`  Source       : ${t.source}`);
});

const latest = genuine[genuine.length - 1];
const nowMs = Date.now();
const lastExitMs = latest ? new Date(latest.exitTime).getTime() : nowMs;
const elapsedSec = Math.floor((nowMs - lastExitMs) / 1000);

console.log('\n=== LATEST GENUINE TRADE ACTIVITY ===');
console.log(`Latest Trade ID     : ${latest ? latest.tradeId : 'N/A'}`);
console.log(`Latest Symbol       : ${latest ? latest.symbol : 'N/A'}`);
console.log(`Latest Exit Reason  : ${latest ? latest.exitReason : 'N/A'}`);
console.log(`Latest P&L USD      : $${latest ? latest.pnl : 0}`);
console.log(`Latest Duration     : ${latest ? latest.holdDuration : 'N/A'}`);
console.log(`Time Since Exit     : ${elapsedSec}s ago`);
