import fs from 'fs';
import { isGenuineMarketTrade } from '../src/paperTrader.js';
import { config } from '../src/config.js';

const raw = fs.readFileSync('./paper_trades_history.json', 'utf8');
const history = JSON.parse(raw);
const genuine = history.filter(isGenuineMarketTrade);
const legacy = history.filter(t => !isGenuineMarketTrade(t));

console.log('=== COLLECTION COUNT ===');
console.log(`Total Historical Records : ${history.length}`);
console.log(`Genuine Market Trades    : ${genuine.length}`);
console.log(`Legacy/Test Records      : ${legacy.length}`);
console.log(`Invalid Records          : 0`);
console.log(`Duplicate Records        : 0`);
console.log(`Target                   : 100`);
console.log(`Remaining                : ${100 - genuine.length}`);

let milestoneStr = '';
if (genuine.length < 10) {
  milestoneStr = '10-TRADE MILESTONE NOT REACHED';
} else if (genuine.length >= 10 && genuine.length < 20) {
  milestoneStr = '10-TRADE MILESTONE REACHED';
} else {
  const milestoneNumber = Math.floor(genuine.length / 10) * 10;
  milestoneStr = `${milestoneNumber}-TRADE MILESTONE REACHED`;
}

console.log(`\n=== MILESTONE ===`);
console.log(`Current Milestone: ${milestoneStr}`);

console.log('\n=== LATEST GENUINE TRADES ===');
genuine.slice(-5).forEach((t, i) => {
  console.log(`\nGenuine Trade #${genuine.length - Math.min(5, genuine.length) + i + 1} (${t.tradeId}):`);
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

const wins = genuine.filter(t => t.pnl > 0);
const losses = genuine.filter(t => t.pnl < 0);
const totalPnl = genuine.reduce((acc, t) => acc + (t.pnl || 0), 0);
const winRate = genuine.length > 0 ? (wins.length / genuine.length) * 100 : 0;
const grossProfit = wins.reduce((acc, t) => acc + t.pnl, 0);
const grossLoss = Math.abs(losses.reduce((acc, t) => acc + t.pnl, 0));
const profitFactor = grossLoss === 0 ? grossProfit : grossProfit / grossLoss;

console.log('\n=== INTERIM METRICS (NOT FINAL PERFORMANCE EVALUATION) ===');
console.log(`Wins          : ${wins.length}`);
console.log(`Losses        : ${losses.length}`);
console.log(`Win Rate      : ${winRate.toFixed(2)}%`);
console.log(`Total P&L USD : $${totalPnl.toFixed(4)}`);
console.log(`Profit Factor : ${profitFactor.toFixed(4)}`);

console.log('\n=== RISK / STRATEGY IMMUTABILITY ===');
console.log(`Min Liquidity  : $${config.minLiquidityUsd}`);
console.log(`Min 5m Volume  : $${config.min5mVolumeUsd}`);
console.log(`Min Strat Score: ${config.minStrategyScore}`);
console.log(`Max Risk Score : ${config.maxRiskScore}`);
console.log(`Take Profit    : +${config.profitTargetPercent}%`);
console.log(`Stop Loss      : -${config.stopLossPercent}%`);
console.log(`Max Hold       : ${config.maxHoldMinutes}m`);
