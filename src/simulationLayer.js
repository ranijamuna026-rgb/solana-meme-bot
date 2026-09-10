// ============================================================================
// TRANSACTION SIMULATION LAYER MODULE (src/simulationLayer.js)
// Purpose: Safety-only transaction preparation and simulation layer for future live trading
// Mode: SIMULATION_ONLY (Data-only objects, ZERO real trades, signing, or blockchain writes)
// ============================================================================

import { config } from './config.js';

/**
 * Simulation Confirmation States.
 */
export const SIMULATION_CONFIRMATION_STATES = Object.freeze({
  NOT_SUBMITTED: 'NOT_SUBMITTED',
  SIMULATED: 'SIMULATED',
  CONFIRMED_SIMULATION: 'CONFIRMED_SIMULATION',
  FAILED_SIMULATION: 'FAILED_SIMULATION'
});

/**
 * Rejection Reason Codes for Safety Violations.
 */
export const SIMULATION_REJECTION_REASONS = Object.freeze({
  SLIPPAGE_LIMIT_EXCEEDED: 'SLIPPAGE_LIMIT_EXCEEDED',
  POSITION_SIZE_LIMIT_EXCEEDED: 'POSITION_SIZE_LIMIT_EXCEEDED',
  DAILY_LOSS_LIMIT_REACHED: 'DAILY_LOSS_LIMIT_REACHED',
  EMERGENCY_KILL_SWITCH_TRIGGERED: 'EMERGENCY_KILL_SWITCH_TRIGGERED',
  DUPLICATE_ORDER: 'DUPLICATE_ORDER',
  INSUFFICIENT_SIMULATED_BALANCE: 'INSUFFICIENT_SIMULATED_BALANCE',
  INVALID_REQUEST: 'INVALID_REQUEST',
  SIMULATION_ERROR: 'SIMULATION_ERROR'
});

// Emergency Kill Switch State
let killSwitchState = 'ARMED'; // 'ARMED' | 'TRIGGERED'

// Duplicate Order Tracking Cache (mint:side -> timestampMs)
const recentOrdersCache = new Map();
const DUPLICATE_WINDOW_MS = 60000; // 60 seconds

// In-Memory Simulation Audit Log
const simulationAuditLogs = [];
const MAX_AUDIT_LOGS = 100;

/**
 * Triggers the emergency kill switch, blocking all future simulation requests.
 */
export function triggerKillSwitch() {
  killSwitchState = 'TRIGGERED';
  console.warn('[SAFETY LOCK] EMERGENCY KILL SWITCH TRIGGERED! All execution simulation requests are now BLOCKED.');
  return { success: true, state: killSwitchState };
}

/**
 * Resets the emergency kill switch to ARMED.
 */
export function resetKillSwitch() {
  killSwitchState = 'ARMED';
  console.log('[SAFETY LOCK] Emergency kill switch reset to ARMED.');
  return { success: true, state: killSwitchState };
}

/**
 * Returns current kill switch state.
 */
export function getKillSwitchState() {
  return killSwitchState;
}

/**
 * Checks if emergency kill switch is triggered.
 */
export function isKillSwitchTriggered() {
  return killSwitchState === 'TRIGGERED' || config.emergencyKillSwitch === true;
}

/**
 * Clears duplicate order cache (useful for test resets).
 */
export function resetDuplicateOrderCache() {
  recentOrdersCache.clear();
}

/**
 * Clears simulation audit logs (useful for test resets).
 */
export function clearSimulationAuditLogs() {
  simulationAuditLogs.length = 0;
}

/**
 * Evaluates slippage protection for BUY or SELL.
 * BUY: current price must not exceed max acceptable price (expectedPrice * (1 + maxSlippagePct/100))
 * SELL: current price must not fall below min acceptable price (expectedPrice * (1 - maxSlippagePct/100))
 * 
 * @param {'BUY'|'SELL'} side 
 * @param {number} currentPrice 
 * @param {number} expectedPrice 
 * @param {number} [maxSlippagePct] 
 * @returns {{ valid: boolean, reason?: string, maxPrice?: number, minPrice?: number }}
 */
export function checkSlippageProtection(side, currentPrice, expectedPrice, maxSlippagePct = null) {
  const slippageLimit = maxSlippagePct !== null ? maxSlippagePct : config.maxSlippagePercent;
  
  if (side === 'BUY') {
    const maxAcceptablePrice = expectedPrice * (1 + slippageLimit / 100);
    if (currentPrice > maxAcceptablePrice) {
      return {
        valid: false,
        reason: SIMULATION_REJECTION_REASONS.SLIPPAGE_LIMIT_EXCEEDED,
        currentPrice,
        expectedPrice,
        maxAcceptablePrice,
        slippageLimit
      };
    }
  } else if (side === 'SELL') {
    const minAcceptablePrice = expectedPrice * (1 - slippageLimit / 100);
    if (currentPrice < minAcceptablePrice) {
      return {
        valid: false,
        reason: SIMULATION_REJECTION_REASONS.SLIPPAGE_LIMIT_EXCEEDED,
        currentPrice,
        expectedPrice,
        minAcceptablePrice,
        slippageLimit
      };
    }
  }

  return { valid: true };
}

/**
 * Checks if requested position size exceeds maximum allowed threshold.
 * 
 * @param {number} amountUsd 
 * @returns {{ valid: boolean, reason?: string }}
 */
export function checkPositionSizeLimit(amountUsd) {
  const maxAllowedUsd = config.maxPositionSizeUsd;
  if (!amountUsd || isNaN(amountUsd) || amountUsd <= 0 || amountUsd > maxAllowedUsd) {
    return {
      valid: false,
      reason: SIMULATION_REJECTION_REASONS.POSITION_SIZE_LIMIT_EXCEEDED,
      requestedAmountUsd: amountUsd,
      maxAllowedUsd
    };
  }
  return { valid: true };
}

/**
 * Checks if daily loss exceeds configured daily loss limit ($20.00).
 * 
 * @param {number} currentDailyLossUsd 
 * @returns {{ valid: boolean, reason?: string }}
 */
export function checkDailyLossLimit(currentDailyLossUsd = 0) {
  const maxDailyLossUsd = config.maxDailyLossUsd;
  if (Math.abs(currentDailyLossUsd) >= maxDailyLossUsd && currentDailyLossUsd < 0) {
    return {
      valid: false,
      reason: SIMULATION_REJECTION_REASONS.DAILY_LOSS_LIMIT_REACHED,
      currentDailyLossUsd,
      maxDailyLossUsd
    };
  }
  return { valid: true };
}

/**
 * Checks for duplicate order requests for the same token and side within sliding window.
 * 
 * @param {string} candidateId 
 * @param {string} tokenMint 
 * @param {'BUY'|'SELL'} side 
 * @returns {{ valid: boolean, reason?: string }}
 */
export function checkDuplicateOrder(candidateId, tokenMint, side, peekOnly = false) {
  const key = `${tokenMint || candidateId}:${side}`;
  const nowMs = Date.now();
  const lastTimeMs = recentOrdersCache.get(key);

  if (lastTimeMs && (nowMs - lastTimeMs) < DUPLICATE_WINDOW_MS) {
    return {
      valid: false,
      reason: SIMULATION_REJECTION_REASONS.DUPLICATE_ORDER,
      lastExecutedMs: lastTimeMs,
      windowMs: DUPLICATE_WINDOW_MS
    };
  }

  // Update order timestamp cache if not peekOnly
  if (!peekOnly) {
    recentOrdersCache.set(key, nowMs);
  }
  return { valid: true };
}

/**
 * Creates a DATA-ONLY transaction request simulation plan object.
 * NO signing, NO serialization for submission, NO broadcasting.
 * 
 * @param {Object} candidateToken 
 * @param {'BUY'|'SELL'} side 
 * @param {number} amountUsd 
 * @param {number} [slippagePct] 
 * @returns {Object} Data-only simulation request plan
 */
export function createSimulationPlan(candidateToken, side = 'BUY', amountUsd = 10, slippagePct = null) {
  const price = candidateToken.priceUsd || 0;
  const slippage = slippagePct !== null ? slippagePct : config.maxSlippagePercent;
  const quantity = price > 0 ? amountUsd / price : 0;
  const nowMs = Date.now();
  const requestId = `SIM-REQ-${nowMs}-${Math.floor(Math.random() * 1000)}`;

  const maxSpendUsd = side === 'BUY' ? amountUsd * (1 + slippage / 100) : amountUsd;
  const minReceivedUsd = side === 'SELL' ? amountUsd * (1 - slippage / 100) : amountUsd;
  const priorityFeeEstimateSol = 0.000005; // 5000 lamports estimated priority fee

  return {
    requestId,
    label: 'SIMULATION_ONLY',
    candidateId: candidateToken.id || candidateToken.address,
    tokenMint: candidateToken.address,
    symbol: candidateToken.symbol || 'UNKNOWN',
    name: candidateToken.name || 'Unknown',
    side,
    requestedAmountUsd: amountUsd,
    estimatedPriceUsd: price,
    estimatedQuantity: quantity,
    slippageLimitPercent: slippage,
    priorityFeeEstimateSol,
    expectedMaxSpendUsd: maxSpendUsd,
    expectedMinReceivedUsd: minReceivedUsd,
    timestamp: new Date(nowMs).toISOString(),
    timestampMs: nowMs,
    safetyStatus: 'SIMULATION_PLAN_PREPARED',
    executionMode: 'SIMULATION_ONLY',
    confirmationState: SIMULATION_CONFIRMATION_STATES.SIMULATED,
    broadcastEnabled: false
  };
}

/**
 * Logs a simulation record into the audit log.
 * @param {Object} record 
 */
export function logSimulationAudit(record) {
  const auditRecord = {
    ...record,
    executionMode: 'SIMULATION_ONLY',
    loggedAt: new Date().toISOString()
  };
  simulationAuditLogs.unshift(auditRecord);
  if (simulationAuditLogs.length > MAX_AUDIT_LOGS) {
    simulationAuditLogs.pop();
  }
  return auditRecord;
}

/**
 * Returns copy of simulation audit logs.
 */
export function getSimulationAuditLogs() {
  return [...simulationAuditLogs];
}

/**
 * Full Transaction Simulation Pipeline.
 * Evaluates all safety checks sequentially and returns an APPROVED_FOR_SIMULATION data object or REJECTED result.
 * 
 * IMPORTANT: "APPROVED_FOR_SIMULATION" does NOT mean approved for real execution.
 * It only means the transaction passes safety checks in simulation.
 * 
 * @param {Object} candidateToken 
 * @param {'BUY'|'SELL'} side 
 * @param {number} amountUsd 
 * @param {Function} [customPriceFn] 
 * @param {number} [currentDailyLossUsd] 
 * @returns {Promise<Object>}
 */
export async function simulateTransaction(candidateToken, side = 'BUY', amountUsd = 10, customPriceFn = null, currentDailyLossUsd = 0) {
  const nowMs = Date.now();

  // Guard 0: Input Request Validation
  if (!candidateToken || !candidateToken.address || !candidateToken.priceUsd || candidateToken.priceUsd <= 0) {
    const rejection = {
      result: 'REJECTED',
      reason: SIMULATION_REJECTION_REASONS.INVALID_REQUEST,
      message: 'Invalid candidate token object or price',
      timestamp: new Date(nowMs).toISOString()
    };
    logSimulationAudit(rejection);
    return rejection;
  }

  // Guard 1: Emergency Kill Switch
  if (isKillSwitchTriggered()) {
    const rejection = {
      result: 'REJECTED',
      reason: SIMULATION_REJECTION_REASONS.EMERGENCY_KILL_SWITCH_TRIGGERED,
      message: 'Emergency kill switch is TRIGGERED. Simulation blocked.',
      timestamp: new Date(nowMs).toISOString()
    };
    logSimulationAudit(rejection);
    return rejection;
  }

  // Guard 2: Position Size Limit Check
  const posCheck = checkPositionSizeLimit(amountUsd);
  if (!posCheck.valid) {
    const rejection = {
      result: 'REJECTED',
      reason: posCheck.reason,
      requestedAmountUsd: amountUsd,
      maxAllowedUsd: posCheck.maxAllowedUsd,
      timestamp: new Date(nowMs).toISOString()
    };
    logSimulationAudit(rejection);
    return rejection;
  }

  // Guard 3: Daily Loss Limit Check
  const lossCheck = checkDailyLossLimit(currentDailyLossUsd);
  if (!lossCheck.valid) {
    const rejection = {
      result: 'REJECTED',
      reason: lossCheck.reason,
      currentDailyLossUsd,
      maxDailyLossUsd: lossCheck.maxDailyLossUsd,
      timestamp: new Date(nowMs).toISOString()
    };
    logSimulationAudit(rejection);
    return rejection;
  }

  // Guard 4: Duplicate Order Check
  const dupCheck = checkDuplicateOrder(candidateToken.id, candidateToken.address, side);
  if (!dupCheck.valid) {
    const rejection = {
      result: 'REJECTED',
      reason: dupCheck.reason,
      tokenMint: candidateToken.address,
      side,
      timestamp: new Date(nowMs).toISOString()
    };
    logSimulationAudit(rejection);
    return rejection;
  }

  // Guard 5: Live Price & Slippage Check
  let currentPrice = candidateToken.priceUsd;
  if (typeof customPriceFn === 'function') {
    try {
      const liveData = await customPriceFn(candidateToken.address);
      if (liveData && liveData.priceUsd && liveData.priceUsd > 0) {
        currentPrice = liveData.priceUsd;
      }
    } catch (err) {
      console.warn('[WARN] Simulation price check fetch failed:', err.message);
    }
  }

  const slipCheck = checkSlippageProtection(side, currentPrice, candidateToken.priceUsd, config.maxSlippagePercent);
  if (!slipCheck.valid) {
    const rejection = {
      result: 'REJECTED',
      reason: slipCheck.reason,
      currentPrice,
      expectedPrice: candidateToken.priceUsd,
      slippageLimitPercent: config.maxSlippagePercent,
      timestamp: new Date(nowMs).toISOString()
    };
    logSimulationAudit(rejection);
    return rejection;
  }

  // All Safety Checks Passed -> Generate Data-Only Simulation Plan
  const plan = createSimulationPlan(candidateToken, side, amountUsd, config.maxSlippagePercent);
  const approval = {
    result: 'APPROVED_FOR_SIMULATION',
    notice: 'APPROVED_FOR_SIMULATION does NOT authorize real trading execution.',
    plan,
    timestamp: new Date(nowMs).toISOString()
  };

  logSimulationAudit(approval);
  return approval;
}
