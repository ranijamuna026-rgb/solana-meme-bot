// ============================================================================
// EXECUTION ENGINE MODULE (src/executionEngine.js)
// Purpose: Modular Execution Engine Abstraction with Fail-Closed Safety Locks
// Mode: PAPER TRADING DEFAULT / LIVE TRADING DISABLED IN PHASE 9
// ============================================================================

import { config } from './config.js';
import { executePaperTrade, executePaperSell, getTradeHistory } from './paperTrader.js';

/**
 * Supported Trading Execution Modes.
 */
export const TRADING_MODES = Object.freeze({
  PAPER: 'PAPER',
  LIVE: 'LIVE'
});

/**
 * Returns the currently active trading mode from configuration.
 * Default: 'PAPER'
 * 
 * @returns {string} 'PAPER' or 'LIVE'
 */
export function getTradingMode() {
  const mode = (config.tradingMode || 'PAPER').toUpperCase();
  return TRADING_MODES[mode] || TRADING_MODES.PAPER;
}

/**
 * Abstract Base Execution Engine Class.
 * Standardizes trade entry and exit interface for execution strategies.
 */
export class ExecutionEngine {
  /**
   * Executes a BUY order for a candidate token.
   * @param {Object} candidateToken 
   * @param {Function|number} [customFetchPriceFnOrSize] 
   * @param {number} [customPositionSizeUsd] 
   */
  async executeBuy(candidateToken, customFetchPriceFnOrSize = null, customPositionSizeUsd = null) {
    throw new Error('[INTERFACE ERROR] executeBuy must be implemented by subclass');
  }

  /**
   * Executes a SELL order for an active trade record.
   * @param {Object} tradeRecord 
   * @param {number} exitPrice 
   * @param {number} elapsedMs 
   * @param {string} exitReason 
   */
  async executeSell(tradeRecord, exitPrice, elapsedMs, exitReason) {
    throw new Error('[INTERFACE ERROR] executeSell must be implemented by subclass');
  }
}

/**
 * Paper Trading Execution Engine Implementation.
 * Delegates execution directly to the paper trader simulation module.
 */
export class PaperExecutionEngine extends ExecutionEngine {
  constructor() {
    super();
    this.mode = TRADING_MODES.PAPER;
  }

  /**
   * Executes simulated paper trade buy.
   */
  async executeBuy(candidateToken, customFetchPriceFnOrSize = null, customPositionSizeUsd = null) {
    return await executePaperTrade(candidateToken, customFetchPriceFnOrSize, customPositionSizeUsd);
  }

  /**
   * Executes simulated paper trade sell.
   */
  async executeSell(tradeRecord, exitPrice, elapsedMs, exitReason) {
    return executePaperSell(tradeRecord, exitPrice, elapsedMs, exitReason);
  }
}

/**
 * Live Trading Execution Engine Implementation (STRICTLY DISABLED IN PHASE 9).
 * All methods fail-closed to guarantee zero real trades, wallet connections, or blockchain writes.
 */
export class LiveExecutionEngine extends ExecutionEngine {
  constructor() {
    super();
    this.mode = TRADING_MODES.LIVE;
  }

  /**
   * Rejects real BUY execution safely.
   */
  async executeBuy() {
    throw new Error('[SAFETY LOCK] Live trading is disabled in Phase 9. Real BUY operations are prohibited.');
  }

  /**
   * Rejects real SELL execution safely.
   */
  async executeSell() {
    throw new Error('[SAFETY LOCK] Live trading is disabled in Phase 9. Real SELL operations are prohibited.');
  }

  /**
   * Rejects wallet connection attempt.
   */
  async connectWallet() {
    throw new Error('[SAFETY LOCK] Live trading is disabled in Phase 9. Wallet connections are prohibited.');
  }

  /**
   * Rejects transaction signing attempt.
   */
  async signTransaction() {
    throw new Error('[SAFETY LOCK] Live trading is disabled in Phase 9. Transaction signing is prohibited.');
  }

  /**
   * Rejects Solana RPC submission attempt.
   */
  async submitTransaction() {
    throw new Error('[SAFETY LOCK] Live trading is disabled in Phase 9. Solana transaction submissions are prohibited.');
  }
}

// Singleton instances for execution engines
const paperEngine = new PaperExecutionEngine();
const liveEngine = new LiveExecutionEngine();

/**
 * Factory function returning active execution engine based on configuration mode.
 * Safe fallback: returns PaperExecutionEngine for PAPER mode, LiveExecutionEngine (which fails closed) if LIVE mode is selected.
 * 
 * @returns {ExecutionEngine}
 */
export function getExecutionEngine() {
  const mode = getTradingMode();
  if (mode === TRADING_MODES.LIVE) {
    console.warn('[SAFETY LOCK] WARNING: Live trading mode selected. Live execution engine is FAIL-CLOSED in Phase 9.');
    return liveEngine;
  }
  return paperEngine;
}
