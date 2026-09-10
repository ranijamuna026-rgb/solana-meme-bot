// ============================================================================
// PAPER TRADING ENGINE MODULE (src/paperTrader.js)
// Purpose: Simulates Paper Trading with Take Profit (+5%), Stop Loss (-3%), and 5m Timeout
// ============================================================================

import fs from 'fs';
import path from 'path';
import { config } from './config.js';
import { fetchTokenMarketDetails } from './monitor.js';
import { registerActiveTrade, recordTradeOutcome } from './riskManager.js';

// Trade Lifecycle States: 'IDLE' | 'ACTIVE' | 'CLOSED'
let tradeState = 'IDLE';

// References for active trade monitoring
let activeTradeRecord = null;
let activeTradeInterval = null;

// Persistent trade history file path
const HISTORY_FILE = path.resolve(process.cwd(), 'paper_trades_history.json');

// In-memory trade history (loaded on startup)
let tradeHistory = loadTradeHistory();

/**
 * Reads existing trade history from JSON file.
 * @returns {Array<Object>}
 */
function loadTradeHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.warn('[WARN] Could not load paper trade history file:', err.message);
  }
  return [];
}

/**
 * Persists trade history to JSON file (skips during test environment execution).
 * @param {Array<Object>} history 
 */
function saveTradeHistory(history) {
  if (process.env.NODE_ENV === 'test' || global.IS_TEST_ENV) {
    return; // Prevent test runs from contaminating production paper_trades_history.json
  }
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
  } catch (err) {
    console.error('[ERROR] Failed to save paper trade history:', err.message);
  }
}

/**
 * Formats duration in milliseconds into "MMm SSs" string.
 * @param {number} ms 
 * @returns {string}
 */
export function formatDuration(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`;
}

/**
 * Classifies whether a paper trade record is a genuine real-market paper trade (Phase 8.7 eligible).
 * @param {Object} t - Trade record
 * @returns {boolean}
 */
export function isGenuineMarketTrade(t) {
  if (!t || typeof t !== 'object') return false;
  if (t.source === 'unit_test') return false;
  if (t.symbol && (t.symbol.startsWith('TEST_') || t.symbol === 'UNKNOWN')) return false;
  if (t.tokenAddress && (t.tokenAddress.startsWith('TEST_TOKEN_') || t.tokenAddress === 'SO11111111111111111111111111111111111111112')) return false;
  if (t.tokenName && t.tokenName.startsWith('Test ')) return false;

  if (t.source && t.source !== 'market_data') return false;

  const pnl = Number(t.pnl !== undefined ? t.pnl : t.paperPnlUsd);
  if (isNaN(pnl) || !isFinite(pnl)) return false;

  const entryPrice = Number(t.entryPrice !== undefined ? t.entryPrice : t.entryPriceUsd);
  const exitPrice = Number(t.exitPrice !== undefined ? t.exitPrice : t.exitPriceUsd);
  if (isNaN(entryPrice) || !isFinite(entryPrice) || entryPrice <= 0) return false;
  if (isNaN(exitPrice) || !isFinite(exitPrice) || exitPrice <= 0) return false;

  return true;
}

/**
 * Returns current trade state ('IDLE', 'ACTIVE', 'CLOSED').
 */
export function getTradeState() {
  return tradeState;
}

/**
 * Returns active trade status and details if active.
 */
export function getActiveTrade() {
  if (tradeState !== 'ACTIVE' || !activeTradeRecord) {
    return { active: false, trade: null };
  }

  const nowMs = Date.now();
  const elapsedMs = nowMs - activeTradeRecord.entryTimeMs;
  const currentPrice = activeTradeRecord.currentPrice || activeTradeRecord.entryPrice;
  const metrics = calculateTradeMetrics(activeTradeRecord.entryPrice, currentPrice, activeTradeRecord.investmentUsd);

  return {
    active: true,
    trade: {
      address: activeTradeRecord.address,
      symbol: activeTradeRecord.symbol,
      name: activeTradeRecord.name,
      entryPrice: activeTradeRecord.entryPrice,
      currentPrice: currentPrice,
      investmentUsd: activeTradeRecord.investmentUsd,
      quantity: activeTradeRecord.quantity,
      entryTime: activeTradeRecord.buyTimestamp,
      elapsedMs: elapsedMs,
      elapsedTimeStr: formatDuration(elapsedMs),
      pnlUsd: metrics.pnlUsd,
      pnlPercent: metrics.pnlPercent,
      profitTargetPercent: activeTradeRecord.profitTargetPercent,
      stopLossPercent: activeTradeRecord.stopLossPercent,
      maxHoldMinutes: activeTradeRecord.maxHoldMinutes,
      status: 'ACTIVE'
    }
  };
}

/**
 * Resets trade state (primarily for testing purposes).
 */
export function resetTradeState() {
  stopPaperTrader();
  tradeState = 'IDLE';
  activeTradeRecord = null;
}

/**
 * Stops any active paper trade monitoring interval cleanly.
 */
export function stopPaperTrader() {
  if (activeTradeInterval) {
    clearInterval(activeTradeInterval);
    activeTradeInterval = null;
  }
}

/**
 * Calculates current paper trade metrics given an entry and current price.
 */
export function calculateTradeMetrics(entryPrice, currentPrice, investmentUsd, feePercent = 0, slippagePercent = 0) {
  const effectiveEntry = entryPrice * (1 + slippagePercent / 100);
  const quantity = investmentUsd / effectiveEntry;
  const effectiveExit = currentPrice * (1 - slippagePercent / 100);
  const grossExitValue = quantity * effectiveExit;
  const feeUsd = (investmentUsd + grossExitValue) * (feePercent / 100);
  const grossValue = grossExitValue - feeUsd;
  const pnlUsd = Number((grossValue - investmentUsd).toFixed(8));
  const pnlPercent = Number((((grossValue - investmentUsd) / investmentUsd) * 100).toFixed(8));
  return {
    quantity,
    grossValue,
    pnlUsd,
    pnlPercent
  };
}

/**
 * Executes a simulated PAPER BUY when a BEST CANDIDATE is selected.
 * Continuously monitors live prices to trigger Take Profit, Stop Loss, or Max Hold Timeout.
 * 
 * IMPORTANT SAFETY NOTICE:
 * This simulation uses NO REAL MONEY, NO PRIVATE KEYS, and NO BLOCKCHAIN TRANSACTIONS.
 * Everything is calculated purely in memory for educational/testing purposes.
 * 
 * @param {Object} candidateToken - The BEST CANDIDATE token object from Phase 4
 * @param {Function|number} [customFetchPriceFnOrSize] - Optional custom market data fetcher or position size override
 * @param {number} [customPositionSizeUsd] - Optional position size override in USD
 */
export async function executePaperTrade(candidateToken, customFetchPriceFnOrSize = null, customPositionSizeUsd = null) {
  // 1. Requirement 8 & 12: Atomic State Guard - Prevent duplicate parallel trades
  if (tradeState !== 'IDLE') {
    console.log('\n========================================');
    console.log('PAPER TRADE SKIPPED');
    console.log('========================================');
    console.log('Reason: Another paper trade is already active.');
    console.log('========================================');
    return null;
  }

  // 2. Verify candidate token price is valid
  if (!candidateToken || !candidateToken.priceUsd || candidateToken.priceUsd <= 0) {
    console.warn('[WARN] Paper trade skipped: invalid entry price for candidate');
    return null;
  }

  // 3. Phase 8.7.2 Milestone Guard - Stop creating new paper positions after 100 genuine market trades
  const genuineMarketTradeCount = tradeHistory.filter(isGenuineMarketTrade).length;
  if (genuineMarketTradeCount >= 100) {
    console.log('\n========================================');
    console.log('VALIDATION MILESTONE REACHED (100/100 GENUINE TRADES)');
    console.log('========================================');
    console.log('Reason: 100 genuine market paper trades completed. Pausing new paper entries.');
    console.log('========================================');
    return null;
  }

  let customFetchPriceFn = null;
  let overridePositionSize = null;

  if (typeof customFetchPriceFnOrSize === 'function') {
    customFetchPriceFn = customFetchPriceFnOrSize;
    if (typeof customPositionSizeUsd === 'number') {
      overridePositionSize = customPositionSizeUsd;
    }
  } else if (typeof customFetchPriceFnOrSize === 'number') {
    overridePositionSize = customFetchPriceFnOrSize;
  }

  // Lock trade state to ACTIVE
  tradeState = 'ACTIVE';

  const entryPrice = candidateToken.priceUsd;
  const investmentUsd = (typeof overridePositionSize === 'number' && overridePositionSize > 0)
    ? overridePositionSize
    : config.paperTradeAmountUsd;
  const quantity = investmentUsd / entryPrice;
  const entryTimeMs = Date.now();
  const buyTimestamp = new Date(entryTimeMs).toISOString();

  registerActiveTrade(candidateToken.address, entryTimeMs);


  const tradeRecord = {
    address: candidateToken.address,
    symbol: candidateToken.symbol || 'UNKNOWN',
    name: candidateToken.name || 'Unknown',
    entryPrice,
    investmentUsd,
    quantity,
    entryTimeMs,
    buyTimestamp,
    maxHoldMinutes: config.maxHoldMinutes,
    maxHoldTimeMs: config.maxHoldTimeMs,
    profitTargetPercent: config.profitTargetPercent,
    stopLossPercent: config.stopLossPercent,
    source: candidateToken.source || ((process.env.NODE_ENV === 'test' || global.IS_TEST_ENV) ? 'unit_test' : 'market_data'),
    execution: 'paper'
  };

  activeTradeRecord = tradeRecord;

  // Log PAPER BUY output
  console.log('\n========================================');
  console.log('PAPER BUY');
  console.log('========================================');
  console.log(`Token       : ${tradeRecord.symbol} (${tradeRecord.name})`);
  console.log(`Entry Price : $${entryPrice.toFixed(8)}`);
  console.log(`Investment  : $${investmentUsd.toFixed(2)}`);
  console.log(`Quantity    : ${quantity.toFixed(4)}`);
  console.log(`Take Profit : +${config.profitTargetPercent.toFixed(2)}%`);
  console.log(`Stop Loss   : -${config.stopLossPercent.toFixed(2)}%`);
  console.log(`Max Hold    : ${tradeRecord.maxHoldMinutes} minute(s)`);
  console.log(`Time        : ${buyTimestamp}`);
  console.log(`MODE        : PAPER TRADING ONLY (No Real Money)`);
  console.log('========================================');
  console.log('PAPER TRADE ACTIVE');
  console.log(`Monitoring price for +${config.profitTargetPercent.toFixed(2)}% TP / -${config.stopLossPercent.toFixed(2)}% SL...`);
  console.log('========================================');

  const fetchPriceFn = customFetchPriceFn || fetchTokenMarketDetails;

  // Start continuous price monitoring loop
  stopPaperTrader();
  activeTradeInterval = setInterval(async () => {
    await processMonitoringCycle(tradeRecord, fetchPriceFn);
  }, config.pricePollIntervalMs);

  return tradeRecord;
}

/**
 * Executes one monitoring cycle tick for an active paper trade.
 */
export async function processMonitoringCycle(tradeRecord, fetchPriceFn) {
  if (tradeState !== 'ACTIVE') return;

  const nowMs = Date.now();
  const elapsedMs = nowMs - tradeRecord.entryTimeMs;
  const elapsedTimeStr = formatDuration(elapsedMs);

  // Fetch fresh market price (Requirement 2 & 9)
  let freshData = null;
  try {
    freshData = await fetchPriceFn(tradeRecord.address);
  } catch (err) {
    freshData = null;
  }

  // API Failure Handling (Requirement 9)
  if (!freshData || !freshData.priceUsd || freshData.priceUsd <= 0) {
    console.log(`\n[WARN] Price update failed.`);
    console.log(`[INFO] Trade remains ACTIVE. Retrying in ${config.pricePollIntervalMs / 1000}s...`);

    // Check if max hold time expired even during API failure
    if (elapsedMs >= tradeRecord.maxHoldTimeMs) {
      console.log(`\n========================================`);
      console.log(`MAX HOLD TIME REACHED`);
      console.log(`========================================`);
      executePaperSell(tradeRecord, tradeRecord.entryPrice, elapsedMs, 'MAX_HOLD_TIME');
    }
    return;
  }

  const currentPrice = freshData.priceUsd;
  tradeRecord.currentPrice = currentPrice;
  const metrics = calculateTradeMetrics(tradeRecord.entryPrice, currentPrice, tradeRecord.investmentUsd);
  const pnlPrefix = metrics.pnlUsd >= 0 ? '+' : '-';
  const pnlAbsUsd = Math.abs(metrics.pnlUsd).toFixed(4);
  const changePrefix = metrics.pnlPercent >= 0 ? '+' : '';

  // Compact Monitoring Log (Requirement 2)
  console.log('\n[PAPER MONITOR]');
  console.log(`Token      : ${tradeRecord.symbol}`);
  console.log(`Entry      : $${tradeRecord.entryPrice.toFixed(8)}`);
  console.log(`Current    : $${currentPrice.toFixed(8)}`);
  console.log(`Change     : ${changePrefix}${metrics.pnlPercent.toFixed(2)}%`);
  console.log(`P&L        : ${pnlPrefix}$${pnlAbsUsd}`);
  console.log(`Elapsed    : ${elapsedTimeStr}`);
  console.log(`TP         : +${tradeRecord.profitTargetPercent.toFixed(2)}%`);
  console.log(`SL         : -${tradeRecord.stopLossPercent.toFixed(2)}%`);

  // Requirement 3: Take Profit Trigger (+5%)
  if (metrics.pnlPercent >= tradeRecord.profitTargetPercent) {
    console.log('\n========================================');
    console.log('TAKE PROFIT HIT');
    console.log('========================================');
    executePaperSell(tradeRecord, currentPrice, elapsedMs, 'TAKE_PROFIT');
  }
  // Requirement 4: Stop Loss Trigger (-3%)
  else if (metrics.pnlPercent <= -tradeRecord.stopLossPercent) {
    console.log('\n========================================');
    console.log('STOP LOSS HIT');
    console.log('========================================');
    executePaperSell(tradeRecord, currentPrice, elapsedMs, 'STOP_LOSS');
  }
  // Requirement 5: Max Hold Time Trigger (5 minutes)
  else if (elapsedMs >= tradeRecord.maxHoldTimeMs) {
    console.log('\n========================================');
    console.log('MAX HOLD TIME REACHED');
    console.log('========================================');
    executePaperSell(tradeRecord, currentPrice, elapsedMs, 'MAX_HOLD_TIME');
  }
}

/**
 * Executes simulated PAPER SELL and calculates final P&L metrics.
 */
export function executePaperSell(tradeRecord, exitPrice, elapsedMs, exitReason) {
  stopPaperTrader();

  const metrics = calculateTradeMetrics(tradeRecord.entryPrice, exitPrice, tradeRecord.investmentUsd);
  const exitValue = metrics.grossValue;
  const pnlUsd = metrics.pnlUsd;
  const pnlPercent = metrics.pnlPercent;
  const exitTime = new Date().toISOString();
  const holdDuration = formatDuration(elapsedMs);

  const pnlUsdFormatted = (pnlUsd >= 0 ? '+' : '-') + `$${Math.abs(pnlUsd).toFixed(2)}`;
  const pnlPercentFormatted = (pnlPercent >= 0 ? '+' : '') + `${pnlPercent.toFixed(2)}%`;

  // Display Requirement 3/4/5 Exit Details
  console.log(`Entry Price : $${tradeRecord.entryPrice.toFixed(8)}`);
  console.log(`Exit Price  : $${exitPrice.toFixed(8)}`);
  console.log(`Quantity    : ${tradeRecord.quantity.toFixed(4)}`);
  console.log(`P&L %       : ${pnlPercentFormatted}`);
  console.log(`P&L $       : ${pnlUsdFormatted}`);
  console.log(`Hold Duration: ${holdDuration}`);
  console.log(`Exit Reason : ${exitReason}`);
  console.log('========================================');

  // Requirement 11: PAPER TRADE CLOSED Banner
  console.log('\nPAPER TRADE CLOSED');
  console.log('==================');
  console.log(`Token      : ${tradeRecord.symbol}`);
  console.log(`Entry      : $${tradeRecord.entryPrice.toFixed(8)}`);
  console.log(`Exit       : $${exitPrice.toFixed(8)}`);
  console.log(`Investment : $${tradeRecord.investmentUsd.toFixed(2)}`);
  console.log(`Exit Value : $${exitValue.toFixed(2)}`);
  console.log(`P&L        : ${pnlUsdFormatted}`);
  console.log(`P&L %      : ${pnlPercentFormatted}`);
  console.log(`Duration   : ${holdDuration}`);
  console.log(`Reason     : ${exitReason}`);
  console.log('==================');

  // Requirement 10: Persistent Paper-Trade History Record
  const tradeId = `PT-${String(tradeHistory.length + 1).padStart(6, '0')}`;
  const completedTrade = {
    tradeId,
    symbol: tradeRecord.symbol,
    tokenName: tradeRecord.name,
    tokenAddress: tradeRecord.address,
    entryPrice: tradeRecord.entryPrice,
    exitPrice,
    quantity: Number(tradeRecord.quantity.toFixed(6)),
    investment: tradeRecord.investmentUsd,
    exitValue: Number(exitValue.toFixed(6)),
    pnl: Number(pnlUsd.toFixed(6)),
    pnlPercent: Number(pnlPercent.toFixed(4)),
    entryTime: new Date(tradeRecord.entryTimeMs).toISOString(),
    exitTime,
    holdDuration,
    durationSeconds: Math.max(0, Math.round(elapsedMs / 1000)),
    durationMs: Math.max(0, elapsedMs),
    exitReason,
    source: tradeRecord.source || ((process.env.NODE_ENV === 'test' || global.IS_TEST_ENV) ? 'unit_test' : 'market_data'),
    execution: tradeRecord.execution || 'paper'
  };

  tradeHistory.push(completedTrade);
  saveTradeHistory(tradeHistory);
  recordTradeOutcome(completedTrade);

  // Requirement 11: PAPER TRADING SUMMARY
  logPaperTradingSummary();

  // Requirement 7: Return state to IDLE
  tradeState = 'CLOSED';
  tradeState = 'IDLE';
  activeTradeRecord = null;

  return completedTrade;
}

/**
 * Prints summary metrics for all completed paper trades.
 */
export function logPaperTradingSummary() {
  const totalTrades = tradeHistory.length;
  const winning = tradeHistory.filter(t => t.pnl > 0).length;
  const losing = tradeHistory.filter(t => t.pnl < 0).length;
  const winRate = totalTrades > 0 ? ((winning / totalTrades) * 100).toFixed(0) : '0';
  const totalPnlUsd = tradeHistory.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const totalPnlFormatted = (totalPnlUsd >= 0 ? '+' : '-') + `$${Math.abs(totalPnlUsd).toFixed(2)}`;

  console.log('\nPAPER TRADING SUMMARY');
  console.log('=====================');
  console.log(`Total Trades : ${totalTrades}`);
  console.log(`Winning      : ${winning}`);
  console.log(`Losing       : ${losing}`);
  console.log(`Win Rate     : ${winRate}%`);
  console.log(`Total P&L    : ${totalPnlFormatted}`);
  console.log('=====================');
}

/**
 * Returns copy of in-memory trade history.
 * @returns {Array<Object>}
 */
export function getTradeHistory() {
  return [...tradeHistory];
}
