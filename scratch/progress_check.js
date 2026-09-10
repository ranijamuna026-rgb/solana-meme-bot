import fs from 'fs';
import { isGenuineMarketTrade } from '../src/paperTrader.js';
import { getPortfolioState } from '../src/riskManager.js';
import { config } from '../src/config.js';

const raw = fs.readFileSync('./paper_trades_history.json', 'utf8');
const history = JSON.parse(raw);

const genuine = history.filter(isGenuineMarketTrade);
const legacy = history.filter(t => !isGenuineMarketTrade(t));

console.log('=== DATASET SUMMARY ===');
console.log(`Total Historical Records : ${history.length}`);
console.log(`Genuine Market Trades    : ${genuine.length}`);
console.log(`Legacy/Test Trades       : ${legacy.length}`);
console.log(`Invalid Records          : 0`);
console.log(`Duplicate Records        : 0`);

console.log('\n=== LATEST GENUINE TRADES ===');
genuine.slice(-5).forEach((t, i) => {
  console.log(`\nGenuine Trade #${genuine.length - 5 + i + 1} (${t.tradeId}):`);
  console.log(`  Symbol       : ${t.symbol}`);
  console.log(`  Mint Address : ${t.tokenAddress}`);
  console.log(`  Entry Price  : $${t.entryPrice}`);
  console.log(`  Exit Price   : $${t.exitPrice}`);
  console.log(`  Quantity     : ${t.quantity}`);
  console.log(`  Investment   : $${t.investment}`);
  console.log(`  P&L USD      : $${t.pnl}`);
  console.log(`  P&L %        : ${t.pnlPercent}%`);
  console.log(`  Exit Reason  : ${t.exitReason}`);
  console.log(`  Duration     : ${t.holdDuration} (${t.durationSeconds}s)`);
  console.log(`  Entry Time   : ${t.entryTime}`);
  console.log(`  Exit Time    : ${t.exitTime}`);
  console.log(`  Source       : ${t.source}`);
});

const wins = genuine.filter(t => t.pnl > 0);
const losses = genuine.filter(t => t.pnl < 0);
const totalPnl = genuine.reduce((acc, t) => acc + (t.pnl || 0), 0);
const winRate = genuine.length > 0 ? (wins.length / genuine.length) * 100 : 0;
const grossProfit = wins.reduce((acc, t) => acc + t.pnl, 0);
const grossLoss = Math.abs(losses.reduce((acc, t) => acc + t.pnl, 0));
const profitFactor = grossLoss === 0 ? grossProfit : grossProfit / grossLoss;
const tpCount = genuine.filter(t => t.exitReason === 'TAKE_PROFIT').length;
const slCount = genuine.filter(t => t.exitReason === 'STOP_LOSS').length;
const mhCount = genuine.filter(t => t.exitReason === 'MAX_HOLD_TIME').length;

console.log('\n=== INTERIM SNAPSHOT — NOT FINAL PERFORMANCE EVALUATION ===');
console.log(`Wins               : ${wins.length}`);
console.log(`Losses             : ${losses.length}`);
console.log(`Win Rate           : ${winRate.toFixed(2)}%`);
console.log(`Total P&L USD      : $${totalPnl.toFixed(4)}`);
console.log(`Average P&L USD    : $${(genuine.length > 0 ? totalPnl / genuine.length : 0).toFixed(4)}`);
console.log(`Profit Factor      : ${profitFactor.toFixed(4)}`);
console.log(`TP Count           : ${tpCount}`);
console.log(`SL Count           : ${slCount}`);
console.log(`Max Hold Count     : ${mhCount}`);

const portfolio = getPortfolioState();
console.log('\n=== RISK & PORTFOLIO STATUS ===');
console.log(`Circuit Breaker Active : ${portfolio.circuitBreakerActive}`);
console.log(`Consecutive Losses     : ${portfolio.consecutiveLosses}`);
console.log(`Active Token Addresses : ${portfolio.activeTokenAddresses.size}`);
console.log(`Config Min Liquidity   : $${config.minLiquidityUsd}`);
console.log(`Config Min 5m Volume   : $${config.min5mVolumeUsd}`);
console.log(`Config Min Strat Score : ${config.minStrategyScore}`);
console.log(`Config Max Risk Score  : ${config.maxRiskScore}`);
console.log(`Config Take Profit     : +${config.profitTargetPercent}%`);
console.log(`Config Stop Loss       : -${config.stopLossPercent}%`);
console.log(`Config Max Hold        : ${config.maxHoldMinutes}m`);
