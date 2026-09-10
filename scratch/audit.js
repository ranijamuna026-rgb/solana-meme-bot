import fs from 'fs';
import { isGenuineMarketTrade } from '../src/paperTrader.js';
import { config } from '../src/config.js';

const raw = fs.readFileSync('./paper_trades_history.json', 'utf8');
const history = JSON.parse(raw);

console.log(`Total Historical Records: ${history.length}`);
const genuine = history.filter(isGenuineMarketTrade);
const legacy = history.filter(t => !isGenuineMarketTrade(t));

console.log(`Genuine Market-Data Records: ${genuine.length}`);
console.log(`Legacy/Test Records: ${legacy.length}`);

console.log('\n--- GENUINE TRADES DETAIL ---');
genuine.forEach((t, i) => {
  console.log(`\nTrade #${i+1} (${t.tradeId}):`);
  console.log(`  Symbol: ${t.symbol}`);
  console.log(`  Address: ${t.tokenAddress}`);
  console.log(`  Entry Time: ${t.entryTime}`);
  console.log(`  Exit Time: ${t.exitTime}`);
  console.log(`  Entry Price: $${t.entryPrice}`);
  console.log(`  Exit Price: $${t.exitPrice}`);
  console.log(`  Quantity: ${t.quantity}`);
  console.log(`  Investment: $${t.investment}`);
  
  // Entry audit
  const calcInvestment = t.quantity * t.entryPrice;
  const invDiff = Math.abs(calcInvestment - t.investment);
  console.log(`  Entry Check (quantity * entryPrice): ${calcInvestment.toFixed(6)} (Diff vs $${t.investment}: ${invDiff.toFixed(6)})`);

  // Exit audit & recalculations
  const calcPnlPercent = ((t.exitPrice - t.entryPrice) / t.entryPrice) * 100;
  const calcPnlUsd = (t.exitPrice - t.entryPrice) * t.quantity;
  const pnlPercentDiff = Math.abs(calcPnlPercent - t.pnlPercent);
  const pnlUsdDiff = Math.abs(calcPnlUsd - t.pnl);

  console.log(`  Exit Reason: ${t.exitReason}`);
  console.log(`  Stored PnL %: ${t.pnlPercent}% | Recalculated: ${calcPnlPercent.toFixed(4)}% | Diff: ${pnlPercentDiff.toFixed(6)}`);
  console.log(`  Stored PnL $: $${t.pnl} | Recalculated: $${calcPnlUsd.toFixed(6)} | Diff: ${pnlUsdDiff.toFixed(6)}`);
  
  // Duration audit
  const entryMs = new Date(t.entryTime).getTime();
  const exitMs = new Date(t.exitTime).getTime();
  const durMs = exitMs - entryMs;
  const durSec = Math.floor(durMs / 1000);
  console.log(`  Duration (exitTime - entryTime): ${durSec}s (${durMs}ms)`);
  console.log(`  Stored durationSeconds: ${t.durationSeconds}s | stored durationMs: ${t.durationMs}ms | stored holdDuration: ${t.holdDuration}`);
});

// Aggregate stats
const wins = genuine.filter(t => t.pnl > 0);
const losses = genuine.filter(t => t.pnl < 0);
const totalPnl = genuine.reduce((acc, t) => acc + t.pnl, 0);
const winRate = (wins.length / genuine.length) * 100;
const grossProfit = wins.reduce((acc, t) => acc + t.pnl, 0);
const grossLoss = Math.abs(losses.reduce((acc, t) => acc + t.pnl, 0));
const profitFactor = grossLoss === 0 ? grossProfit : grossProfit / grossLoss;
const avgWin = wins.length ? grossProfit / wins.length : 0;
const avgLoss = losses.length ? grossLoss / losses.length : 0;

console.log('\n--- AGGREGATE STATS ---');
console.log(`Total Genuine Trades: ${genuine.length}`);
console.log(`Wins: ${wins.length}`);
console.log(`Losses: ${losses.length}`);
console.log(`Win Rate: ${winRate.toFixed(2)}%`);
console.log(`Total PnL USD: $${totalPnl.toFixed(4)}`);
console.log(`Gross Profit USD: $${grossProfit.toFixed(4)}`);
console.log(`Gross Loss USD: $${grossLoss.toFixed(4)}`);
console.log(`Profit Factor: ${profitFactor.toFixed(4)}`);
console.log(`Average Winner: +$${avgWin.toFixed(4)}`);
console.log(`Average Loser: -$${avgLoss.toFixed(4)}`);
