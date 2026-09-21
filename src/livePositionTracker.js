// ============================================================================
// LIVE POSITION LIFECYCLE TRACKER (src/livePositionTracker.js)
// Purpose: Controlled Live Position Lifecycle & State Management Abstraction
// Mode: FAIL-CLOSED SAFETY LOCK (Zero real RPC calls, 0 paper trade history pollution,
//       strict state machine validation, in-memory isolation)
// ============================================================================

import { isKillSwitchTriggered } from './simulationLayer.js';
import { CONFIRMATION_STATES } from './transactionConfirmation.js';

/**
 * Standardized Position Lifecycle States.
 */
export const POSITION_STATES = Object.freeze({
  CREATED: 'CREATED',
  SUBMITTED: 'SUBMITTED',
  PENDING_CONFIRMATION: 'PENDING_CONFIRMATION',
  ACTIVE: 'ACTIVE',
  SELL_SUBMITTED: 'SELL_SUBMITTED',
  SELL_PENDING_CONFIRMATION: 'SELL_PENDING_CONFIRMATION',
  CLOSED: 'CLOSED',
  SUBMISSION_FAILED: 'SUBMISSION_FAILED',
  CONFIRMATION_FAILED: 'CONFIRMATION_FAILED',
  CONFIRMATION_TIMEOUT: 'CONFIRMATION_TIMEOUT',
  CANCELLED: 'CANCELLED'
});

/**
 * Valid State Transition Mapping.
 */
const VALID_TRANSITIONS = {
  [POSITION_STATES.CREATED]: [
    POSITION_STATES.SUBMITTED,
    POSITION_STATES.SUBMISSION_FAILED,
    POSITION_STATES.CANCELLED
  ],
  [POSITION_STATES.SUBMITTED]: [
    POSITION_STATES.PENDING_CONFIRMATION,
    POSITION_STATES.CONFIRMATION_FAILED,
    POSITION_STATES.CONFIRMATION_TIMEOUT,
    POSITION_STATES.CANCELLED
  ],
  [POSITION_STATES.PENDING_CONFIRMATION]: [
    POSITION_STATES.ACTIVE,
    POSITION_STATES.CONFIRMATION_FAILED,
    POSITION_STATES.CONFIRMATION_TIMEOUT,
    POSITION_STATES.CANCELLED
  ],
  [POSITION_STATES.ACTIVE]: [
    POSITION_STATES.SELL_SUBMITTED,
    POSITION_STATES.CLOSED,
    POSITION_STATES.CANCELLED
  ],
  [POSITION_STATES.SELL_SUBMITTED]: [
    POSITION_STATES.SELL_PENDING_CONFIRMATION,
    POSITION_STATES.CLOSED,
    POSITION_STATES.CANCELLED
  ],
  [POSITION_STATES.SELL_PENDING_CONFIRMATION]: [
    POSITION_STATES.CLOSED,
    POSITION_STATES.ACTIVE,
    POSITION_STATES.CANCELLED
  ],
  [POSITION_STATES.CLOSED]: [],
  [POSITION_STATES.SUBMISSION_FAILED]: [],
  [POSITION_STATES.CONFIRMATION_FAILED]: [],
  [POSITION_STATES.CONFIRMATION_TIMEOUT]: [],
  [POSITION_STATES.CANCELLED]: []
};

/**
 * LivePositionTracker: Isolated Preview & Live Position Lifecycle Manager.
 * Manages BUY & SELL position state machine cleanly in memory.
 * Completely separate from paper trading history (`paper_trades_history.json`).
 */
export class LivePositionTracker {
  constructor() {
    this.positions = new Map();
  }

  /**
   * Validates position ID format.
   * @param {string} positionId 
   * @returns {boolean}
   */
  validatePositionId(positionId) {
    if (!positionId || typeof positionId !== 'string' || positionId.trim() === '') {
      return false;
    }
    return true;
  }

  /**
   * Creates a new preview position record in `CREATED` state.
   * 
   * @param {object} details 
   * @returns {object} Initial position record
   */
  createPosition(details = {}) {
    // 1. Emergency kill switch check
    if (isKillSwitchTriggered()) {
      throw new Error('[SAFETY LOCK] Emergency kill switch is active. Position creation BLOCKED.');
    }

    const { positionId, tokenAddress, symbol, side, quantity, entryPrice, signature } = details;

    // 2. Validate position ID
    if (!this.validatePositionId(positionId)) {
      throw new Error('[SAFETY LOCK] Invalid position ID supplied for position creation.');
    }

    // 3. Validate token address
    if (!tokenAddress || typeof tokenAddress !== 'string' || tokenAddress.trim() === '') {
      throw new Error('[SAFETY LOCK] Token address is required for position creation.');
    }

    // 4. Duplicate position ID check
    if (this.positions.has(positionId)) {
      throw new Error(`[SAFETY LOCK] Duplicate position creation blocked for position ID: ${positionId}`);
    }

    const record = {
      positionId,
      tokenAddress,
      symbol: symbol || 'UNKNOWN',
      side: side || 'BUY',
      quantity: typeof quantity === 'number' ? quantity : 0,
      entryPrice: typeof entryPrice === 'number' ? entryPrice : null,
      exitPrice: null,
      signature: signature || null,
      status: POSITION_STATES.CREATED,
      createdAt: Date.now(),
      submittedAt: null,
      confirmedAt: null,
      closedAt: null,
      failureReason: null
    };

    this.positions.set(positionId, record);
    return { ...record };
  }

  /**
   * Transitions a position to a new target state following the state machine rules.
   * Enforces that ACTIVE state requires explicit CONFIRMED confirmation.
   * 
   * @param {string} positionId 
   * @param {string} targetState 
   * @param {object} [options] 
   * @returns {object} Updated position record
   */
  transitionState(positionId, targetState, options = {}) {
    // 1. Emergency kill switch check
    if (isKillSwitchTriggered()) {
      throw new Error('[SAFETY LOCK] Emergency kill switch is active. Position transition BLOCKED.');
    }

    // 2. Validate position existence
    if (!this.validatePositionId(positionId) || !this.positions.has(positionId)) {
      throw new Error(`[SAFETY LOCK] Invalid or non-existent position ID for transition: ${positionId}`);
    }

    const record = this.positions.get(positionId);
    const currentState = record.status;

    // 3. Check allowed transition
    const allowedTargets = VALID_TRANSITIONS[currentState] || [];
    if (!allowedTargets.includes(targetState)) {
      throw new Error(`[SAFETY LOCK] Invalid position state transition from ${currentState} to ${targetState}`);
    }

    // 4. Special rule: Transition to ACTIVE requires confirmed state or explicit confirmation flag
    if (targetState === POSITION_STATES.ACTIVE) {
      const isConfirmed = options.confirmed === true || (options.confirmation && options.confirmation.status === CONFIRMATION_STATES.CONFIRMED);
      if (!isConfirmed) {
        throw new Error('[SAFETY LOCK] Position cannot become ACTIVE without confirmed transaction status.');
      }
    }

    // Update position record
    record.status = targetState;

    if (options.signature) {
      record.signature = options.signature;
    }
    if (typeof options.exitPrice === 'number') {
      record.exitPrice = options.exitPrice;
    }
    if (options.reason) {
      record.failureReason = options.reason;
    }

    const now = Date.now();
    if (targetState === POSITION_STATES.SUBMITTED || targetState === POSITION_STATES.SELL_SUBMITTED) {
      if (!record.submittedAt) record.submittedAt = now;
    } else if (targetState === POSITION_STATES.ACTIVE) {
      record.confirmedAt = now;
    } else if (
      targetState === POSITION_STATES.CLOSED ||
      targetState === POSITION_STATES.SUBMISSION_FAILED ||
      targetState === POSITION_STATES.CONFIRMATION_FAILED ||
      targetState === POSITION_STATES.CONFIRMATION_TIMEOUT ||
      targetState === POSITION_STATES.CANCELLED
    ) {
      record.closedAt = now;
    }

    return { ...record };
  }

  /**
   * Processes a TransactionConfirmationManager result and updates position state accordingly.
   * 
   * @param {string} positionId 
   * @param {object} confirmationRecord 
   * @returns {object} Updated position record
   */
  processConfirmationResult(positionId, confirmationRecord) {
    if (!confirmationRecord || typeof confirmationRecord !== 'object') {
      throw new Error('[SAFETY LOCK] Confirmation record object is required for position update.');
    }

    const record = this.getPosition(positionId);
    if (!record) {
      throw new Error(`[SAFETY LOCK] Position not found: ${positionId}`);
    }

    if (confirmationRecord.status === CONFIRMATION_STATES.CONFIRMED) {
      if (record.status === POSITION_STATES.PENDING_CONFIRMATION) {
        return this.transitionState(positionId, POSITION_STATES.ACTIVE, { confirmed: true, confirmation: confirmationRecord });
      } else if (record.status === POSITION_STATES.SELL_PENDING_CONFIRMATION) {
        return this.transitionState(positionId, POSITION_STATES.CLOSED, { exitPrice: confirmationRecord.exitPrice });
      }
    } else if (confirmationRecord.status === CONFIRMATION_STATES.CONFIRMATION_FAILED || confirmationRecord.status === CONFIRMATION_STATES.CONFIRMATION_TIMEOUT) {
      if (record.status === POSITION_STATES.SELL_PENDING_CONFIRMATION) {
        return this.transitionState(positionId, POSITION_STATES.ACTIVE, { confirmed: true, reason: confirmationRecord.reason });
      } else {
        const targetState = confirmationRecord.status === CONFIRMATION_STATES.CONFIRMATION_FAILED ? POSITION_STATES.CONFIRMATION_FAILED : POSITION_STATES.CONFIRMATION_TIMEOUT;
        return this.transitionState(positionId, targetState, { reason: confirmationRecord.reason });
      }
    } else if (confirmationRecord.status === CONFIRMATION_STATES.CONFIRMATION_BLOCKED) {
      return this.transitionState(positionId, POSITION_STATES.CANCELLED, { reason: confirmationRecord.reason });
    }

    return this.getPosition(positionId);
  }

  /**
   * Returns current position record for positionId.
   * @param {string} positionId 
   * @returns {object|null}
   */
  getPosition(positionId) {
    if (!this.positions.has(positionId)) return null;
    return { ...this.positions.get(positionId) };
  }

  /**
   * Returns all tracked preview positions.
   * @returns {Array<object>}
   */
  getAllPositions() {
    return Array.from(this.positions.values()).map(p => ({ ...p }));
  }

  /**
   * Returns all currently active preview positions.
   * @returns {Array<object>}
   */
  getActivePositions() {
    return Array.from(this.positions.values())
      .filter(p => p.status === POSITION_STATES.ACTIVE)
      .map(p => ({ ...p }));
  }

  /**
   * Resets internal position store (for test isolation).
   */
  reset() {
    this.positions.clear();
  }
}
