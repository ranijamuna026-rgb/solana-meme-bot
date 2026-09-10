// ============================================================================
// BACKTEST RUNNER MODULE (src/runBacktest.js)
// Purpose: CLI entry point to execute backtests, generate reports, and save analytics JSON
// ============================================================================

import fs from 'fs';
import path from 'path';
import { config } from './config.js';
import { runBacktest } from './backtester.js';
import { calculatePerformanceAnalytics } from './analytics.js';

async function main() {
  const customDataPath = process.argv[2];
  const dataFilePath = customDataPath
    ? path.resolve(process.cwd(), customDataPath)
    : path.resolve(process.cwd(), 'data', 'synthetic_backtest_data.json');

  console.log('==================================================');
  console.log('       SOLANA MEMECOIN BOT - BACKTEST ENGINE      ');
  console.log('==================================================');
  console.log(`[INFO] Mode       : HISTORICAL BACKTEST ONLY (Simulation)`);
  console.log(`[INFO] Data File  : ${dataFilePath}`);

  if (!fs.existsSync(dataFilePath)) {
    console.error(`[ERROR] Data file not found: ${dataFilePath}`);
    process.exit(1);
  }

  let rawData = [];
  try {
    const fileContent = fs.readFileSync(dataFilePath, 'utf8');
    rawData = JSON.parse(fileContent);
  } catch (err) {
    console.error(`[ERROR] Failed to parse JSON dataset: ${err.message}`);
    process.exit(1);
  }

  console.log(`[INFO] Loaded ${Array.isArray(rawData) ? rawData.length : 0} raw market records.`);
  console.log('[INFO] Running dataset validation & backtest simulation...\n');

  // Execute Backtest Engine
  const { trades, validation } = runBacktest(rawData);

  if (validation.warnings.length > 0) {
    console.log('[DATA VALIDATION WARNINGS]');
    validation.warnings.slice(0, 10).forEach(w => console.log(` - ${w}`));
    if (validation.warnings.length > 10) {
      console.log(` ... and ${validation.warnings.length - 10} more warnings.`);
    }
    console.log('');
  }

  // Calculate Analytics
  const analytics = calculatePerformanceAnalytics(trades);

  // Format Helper Strings
  const netPnlPrefix = analytics.netPnlUsd >= 0 ? '+' : '-';
  const netPnlFormatted = `${netPnlPrefix}$${Math.abs(analytics.netPnlUsd).toFixed(2)}`;

  const avgTradePrefix = analytics.averageTradeUsd >= 0 ? '+' : '-';
  const avgTradeFormatted = `${avgTradePrefix}$${Math.abs(analytics.averageTradeUsd).toFixed(2)}`;

  const avgWinFormatted = `+$${Math.abs(analytics.averageWinUsd).toFixed(2)}`;
  const avgLossFormatted = `-$${Math.abs(analytics.averageLossUsd).toFixed(2)}`;

  const grossProfitFormatted = `+$${Math.abs(analytics.grossProfitUsd).toFixed(2)}`;
  const grossLossFormatted = `-$${Math.abs(analytics.grossLossUsd).toFixed(2)}`;

  const largestWinFormatted = `+$${Math.abs(analytics.largestWinUsd).toFixed(2)}`;
  const largestLossFormatted = `-$${Math.abs(analytics.largestLossUsd).toFixed(2)}`;

  // Print Requirement 13 Report
  console.log('==================================================');
  console.log('BACKTEST RESULTS');
  console.log('==================================================');
  console.log(`Initial Capital : $${analytics.initialCapital.toFixed(2)}`);
  console.log(`Trade Amount    : $${config.paperTradeAmountUsd.toFixed(2)}`);
  console.log('');
  console.log('Strategy:');
  console.log(`Take Profit    : +${config.profitTargetPercent.toFixed(2)}%`);
  console.log(`Stop Loss      : -${config.stopLossPercent.toFixed(2)}%`);
  console.log(`Max Hold       : ${config.maxHoldMinutes} minute(s)`);
  console.log('--------------------------------------------------');
  console.log('PERFORMANCE');
  console.log('--------------------------------------------------');
  console.log(`Total Trades       : ${analytics.totalTrades}`);
  console.log(`Winning Trades     : ${analytics.winningTrades}`);
  console.log(`Losing Trades      : ${analytics.losingTrades}`);
  console.log(`Win Rate           : ${analytics.winRatePercent.toFixed(2)}%`);
  console.log(`Loss Rate          : ${analytics.lossRatePercent.toFixed(2)}%`);
  console.log('');
  console.log(`Gross Profit       : ${grossProfitFormatted}`);
  console.log(`Gross Loss         : ${grossLossFormatted}`);
  console.log(`Net P&L            : ${netPnlFormatted}`);
  console.log('');
  console.log(`Average Trade      : ${avgTradeFormatted}`);
  console.log(`Average Win        : ${avgWinFormatted}`);
  console.log(`Average Loss       : ${avgLossFormatted}`);
  console.log('');
  console.log(`Largest Win        : ${largestWinFormatted}`);
  console.log(`Largest Loss       : ${largestLossFormatted}`);
  console.log('');
  console.log(`Win/Loss Ratio     : ${analytics.winLossRatio.toFixed(2)}`);
  console.log(`Profit Factor      : ${analytics.profitFactor.toFixed(2)}`);
  console.log('');
  console.log(`Max Drawdown       : $${analytics.maxDrawdownUsd.toFixed(2)}`);
  console.log(`Max Drawdown %     : ${analytics.maxDrawdownPercent.toFixed(2)}%`);
  console.log('');
  console.log(`Average Hold Time  : ${analytics.averageHoldTimeStr}`);
  console.log('--------------------------------------------------');
  console.log('EXIT REASONS');
  console.log('--------------------------------------------------');
  console.log(`TAKE_PROFIT        : ${analytics.exitReasonBreakdown.TAKE_PROFIT.count} trades (${analytics.exitReasonBreakdown.TAKE_PROFIT.percent.toFixed(2)}%)`);
  console.log(`STOP_LOSS          : ${analytics.exitReasonBreakdown.STOP_LOSS.count} trades (${analytics.exitReasonBreakdown.STOP_LOSS.percent.toFixed(2)}%)`);
  console.log(`MAX_HOLD_TIME      : ${analytics.exitReasonBreakdown.MAX_HOLD_TIME.count} trades (${analytics.exitReasonBreakdown.MAX_HOLD_TIME.percent.toFixed(2)}%)`);
  console.log('==================================================');
  console.log('[NOTICE] Synthetic backtest dataset used for strategy validation.');
  console.log('Does NOT guarantee future live trading performance.');
  console.log('==================================================\n');

  // Requirement 20: Persistent output files
  const resultsFile = path.resolve(process.cwd(), 'backtest_results.json');
  const tradesFile = path.resolve(process.cwd(), 'backtest_trades.json');
  const equityFile = path.resolve(process.cwd(), 'backtest_equity_curve.json');

  const { equityCurve, ...summaryObject } = analytics;

  fs.writeFileSync(resultsFile, JSON.stringify(summaryObject, null, 2), 'utf8');
  fs.writeFileSync(tradesFile, JSON.stringify(trades, null, 2), 'utf8');
  fs.writeFileSync(equityFile, JSON.stringify(equityCurve, null, 2), 'utf8');

  console.log(`[INFO] Saved backtest summary to      : ${resultsFile}`);
  console.log(`[INFO] Saved backtest trades to       : ${tradesFile}`);
  console.log(`[INFO] Saved backtest equity curve to : ${equityFile}\n`);
}

main().catch(err => {
  console.error('[FATAL] Backtest error:', err);
  process.exit(1);
});
