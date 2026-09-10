// ============================================================================
// CANDIDATE TRACKER MODULE (src/candidateTracker.js)
// Purpose: Stores a bounded ring buffer of candidate tokens evaluated by the bot
// ============================================================================

const MAX_CANDIDATES = 50;
let evaluatedCandidates = [];

/**
 * Records an evaluated token's market metrics and pipeline decision results.
 * 
 * @param {Object} record - Structured evaluation summary object
 */
export function recordCandidate(record) {
  if (!record || typeof record !== 'object') return;

  const entry = {
    address: record.address || record.tokenAddress || 'UNKNOWN',
    symbol: record.symbol || 'UNKNOWN',
    name: record.name || 'Unknown',
    priceUsd: record.priceUsd ?? null,
    liquidityUsd: record.liquidityUsd ?? null,
    volume5mUsd: record.volume5mUsd ?? null,
    ageMinutes: record.ageMinutes ?? null,
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
