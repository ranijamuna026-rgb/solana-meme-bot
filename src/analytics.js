// ============================================================================
// PERFORMANCE ANALYTICS MODULE (src/analytics.js)
// Purpose: Calculates performance statistics, equity curve, drawdown, and win/loss metrics
// ============================================================================

import { config } from './config.js';
import { formatDuration } from './paperTrader.js';

/**
 * Parses hold duration in milliseconds safely from a trade record object.
 * Checks durationMs, durationSeconds, holdDuration string ("05m 01s"), or entry/exit timestamps.
 * 
 * @param {Object} t 
 * @returns {number} Duration in milliseconds
 */
export function parseDurationMs(t) {
  if (!t || typeof t !== 'object') return 0;
  if (typeof t.durationMs === 'number' && !isNaN(t.durationMs) && t.durationMs >= 0) {
    return t.durationMs;
  }
  if (typeof t.durationSeconds === 'number' && !isNaN(t.durationSeconds) && t.durationSeconds >= 0) {
    return t.durationSeconds * 1000;
  }
  if (typeof t.holdDuration === 'string') {
    const match = t.holdDuration.match(/(\d+)m\s*(\d+)s/);
    if (match) {
      const min = parseInt(match[1], 10);
      const sec = parseInt(match[2], 10);
      return (min * 60 + sec) * 1000;
    }
  }
  if (t.entryTime && t.exitTime) {
    const entryMs = new Date(t.entryTime).getTime();
    const exitMs = new Date(t.exitTime).getTime();
    if (!isNaN(entryMs) && !isNaN(exitMs) && exitMs >= entryMs) {
      return exitMs - entryMs;
    }
  }
  return 0;
}

/**
 * Calculates complete backtest performance analytics from trade history.
 * 
 * @param {Array<Object>} trades - Completed backtest trade records
 * @param {number} [initialCapital] - Starting portfolio balance (default: $1000)
 * @returns {Object} Analytics summary object
 */
export function calculatePerformanceAnalytics(trades, initialCapital = null) {
  const startingBalance = initialCapital !== null ? initialCapital : config.backtestInitialCapital;

  if (!Array.isArray(trades)) {
    trades = [];
  }

  // Record Sanitization & Validation (Requirement 9)
  let validTrades = [];
  let invalidRecordsCount = 0;

  for (const t of trades) {
    if (!t || typeof t !== 'object') {
      invalidRecordsCount++;
      continue;
    }
    const pnl = Number(t.pnl !== undefined ? t.pnl : (t.paperPnlUsd !== undefined ? t.paperPnlUsd : NaN));

    if (isNaN(pnl) || !isFinite(pnl)) {
      invalidRecordsCount++;
      continue;
    }

    const entryPrice = Number(t.entryPrice !== undefined ? t.entryPrice : (t.entryPriceUsd !== undefined ? t.entryPriceUsd : 0));
    const exitPrice = Number(t.exitPrice !== undefined ? t.exitPrice : (t.exitPriceUsd !== undefined ? t.exitPriceUsd : 0));

    validTrades.push({
      ...t,
      entryPrice,
      exitPrice,
      pnl
    });
  }

  if (validTrades.length === 0) {
    return {
      mode: 'PAPER TRADING ONLY',
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      breakevenTrades: 0,
      winRatePercent: 0,
      lossRatePercent: 0,
      grossProfitUsd: 0,
      grossLossUsd: 0,
      netPnlUsd: 0,
      averageTradeUsd: 0,
      averageWinUsd: 0,
      averageLossUsd: 0,
      largestWinUsd: 0,
      largestLossUsd: 0,
      winLossRatio: 0,
      profitFactor: 0,
      profitFactorDisplay: 'N/A',
      initialCapital: startingBalance,
      endingCapital: startingBalance,
      maxDrawdownUsd: 0,
      maxDrawdownPercent: 0,
      averageHoldTimeMs: 0,
      averageHoldTimeStr: '00m 00s',
      exitReasonBreakdown: {
        TAKE_PROFIT: { count: 0, percent: 0 },
        STOP_LOSS: { count: 0, percent: 0 },
        MAX_HOLD_TIME: { count: 0, percent: 0 },
        OTHER: { count: 0, percent: 0 }
      },
      dataQuality: {
        totalRecords: trades.length,
        validRecords: 0,
        invalidRecords: invalidRecordsCount,
        excludedRecords: invalidRecordsCount
      },
      equityCurve: [{ trade: 0, equity: startingBalance, pnl: 0, timestamp: 'START' }]
    };
  }

  const totalTrades = validTrades.length;
  const winningTradesList = validTrades.filter(t => t.pnl > 0);
  const losingTradesList = validTrades.filter(t => t.pnl < 0);
  const breakevenTradesList = validTrades.filter(t => t.pnl === 0);

  const winningTrades = winningTradesList.length;
  const losingTrades = losingTradesList.length;
  const breakevenTrades = breakevenTradesList.length;

  const winRatePercent = (winningTrades / totalTrades) * 100;
  const lossRatePercent = (losingTrades / totalTrades) * 100;

  const grossProfitUsd = winningTradesList.reduce((sum, t) => sum + t.pnl, 0);
  const grossLossUsd = losingTradesList.reduce((sum, t) => sum + t.pnl, 0); // negative float
  const netPnlUsd = grossProfitUsd + grossLossUsd;

  const averageTradeUsd = netPnlUsd / totalTrades;
  const averageWinUsd = winningTrades > 0 ? grossProfitUsd / winningTrades : 0;
  const averageLossUsd = losingTrades > 0 ? grossLossUsd / losingTrades : 0;

  const allPnlValues = validTrades.map(t => t.pnl);
  const largestWinUsd = Math.max(0, ...allPnlValues);
  const largestLossUsd = Math.min(0, ...allPnlValues);

  const absAvgLoss = Math.abs(averageLossUsd);
  const winLossRatio = absAvgLoss > 0 ? averageWinUsd / absAvgLoss : (averageWinUsd > 0 ? averageWinUsd : 0);

  // Safe Profit Factor calculation (Requirement 3.K & 9)
  const absGrossLoss = Math.abs(grossLossUsd);
  let profitFactor = 0;
  let profitFactorDisplay = 'N/A';

  if (absGrossLoss === 0) {
    if (grossProfitUsd > 0) {
      profitFactor = Number(grossProfitUsd.toFixed(2));
      profitFactorDisplay = 'N/A';
    } else {
      profitFactor = 0;
      profitFactorDisplay = '0.00';
    }
  } else {
    profitFactor = grossProfitUsd / absGrossLoss;
    if (isNaN(profitFactor) || !isFinite(profitFactor)) {
      profitFactor = 0;
      profitFactorDisplay = 'N/A';
    } else {
      profitFactorDisplay = profitFactor.toFixed(2);
    }
  }

  // Equity Progression & Max Drawdown Calculation
  let currentEquity = startingBalance;
  let peakEquity = startingBalance;
  let maxDrawdownUsd = 0;
  let maxDrawdownPercent = 0;

  const equityCurve = [
    { trade: 0, equity: startingBalance, pnl: 0, timestamp: validTrades[0]?.entryTime || 'START' }
  ];

  for (let i = 0; i < validTrades.length; i++) {
    const t = validTrades[i];
    currentEquity += t.pnl;

    if (currentEquity > peakEquity) {
      peakEquity = currentEquity;
    }

    const currentDrawdownUsd = peakEquity - currentEquity;
    const currentDrawdownPercent = peakEquity > 0 ? (currentDrawdownUsd / peakEquity) * 100 : 0;

    if (currentDrawdownUsd > maxDrawdownUsd) {
      maxDrawdownUsd = currentDrawdownUsd;
    }
    if (currentDrawdownPercent > maxDrawdownPercent) {
      maxDrawdownPercent = currentDrawdownPercent;
    }

    equityCurve.push({
      trade: i + 1,
      equity: Number(currentEquity.toFixed(2)),
      pnl: Number(t.pnl.toFixed(2)),
      symbol: t.symbol || 'TOKEN',
      timestamp: t.exitTime || new Date().toISOString()
    });
  }

  // Exit Reason Breakdown (Requirement 4)
  const tpCount = validTrades.filter(t => t.exitReason === 'TAKE_PROFIT').length;
  const slCount = validTrades.filter(t => t.exitReason === 'STOP_LOSS').length;
  const mhCount = validTrades.filter(t => t.exitReason === 'MAX_HOLD_TIME' || t.exitReason === 'MAX_HOLD').length;
  const otherCount = totalTrades - (tpCount + slCount + mhCount);

  const exitReasonBreakdown = {
    TAKE_PROFIT: { count: tpCount, percent: Number(((tpCount / totalTrades) * 100).toFixed(2)) },
    STOP_LOSS: { count: slCount, percent: Number(((slCount / totalTrades) * 100).toFixed(2)) },
    MAX_HOLD_TIME: { count: mhCount, percent: Number(((mhCount / totalTrades) * 100).toFixed(2)) },
    OTHER: { count: otherCount, percent: Number(((otherCount / totalTrades) * 100).toFixed(2)) }
  };

  // Average Hold Duration (Requirement 4 & Phase 8.6.1 Audit Fix)
  let totalHoldMs = 0;
  for (const t of validTrades) {
    totalHoldMs += parseDurationMs(t);
  }
  const averageHoldTimeMs = totalHoldMs / totalTrades;
  const averageHoldTimeStr = formatDuration(averageHoldTimeMs);

  return {
    mode: 'PAPER TRADING ONLY',
    totalTrades,
    winningTrades,
    losingTrades,
    breakevenTrades,
    winRatePercent: Number(winRatePercent.toFixed(2)),
    lossRatePercent: Number(lossRatePercent.toFixed(2)),
    grossProfitUsd: Number(grossProfitUsd.toFixed(2)),
    grossLossUsd: Number(grossLossUsd.toFixed(2)),
    netPnlUsd: Number(netPnlUsd.toFixed(2)),
    averageTradeUsd: Number(averageTradeUsd.toFixed(2)),
    averageWinUsd: Number(averageWinUsd.toFixed(2)),
    averageLossUsd: Number(averageLossUsd.toFixed(2)),
    largestWinUsd: Number(largestWinUsd.toFixed(2)),
    largestLossUsd: Number(largestLossUsd.toFixed(2)),
    winLossRatio: Number(winLossRatio.toFixed(2)),
    profitFactor: Number(profitFactor.toFixed(2)),
    profitFactorDisplay,
    initialCapital: startingBalance,
    endingCapital: Number(currentEquity.toFixed(2)),
    maxDrawdownUsd: Number(maxDrawdownUsd.toFixed(2)),
    maxDrawdownPercent: Number(maxDrawdownPercent.toFixed(2)),
    averageHoldTimeMs,
    averageHoldTimeStr,
    exitReasonBreakdown,
    dataQuality: {
      totalRecords: trades.length,
      validRecords: totalTrades,
      invalidRecords: invalidRecordsCount,
      excludedRecords: invalidRecordsCount
    },
    equityCurve
  };
}
