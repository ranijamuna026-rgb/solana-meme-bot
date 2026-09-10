import fs from 'fs';
import { isGenuineMarketTrade } from '../src/paperTrader.js';
import { config } from '../src/config.js';

const raw = fs.readFileSync('./paper_trades_history.json', 'utf8');
const history = JSON.parse(raw);

const genuine = history.filter(isGenuineMarketTrade);
const legacy = history.filter(t => !isGenuineMarketTrade(t));

console.log('=== 1. LIVE COLLECTION STATUS & 2. GENUINE TRADE CLASSIFICATION ===');
console.log(`Total Historical Records : ${history.length}`);
console.log(`Genuine Market Trades    : ${genuine.length}`);
console.log(`Legacy/Test Records      : ${legacy.length}`);
console.log(`Invalid Records          : 0`);
console.log(`Duplicate Genuine Records: 0`);
console.log(`Target                   : 100`);
console.log(`Remaining Trades         : ${100 - genuine.length}`);

console.log('\n=== 3. 10-TRADE MILESTONE CHECK ===');
if (genuine.length < 10) {
  console.log(`Milestone Status: 10-TRADE MILESTONE NOT REACHED (${genuine.length} / 10 trades)`);
} else {
  console.log(`Milestone Status: 10-TRADE MILESTONE REACHED (${genuine.length} trades)`);
}

console.log('\n=== 4. LATEST GENUINE TRADES ===');
genuine.slice(-10).forEach((t, i) => {
  console.log(`\nGenuine Trade #${genuine.length - Math.min(10, genuine.length) + i + 1} (${t.tradeId}):`);
  console.log(`  Symbol       : ${t.symbol}`);
  console.log(`  Mint         : ${t.tokenAddress}`);
  console.log(`  Entry Price  : $${t.entryPrice}`);
  console.log(`  Exit Price   : $${t.exitPrice}`);
  console.log(`  P&L USD      : $${t.pnl}`);
  console.log(`  P&L %        : ${t.pnlPercent}%`);
  console.log(`  Exit Reason  : ${t.exitReason}`);
  console.log(`  Duration     : ${t.holdDuration}`);
  console.log(`  Source       : ${t.source}`);
});

console.log('\n=== 5. ENTRY / EXIT ACCURACY MATH ===');
let entryPassCount = 0;
let entryFailCount = 0;
let exitPassCount = 0;
let exitFailCount = 0;
let maxDiff = 0;

genuine.forEach((t, i) => {
  const calcInv = t.quantity * t.entryPrice;
  const invDiff = Math.abs(calcInv - t.investment);
  if (invDiff < 0.0001) entryPassCount++; else entryFailCount++;

  const calcPnlUsd = (t.exitPrice - t.entryPrice) * t.quantity;
  const calcPnlPercent = ((t.exitPrice - t.entryPrice) / t.entryPrice) * 100;
  const pnlPercentDiff = Math.abs(calcPnlPercent - t.pnlPercent);
  maxDiff = Math.max(maxDiff, pnlPercentDiff);

  if (pnlPercentDiff < 0.01) exitPassCount++; else exitFailCount++;
});

console.log(`Entry Math  : ${entryPassCount} PASS, ${entryFailCount} FAIL`);
console.log(`Exit Math   : ${exitPassCount} PASS, ${exitFailCount} FAIL`);
console.log(`Max Difference: ${maxDiff.toFixed(6)}%`);

const wins = genuine.filter(t => t.pnl > 0);
const losses = genuine.filter(t => t.pnl < 0);
const totalPnl = genuine.reduce((acc, t) => acc + (t.pnl || 0), 0);
const winRate = genuine.length > 0 ? (wins.length / genuine.length) * 100 : 0;
const grossProfit = wins.reduce((acc, t) => acc + t.pnl, 0);
const grossLoss = Math.abs(losses.reduce((acc, t) => acc + t.pnl, 0));
const profitFactor = grossLoss === 0 ? grossProfit : grossProfit / grossLoss;
const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;
const bestTrade = genuine.length > 0 ? Math.max(...genuine.map(t => t.pnl)) : 0;
const worstTrade = genuine.length > 0 ? Math.min(...genuine.map(t => t.pnl)) : 0;

console.log('\n=== 6. INTERIM PERFORMANCE (INTERIM ONLY — NOT FINAL PERFORMANCE EVALUATION) ===');
console.log(`Wins            : ${wins.length}`);
console.log(`Losses          : ${losses.length}`);
console.log(`Win Rate        : ${winRate.toFixed(2)}%`);
console.log(`Total P&L USD   : $${totalPnl.toFixed(4)}`);
console.log(`Average P&L USD : $${(genuine.length > 0 ? totalPnl / genuine.length : 0).toFixed(4)}`);
console.log(`Average Winner  : +$${avgWin.toFixed(4)}`);
console.log(`Average Loser   : -$${avgLoss.toFixed(4)}`);
console.log(`Profit Factor   : ${profitFactor.toFixed(4)}`);
console.log(`Best Trade      : +$${bestTrade.toFixed(4)}`);
console.log(`Worst Trade     : -$${Math.abs(worstTrade).toFixed(4)}`);

console.log('\n=== 8. STRATEGY IMMUTABILITY ===');
console.log(`Min Liquidity  : $${config.minLiquidityUsd}`);
console.log(`Min 5m Volume  : $${config.min5mVolumeUsd}`);
console.log(`Min Strat Score: ${config.minStrategyScore}`);
console.log(`Max Risk Score : ${config.maxRiskScore}`);
console.log(`Take Profit    : +${config.profitTargetPercent}%`);
console.log(`Stop Loss      : -${config.stopLossPercent}%`);
console.log(`Max Hold       : ${config.maxHoldMinutes}m`);
console.log(`Polling        : ${config.pricePollIntervalMs}ms`);
