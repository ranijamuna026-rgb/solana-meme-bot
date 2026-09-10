import fs from 'fs';
import { isGenuineMarketTrade } from '../src/paperTrader.js';
import { config } from '../src/config.js';

const raw = fs.readFileSync('./paper_trades_history.json', 'utf8');
const history = JSON.parse(raw);

const genuine = history.filter(isGenuineMarketTrade);
const legacy = history.filter(t => !isGenuineMarketTrade(t));

console.log('=== DATASET COUNT ===');
console.log(`Total Records           : ${history.length}`);
console.log(`Genuine Market Trades   : ${genuine.length}`);
console.log(`Legacy/Test Records     : ${legacy.length}`);
console.log(`Target                  : 100`);
console.log(`Remaining to Target     : ${100 - genuine.length}`);

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
});

const wins = genuine.filter(t => t.pnl > 0);
const losses = genuine.filter(t => t.pnl < 0);
const totalPnl = genuine.reduce((acc, t) => acc + (t.pnl || 0), 0);
const winRate = genuine.length > 0 ? (wins.length / genuine.length) * 100 : 0;
const grossProfit = wins.reduce((acc, t) => acc + t.pnl, 0);
const grossLoss = Math.abs(losses.reduce((acc, t) => acc + t.pnl, 0));
const profitFactor = grossLoss === 0 ? grossProfit : grossProfit / grossLoss;

console.log('\n=== METRICS SNAPSHOT ===');
console.log(`Wins               : ${wins.length}`);
console.log(`Losses             : ${losses.length}`);
console.log(`Win Rate           : ${winRate.toFixed(2)}%`);
console.log(`Total P&L USD      : $${totalPnl.toFixed(4)}`);
console.log(`Profit Factor      : ${profitFactor.toFixed(4)}`);
