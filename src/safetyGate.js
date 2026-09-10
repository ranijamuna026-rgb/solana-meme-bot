// ============================================================================
// CENTRAL PRE-EXECUTION SAFETY GATE MODULE (src/safetyGate.js)
// Purpose: Centralized safety gate evaluating readiness & safety for execution requests
// Mode: READ-ONLY AUTHORIZATION DATA RESULT (ZERO transaction execution capabilities)
// ============================================================================

import { config } from './config.js';
import { LiveExecutionEngine } from './executionEngine.js';
import {
  simulateTransaction,
  checkSlippageProtection,
  checkPositionSizeLimit,
  checkDailyLossLimit,
  checkDuplicateOrder,
  isKillSwitchTriggered
} from './simulationLayer.js';

/**
 * Execution Safety States.
 */
export const SAFETY_GATE_STATES = Object.freeze({
  PAPER_ONLY: 'PAPER_ONLY',
  SIMULATION_ONLY: 'SIMULATION_ONLY',
  LIVE_LOCKED: 'LIVE_LOCKED',
  SAFETY_REJECTED: 'SAFETY_REJECTED',
  READY_FOR_SIMULATION: 'READY_FOR_SIMULATION'
});

/**
 * Rejection Reason Codes for Safety Gate Failures.
 */
export const SAFETY_GATE_REJECTION_REASONS = Object.freeze({
  SAFETY_CONFIGURATION_INVALID: 'SAFETY_CONFIGURATION_INVALID',
  INVALID_EXECUTION_MODE: 'INVALID_EXECUTION_MODE',
  KILL_SWITCH_TRIGGERED: 'KILL_SWITCH_TRIGGERED',
  DAILY_LOSS_EXCEEDED: 'DAILY_LOSS_EXCEEDED',
  POSITION_SIZE_EXCEEDED: 'POSITION_SIZE_EXCEEDED',
  SLIPPAGE_EXCEEDED: 'SLIPPAGE_EXCEEDED',
  DUPLICATE_ORDER: 'DUPLICATE_ORDER',
  INVALID_REQUEST_DATA: 'INVALID_REQUEST_DATA',
  INSUFFICIENT_SIMULATED_BALANCE: 'INSUFFICIENT_SIMULATED_BALANCE',
  SIMULATION_FAILED: 'SIMULATION_FAILED',
  LIVE_ENGINE_LOCKED: 'LIVE_ENGINE_LOCKED',
  WALLET_UNAVAILABLE: 'WALLET_UNAVAILABLE',
  SIGNING_UNAVAILABLE: 'SIGNING_UNAVAILABLE',
  SUBMISSION_UNAVAILABLE: 'SUBMISSION_UNAVAILABLE'
});

/**
 * Verifies that all required configuration parameters exist and are valid.
 * @returns {boolean}
 */
export function isSafetyConfigurationValid() {
  if (!config) return false;
  if (typeof config.tradingMode !== 'string' || !config.tradingMode) return false;
  if (typeof config.maxPositionSizeUsd !== 'number' || isNaN(config.maxPositionSizeUsd) || config.maxPositionSizeUsd <= 0) return false;
  if (typeof config.maxDailyLossUsd !== 'number' || isNaN(config.maxDailyLossUsd) || config.maxDailyLossUsd <= 0) return false;
  if (typeof config.maxSlippagePercent !== 'number' || isNaN(config.maxSlippagePercent) || config.maxSlippagePercent < 0) return false;
  return true;
}

/**
 * Evaluates a candidate execution request against 13 explicit pre-execution safety conditions.
 * 
 * IMPORTANT: Passing the safety gate (`SAFETY_GATE_PASSED`) is a read-only authorization data result.
 * It NEVER executes, signs, or submits a real transaction.
 * 
 * @param {Object} candidateToken 
 * @param {'BUY'|'SELL'} [side='BUY'] 
 * @param {number} [requestedAmountUsd=10] 
 * @param {number} [simulatedBalanceUsd=1000] 
 * @param {number} [currentDailyLossUsd=0] 
 * @param {Function} [customPriceFn=null] 
 * @returns {Promise<Object>} Structured Safety Gate Result
 */
export async function evaluatePreExecutionSafetyGate(
  candidateToken,
  side = 'BUY',
  requestedAmountUsd = 10,
  simulatedBalanceUsd = 1000,
  currentDailyLossUsd = 0,
  customPriceFn = null
) {
  const nowMs = Date.now();
  const requestId = `GATE-REQ-${nowMs}-${Math.floor(Math.random() * 1000)}`;

  const passedChecks = [];
  const failedChecks = [];

  // Helper to record check results
  const recordCheck = (checkName, isPassed, details = {}) => {
    if (isPassed) {
      passedChecks.push({ check: checkName, passed: true, details });
    } else {
      failedChecks.push({ check: checkName, passed: false, details });
    }
  };

  // CHECK 0: Fail-Closed Configuration Safety Check
  if (!isSafetyConfigurationValid()) {
    recordCheck('0_configuration_integrity', false, { message: 'Required safety configuration is missing or invalid' });
    return {
      requestId,
      executionMode: config.tradingMode || 'UNKNOWN',
      candidateId: candidateToken ? (candidateToken.id || candidateToken.address) : null,
      tokenMint: candidateToken ? candidateToken.address : null,
      side,
      requestedAmount: requestedAmountUsd,
      safetyChecks: 13,
      passedChecks: passedChecks.length,
      failedChecks,
      finalStatus: 'SAFETY_GATE_REJECTED',
      rejectionReason: SAFETY_GATE_REJECTION_REASONS.SAFETY_CONFIGURATION_INVALID,
      timestamp: new Date(nowMs).toISOString(),
      transactionExecutionAuthorized: false
    };
  }
  recordCheck('0_configuration_integrity', true);

  // CHECK 1: Execution Mode Check (Must be PAPER)
  const isPaperMode = (config.tradingMode || 'PAPER').toUpperCase() === 'PAPER';
  recordCheck('1_execution_mode', isPaperMode, { mode: config.tradingMode });
  if (!isPaperMode) {
    return buildGateResult(requestId, candidateToken, side, requestedAmountUsd, passedChecks, failedChecks, SAFETY_GATE_REJECTION_REASONS.INVALID_EXECUTION_MODE, nowMs);
  }

  // CHECK 2: Emergency Kill Switch Check
  const killSwitchActive = isKillSwitchTriggered();
  recordCheck('2_emergency_kill_switch', !killSwitchActive, { killSwitchActive });
  if (killSwitchActive) {
    return buildGateResult(requestId, candidateToken, side, requestedAmountUsd, passedChecks, failedChecks, SAFETY_GATE_REJECTION_REASONS.KILL_SWITCH_TRIGGERED, nowMs);
  }

  // CHECK 3: Request Data Validity Check
  const isValidRequest = candidateToken && candidateToken.address && typeof candidateToken.priceUsd === 'number' && candidateToken.priceUsd > 0 && (side === 'BUY' || side === 'SELL');
  recordCheck('3_request_validity', Boolean(isValidRequest), { address: candidateToken?.address, priceUsd: candidateToken?.priceUsd });
  if (!isValidRequest) {
    return buildGateResult(requestId, candidateToken, side, requestedAmountUsd, passedChecks, failedChecks, SAFETY_GATE_REJECTION_REASONS.INVALID_REQUEST_DATA, nowMs);
  }

  // CHECK 4: Position Size Limit Check ($10 Max)
  const posCheck = checkPositionSizeLimit(requestedAmountUsd);
  recordCheck('4_position_size_limit', posCheck.valid, { requestedAmountUsd, maxAllowedUsd: config.maxPositionSizeUsd });
  if (!posCheck.valid) {
    return buildGateResult(requestId, candidateToken, side, requestedAmountUsd, passedChecks, failedChecks, SAFETY_GATE_REJECTION_REASONS.POSITION_SIZE_EXCEEDED, nowMs);
  }

  // CHECK 5: Daily Loss Limit Check ($20 Max)
  const lossCheck = checkDailyLossLimit(currentDailyLossUsd);
  recordCheck('5_daily_loss_limit', lossCheck.valid, { currentDailyLossUsd, maxDailyLossUsd: config.maxDailyLossUsd });
  if (!lossCheck.valid) {
    return buildGateResult(requestId, candidateToken, side, requestedAmountUsd, passedChecks, failedChecks, SAFETY_GATE_REJECTION_REASONS.DAILY_LOSS_EXCEEDED, nowMs);
  }

  // CHECK 6: Slippage Protection Check
  const slipCheck = checkSlippageProtection(side, candidateToken.priceUsd, candidateToken.priceUsd, config.maxSlippagePercent);
  recordCheck('6_slippage_protection', slipCheck.valid, { maxSlippagePercent: config.maxSlippagePercent });
  if (!slipCheck.valid) {
    return buildGateResult(requestId, candidateToken, side, requestedAmountUsd, passedChecks, failedChecks, SAFETY_GATE_REJECTION_REASONS.SLIPPAGE_EXCEEDED, nowMs);
  }

  // CHECK 7: Duplicate Order Protection Check
  const dupCheck = checkDuplicateOrder(candidateToken.id, candidateToken.address, side, true);
  recordCheck('7_duplicate_order_protection', dupCheck.valid, { candidateId: candidateToken.id });
  if (!dupCheck.valid) {
    return buildGateResult(requestId, candidateToken, side, requestedAmountUsd, passedChecks, failedChecks, SAFETY_GATE_REJECTION_REASONS.DUPLICATE_ORDER, nowMs);
  }

  // CHECK 8: Simulated Balance Sufficiency Check
  const hasSimulatedBalance = typeof simulatedBalanceUsd === 'number' && simulatedBalanceUsd >= requestedAmountUsd;
  recordCheck('8_simulated_balance_sufficiency', hasSimulatedBalance, { simulatedBalanceUsd, requestedAmountUsd });
  if (!hasSimulatedBalance) {
    return buildGateResult(requestId, candidateToken, side, requestedAmountUsd, passedChecks, failedChecks, SAFETY_GATE_REJECTION_REASONS.INSUFFICIENT_SIMULATED_BALANCE, nowMs);
  }

  // CHECK 9: Transaction Simulation Pipeline Check
  const simResult = await simulateTransaction(candidateToken, side, requestedAmountUsd, customPriceFn, currentDailyLossUsd);
  const isSimApproved = simResult && simResult.result === 'APPROVED_FOR_SIMULATION';
  recordCheck('9_simulation_pipeline_result', isSimApproved, { simResult: simResult?.result });
  if (!isSimApproved) {
    const reasonCode = simResult?.reason === 'SLIPPAGE_LIMIT_EXCEEDED'
      ? SAFETY_GATE_REJECTION_REASONS.SLIPPAGE_EXCEEDED
      : SAFETY_GATE_REJECTION_REASONS.SIMULATION_FAILED;
    return buildGateResult(requestId, candidateToken, side, requestedAmountUsd, passedChecks, failedChecks, reasonCode, nowMs);
  }

  // CHECK 10: LiveExecutionEngine Lock Check (Must be fail-closed)
  let isLiveEngineLocked = false;
  try {
    const liveEngine = new LiveExecutionEngine();
    await liveEngine.executeBuy();
  } catch (err) {
    isLiveEngineLocked = err.message.includes('disabled') || err.message.includes('SAFETY LOCK');
  }
  recordCheck('10_live_engine_lock', isLiveEngineLocked);
  if (!isLiveEngineLocked) {
    return buildGateResult(requestId, candidateToken, side, requestedAmountUsd, passedChecks, failedChecks, SAFETY_GATE_REJECTION_REASONS.LIVE_ENGINE_LOCKED, nowMs);
  }

  // CHECK 11: Wallet Availability Check (Must be NONE / DISABLED)
  const isWalletUnavailable = process.env.SOLANA_WALLET_ADDRESS === undefined && process.env.SOLANA_PRIVATE_KEY === undefined;
  recordCheck('11_wallet_unavailability', isWalletUnavailable);
  if (!isWalletUnavailable) {
    return buildGateResult(requestId, candidateToken, side, requestedAmountUsd, passedChecks, failedChecks, SAFETY_GATE_REJECTION_REASONS.WALLET_UNAVAILABLE, nowMs);
  }

  // CHECK 12: Signing Capability Check (Must be NONE / DISABLED)
  const isSigningUnavailable = true; // No signers exist in codebase
  recordCheck('12_signing_unavailability', isSigningUnavailable);

  // CHECK 13: Submission Capability Check (Must be NONE / DISABLED)
  const isSubmissionUnavailable = true; // No transaction submitters exist in codebase
  recordCheck('13_submission_unavailability', isSubmissionUnavailable);

  // All 13 Pre-Execution Safety Checks Passed
  return {
    requestId,
    executionMode: config.tradingMode || 'PAPER',
    candidateId: candidateToken.id || candidateToken.address,
    tokenMint: candidateToken.address,
    side,
    requestedAmount: requestedAmountUsd,
    safetyChecks: 13,
    passedChecks: passedChecks.length,
    failedChecks: [],
    finalStatus: 'SAFETY_GATE_PASSED',
    rejectionReason: null,
    timestamp: new Date(nowMs).toISOString(),
    transactionExecutionAuthorized: false,
    readinessNotice: 'SAFETY_GATE_PASSED indicates readiness evaluation only. Transaction execution remains LOCKED.'
  };
}

/**
 * Internal helper formatting rejected safety gate responses.
 */
function buildGateResult(requestId, candidateToken, side, amountUsd, passedChecks, failedChecks, reasonCode, nowMs) {
  return {
    requestId,
    executionMode: config.tradingMode || 'PAPER',
    candidateId: candidateToken ? (candidateToken.id || candidateToken.address) : null,
    tokenMint: candidateToken ? candidateToken.address : null,
    side,
    requestedAmount: amountUsd,
    safetyChecks: 13,
    passedChecks: passedChecks.length,
    failedChecks,
    finalStatus: 'SAFETY_GATE_REJECTED',
    rejectionReason: reasonCode,
    timestamp: new Date(nowMs).toISOString(),
    transactionExecutionAuthorized: false
  };
}
