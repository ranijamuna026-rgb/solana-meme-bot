// ============================================================================
// TRANSACTION CONFIRMATION MANAGER (src/transactionConfirmation.js)
// Purpose: Controlled Transaction Confirmation State Manager Abstraction
// Mode: FAIL-CLOSED SAFETY LOCK (Zero real RPC submission/confirmation calls,
//       deterministic mocked providers only, zero paper trade history pollution)
// ============================================================================

import { config } from './config.js';
import { isKillSwitchTriggered } from './simulationLayer.js';

/**
 * Standardized Confirmation Lifecycle States.
 */
export const CONFIRMATION_STATES = Object.freeze({
  SUBMITTED: 'SUBMITTED',
  PENDING_CONFIRMATION: 'PENDING_CONFIRMATION',
  CONFIRMED: 'CONFIRMED',
  CONFIRMATION_TIMEOUT: 'CONFIRMATION_TIMEOUT',
  CONFIRMATION_FAILED: 'CONFIRMATION_FAILED',
  CONFIRMATION_BLOCKED: 'CONFIRMATION_BLOCKED'
});

/**
 * TransactionConfirmationManager: Decoupled Confirmation Lifecycle Abstraction.
 * Manages post-submission state transitions (`SUBMITTED` -> `PENDING_CONFIRMATION` -> `CONFIRMED` / `TIMEOUT` / `FAILED` / `BLOCKED`).
 * Strictly fail-closed: Emergency kill switch checks, signature validation, duplicate registration guards, zero RPC broadcast calls.
 */
export class TransactionConfirmationManager {
  constructor(options = {}) {
    this.timeoutMs = options.timeoutMs || config.confirmationTimeoutMs || 30000;
    this.pollIntervalMs = options.pollIntervalMs || config.confirmationPollIntervalMs || 1000;
    this.trackedConfirmations = new Map();
    this.providerFn = options.providerFn || null;
  }

  /**
   * Validates transaction signature / identity string.
   * @param {string} signature 
   * @returns {boolean}
   */
  validateSignature(signature) {
    if (!signature || typeof signature !== 'string' || signature.trim() === '') {
      return false;
    }
    return true;
  }

  /**
   * Registers a transaction signature produced by controlled submission boundary.
   * Initializes status to `SUBMITTED`.
   * 
   * @param {string} signature 
   * @param {object} [options] 
   * @returns {object} Initial tracking record
   */
  register(signature, options = {}) {
    // 1. Emergency kill switch check
    if (isKillSwitchTriggered()) {
      throw new Error('[SAFETY LOCK] Emergency kill switch is active. Transaction confirmation tracking BLOCKED. (CONFIRMATION_BLOCKED)');
    }

    // 2. Signature validation
    if (!this.validateSignature(signature)) {
      throw new Error('[SAFETY LOCK] Invalid signature supplied for confirmation tracking');
    }

    // 3. Duplicate confirmation registration guard
    if (this.trackedConfirmations.has(signature)) {
      throw new Error(`[SAFETY LOCK] Duplicate confirmation tracking rejected for signature: ${signature}`);
    }

    const record = {
      signature,
      status: CONFIRMATION_STATES.SUBMITTED,
      confirmations: 0,
      submittedAt: Date.now(),
      lastPolledAt: null,
      completedAt: null,
      reason: null,
      network: options.network || 'MAINNET'
    };

    this.trackedConfirmations.set(signature, record);
    return { ...record };
  }

  /**
   * Checks/polls confirmation status for a registered transaction signature.
   * Fails closed if kill switch triggered, invalid signature supplied, timeout reached, or provider fails.
   * 
   * @param {string} signature 
   * @param {object} [options] 
   * @returns {Promise<object>} Updated tracking record
   */
  async checkConfirmation(signature, options = {}) {
    // 1. Emergency kill switch check
    if (isKillSwitchTriggered()) {
      if (this.trackedConfirmations.has(signature)) {
        const record = this.trackedConfirmations.get(signature);
        record.status = CONFIRMATION_STATES.CONFIRMATION_BLOCKED;
        record.reason = 'Emergency kill switch triggered during confirmation polling';
        return { ...record };
      }
      throw new Error('[SAFETY LOCK] Emergency kill switch is active. Confirmation check BLOCKED. (CONFIRMATION_BLOCKED)');
    }

    // 2. Validate registration
    if (!this.validateSignature(signature) || !this.trackedConfirmations.has(signature)) {
      throw new Error(`[SAFETY LOCK] Signature not registered for confirmation tracking: ${signature}`);
    }

    const record = this.trackedConfirmations.get(signature);

    // If already in terminal state, return current record
    const terminalStates = [
      CONFIRMATION_STATES.CONFIRMED,
      CONFIRMATION_STATES.CONFIRMATION_TIMEOUT,
      CONFIRMATION_STATES.CONFIRMATION_FAILED,
      CONFIRMATION_STATES.CONFIRMATION_BLOCKED
    ];
    if (terminalStates.includes(record.status)) {
      return { ...record };
    }

    const now = Date.now();
    const timeout = options.timeoutMs !== undefined ? options.timeoutMs : this.timeoutMs;

    // 3. Timeout check
    if (now - record.submittedAt >= timeout) {
      record.status = CONFIRMATION_STATES.CONFIRMATION_TIMEOUT;
      record.completedAt = now;
      record.reason = `Transaction confirmation timed out after ${now - record.submittedAt}ms`;
      return { ...record };
    }

    // Transition to PENDING_CONFIRMATION
    record.status = CONFIRMATION_STATES.PENDING_CONFIRMATION;
    record.lastPolledAt = now;

    const provider = options.providerFn || this.providerFn;

    if (typeof provider === 'function') {
      try {
        const res = await provider(signature, options);
        if (res && res.confirmed) {
          record.status = CONFIRMATION_STATES.CONFIRMED;
          record.confirmations = res.confirmations || 32;
          record.completedAt = Date.now();
          record.reason = null;
        } else if (res && res.failed) {
          record.status = CONFIRMATION_STATES.CONFIRMATION_FAILED;
          record.completedAt = Date.now();
          record.reason = res.reason || 'Transaction failed on-chain';
        } else if (res && res.timeout) {
          record.status = CONFIRMATION_STATES.CONFIRMATION_TIMEOUT;
          record.completedAt = Date.now();
          record.reason = res.reason || 'Provider reported timeout';
        }
      } catch (err) {
        record.status = CONFIRMATION_STATES.CONFIRMATION_FAILED;
        record.completedAt = Date.now();
        record.reason = err.message;
      }
    }

    return { ...record };
  }

  /**
   * Helper method to await confirmation state until completion or timeout.
   * Uses deterministic mocked provider iterations.
   * 
   * @param {string} signature 
   * @param {object} [options] 
   * @returns {Promise<object>}
   */
  async awaitConfirmation(signature, options = {}) {
    const pollMs = options.pollIntervalMs || this.pollIntervalMs;
    const timeoutMs = options.timeoutMs !== undefined ? options.timeoutMs : this.timeoutMs;
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs + 100) {
      const result = await this.checkConfirmation(signature, options);
      if (
        result.status === CONFIRMATION_STATES.CONFIRMED ||
        result.status === CONFIRMATION_STATES.CONFIRMATION_FAILED ||
        result.status === CONFIRMATION_STATES.CONFIRMATION_TIMEOUT ||
        result.status === CONFIRMATION_STATES.CONFIRMATION_BLOCKED
      ) {
        return result;
      }
      if (options.manualStep === true) {
        return result;
      }
      await new Promise(r => setTimeout(r, pollMs));
    }

    return await this.checkConfirmation(signature, { ...options, timeoutMs: 0 });
  }

  /**
   * Returns current confirmation record for a signature.
   * @param {string} signature 
   * @returns {object|null}
   */
  getStatus(signature) {
    if (!this.trackedConfirmations.has(signature)) return null;
    return { ...this.trackedConfirmations.get(signature) };
  }

  /**
   * Resets internal tracking state (for test isolation).
   */
  reset() {
    this.trackedConfirmations.clear();
  }
}
