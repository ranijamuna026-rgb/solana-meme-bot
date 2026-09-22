// ============================================================================
// CANDIDATE TRACKER MODULE (src/candidateTracker.js)
// Purpose: Stores a bounded ring buffer of candidate tokens evaluated by the bot
// ============================================================================

import { calculateRiskScore } from './riskManager.js';

const MAX_CANDIDATES = 50;
let evaluatedCandidates = [];

/**
 * Records an evaluated token's market metrics and pipeline decision results.
 * 
 * @param {Object} record - Structured evaluation summary object
 */
export function recordCandidate(record) {
  if (!record || typeof record !== 'object') return;

  const strategyScore = record.strategy && typeof record.strategy.totalScore === 'number'
    ? record.strategy.totalScore
    : (typeof record.strategyScore === 'number' ? record.strategyScore : (typeof record.score === 'number' ? record.score : null));

  const riskScore = record.riskManager && typeof record.riskManager.riskScore === 'number'
    ? record.riskManager.riskScore
    : (record.riskFilter && typeof record.riskFilter.riskScore === 'number'
      ? record.riskFilter.riskScore
      : (typeof record.riskScore === 'number' ? record.riskScore : calculateRiskScore(record, strategyScore ?? 70).score));

  let decision = 'REJECTED';
  if ((record.riskManager && record.riskManager.approved === true) || record.decision === 'APPROVED') {
    // Safety enforcement: APPROVED decision requires valid numeric risk and strategy scores
    if (typeof riskScore === 'number' && typeof strategyScore === 'number' && strategyScore >= 70 && riskScore <= 60) {
      decision = 'APPROVED';
    }
  }

  const primaryReason = record.riskManager?.reasons?.[0] || record.riskFilter?.reason || record.decisionReason || (decision === 'APPROVED' ? undefined : 'Failed criteria checks');

  const entry = {
    address: record.address || record.tokenAddress || 'UNKNOWN',
    symbol: record.symbol || 'UNKNOWN',
    name: record.name || 'Unknown',
    priceUsd: record.priceUsd ?? null,
    liquidityUsd: record.liquidityUsd ?? null,
    volume5mUsd: record.volume5mUsd ?? null,
    ageMinutes: record.ageMinutes ?? null,
    riskScore: typeof riskScore === 'number' ? riskScore : 100,
    strategyScore: typeof strategyScore === 'number' ? strategyScore : 0,
    decision,
    decisionReason: primaryReason,
    evaluatedAt: new Date().toISOString(),
    riskFilter: record.riskFilter || { result: 'REJECT', checks: {} },
    strategy: record.strategy || null,
    riskManager: record.riskManager || null
  };

  // Add to front of array (newest first)
  evaluatedCandidates.unshift(entry);

  // Enforce max buffer size
  if (evaluatedCandidates.length > MAX_CANDIDATES) {
    evaluatedCandidates = evaluatedCandidates.slice(0, MAX_CANDIDATES);
  }
}

/**
 * Returns a read-only copy of recent evaluated candidates.
 * @returns {Array<Object>}
 */
export function getCandidates() {
  return JSON.parse(JSON.stringify(evaluatedCandidates));
}

/**
 * Clears evaluated candidate history (used in testing).
 */
export function resetCandidateTracker() {
  evaluatedCandidates = [];
}
