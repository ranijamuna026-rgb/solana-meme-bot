// ============================================================================
// BACKTESTING ENGINE MODULE (src/backtester.js)
// Purpose: Replays historical price ticks sequentially to evaluate strategy performance
// ============================================================================

import { config } from './config.js';
import { calculateTradeMetrics, formatDuration } from './paperTrader.js';
import { validateBacktestData } from './dataValidator.js';

/**
 * Runs a backtest simulation over historical price datasets.
 * 
 * IMPORTANT SAFETY NOTICE:
 * This simulation uses NO REAL MONEY, NO PRIVATE KEYS, and NO BLOCKCHAIN TRANSACTIONS.
 * Replay runs completely in memory with zero look-ahead bias and no real-time sleeping.
 * 
 * @param {Array<Object>|Map<string, Array<Object>>} inputData - Historical market data array or Map
 * @param {Object} [overrideOptions] - Optional configuration overrides (feePercent, slippagePercent, etc.)
 * @returns {{ trades: Array<Object>, validation: Object }}
 */
export function runBacktest(inputData, overrideOptions = {}) {
  let validatedDataByToken = null;
  let validationResult = { validRecordsCount: 0, rejectedCount: 0, warnings: [] };

  if (inputData instanceof Map) {
    validatedDataByToken = inputData;
    let count = 0;
    for (const ticks of validatedDataByToken.values()) {
      count += ticks.length;
    }
    validationResult.validRecordsCount = count;
  } else {
    validationResult = validateBacktestData(inputData);
    validatedDataByToken = validationResult.validRecordsByToken;
  }

  const investmentUsd = overrideOptions.investmentUsd ?? config.paperTradeAmountUsd;
  const profitTargetPercent = overrideOptions.profitTargetPercent ?? config.profitTargetPercent;
  const stopLossPercent = overrideOptions.stopLossPercent ?? config.stopLossPercent;
  const maxHoldTimeMs = overrideOptions.maxHoldTimeMs ?? config.maxHoldTimeMs;
  const feePercent = overrideOptions.feePercent ?? config.backtestFeePercent;
  const slippagePercent = overrideOptions.slippagePercent ?? config.backtestSlippagePercent;

  const trades = [];
  let tradeCounter = 1;

  for (const [symbol, ticks] of validatedDataByToken.entries()) {
    if (!ticks || ticks.length === 0) continue;

    // Requirement 4: Simulated Entry at first tick
    const entryTick = ticks[0];
    const entryPrice = entryTick.price;
    const entryTimeMs = entryTick.timeMs;
    const entryTime = entryTick.timestamp;

    let tradeClosed = false;

    // Requirement 5, 22, 23: Sequential monitoring loop without sleeping or look-ahead bias
    for (let i = 0; i < ticks.length; i++) {
      const currentTick = ticks[i];
      const currentPrice = currentTick.price;
      const elapsedMs = currentTick.timeMs - entryTimeMs;

      const metrics = calculateTradeMetrics(entryPrice, currentPrice, investmentUsd, feePercent, slippagePercent);

      let exitReason = null;

      // Requirement 6: Take Profit trigger (+5%)
      if (metrics.pnlPercent >= profitTargetPercent) {
        exitReason = 'TAKE_PROFIT';
      }
      // Requirement 7: Stop Loss trigger (-3%)
      else if (metrics.pnlPercent <= -stopLossPercent) {
        exitReason = 'STOP_LOSS';
      }
      // Requirement 8: Max Hold Time trigger (5 minutes)
      else if (elapsedMs >= maxHoldTimeMs) {
        exitReason = 'MAX_HOLD_TIME';
      }
      // Last tick in dataset reached
      else if (i === ticks.length - 1 && ticks.length > 1) {
        exitReason = elapsedMs >= maxHoldTimeMs ? 'MAX_HOLD_TIME' : 'MAX_HOLD_TIME';
      }

      if (exitReason) {
        // Requirement 9: Store trade result
        const tradeId = `BT-${String(tradeCounter++).padStart(6, '0')}`;
        const holdDuration = formatDuration(elapsedMs);

        const tradeRecord = {
          tradeId,
          symbol,
          tokenName: symbol,
          tokenAddress: entryTick.address || symbol,
          entryPrice,
          exitPrice: currentPrice,
          quantity: Number(metrics.quantity.toFixed(6)),
          investment: investmentUsd,
          exitValue: Number(metrics.grossValue.toFixed(6)),
          pnl: Number(metrics.pnlUsd.toFixed(6)),
          pnlPercent: Number(metrics.pnlPercent.toFixed(4)),
          entryTime,
          exitTime: currentTick.timestamp,
          holdDuration,
          exitReason
        };

        trades.push(tradeRecord);
        tradeClosed = true;
        break;
      }
    }

    // Safety fallback for single tick token records where no trigger was fired in loop
    if (!tradeClosed && ticks.length === 1) {
      const currentTick = ticks[0];
      const metrics = calculateTradeMetrics(entryPrice, entryPrice, investmentUsd, feePercent, slippagePercent);
      const tradeId = `BT-${String(tradeCounter++).padStart(6, '0')}`;

      trades.push({
        tradeId,
        symbol,
        tokenName: symbol,
        tokenAddress: entryTick.address || symbol,
        entryPrice,
        exitPrice: entryPrice,
        quantity: Number(metrics.quantity.toFixed(6)),
        investment: investmentUsd,
        exitValue: Number(metrics.grossValue.toFixed(6)),
        pnl: Number(metrics.pnlUsd.toFixed(6)),
        pnlPercent: Number(metrics.pnlPercent.toFixed(4)),
        entryTime,
        exitTime: currentTick.timestamp,
        holdDuration: '00m 00s',
        exitReason: 'MAX_HOLD_TIME'
      });
    }
  }

  return {
    trades,
    validation: validationResult
  };
}
