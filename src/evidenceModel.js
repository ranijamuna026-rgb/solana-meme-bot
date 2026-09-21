// ============================================================================
// EVIDENCE MODEL (src/evidenceModel.js)
// Phase 9.2 — Real Tomorrow Launch Discovery Engine
// Manages candidate normalization, confidence classification,
// multi-source cross-checking, deduplication, and stale data protection.
// ============================================================================

export const CONFIDENCE_LEVELS = {
  CONFIRMED: 'CONFIRMED',
  EXPECTED: 'EXPECTED',
  WEAK: 'WEAK',
  UNKNOWN: 'UNKNOWN'
};

export const CANDIDATE_STATUS = {
  READY_FOR_LAUNCH: 'READY_FOR_LAUNCH',
  WATCH: 'WATCH',
  DATE_CONFLICT: 'DATE_CONFLICT',
  STALE: 'STALE',
  DATE_CHANGED: 'DATE_CHANGED',
  REJECTED: 'REJECTED'
};

/**
 * Normalizes a raw candidate object into the unified Phase 9.2 Evidence Model.
 * 
 * @param {Object} raw 
 * @returns {Object} Normalized candidate object
 */
export function normalizeCandidate(raw) {
  const now = Date.now();
  
  const name = String(raw.name || raw.symbol || 'Unknown Project').trim();
  const symbol = String(raw.symbol || raw.name || 'UNKNOWN').trim().toUpperCase();
  const chain = String(raw.chain || 'solana').toLowerCase();
  const expectedLaunchDate = raw.expectedLaunchDate || null;
  const expectedLaunchTime = raw.expectedLaunchTime || null;
  const timezone = raw.timezone || 'UTC';
  const launchPlatform = raw.launchPlatform || raw.platform || 'solana_launchpad';
  const source = raw.source || 'unknown_feed';
  const sourceUrl = raw.sourceUrl || raw.url || null;
  const mint = raw.mint || raw.contract || raw.address || null;

  // Evaluate initial confidence level based on source metadata
  let confidence = raw.confidence || CONFIDENCE_LEVELS.UNKNOWN;
  if (!raw.confidence) {
    if (raw.isOfficialAnnouncement && expectedLaunchDate && mint) {
      confidence = CONFIDENCE_LEVELS.CONFIRMED;
    } else if (raw.hasFutureTimestamp && expectedLaunchDate) {
      confidence = CONFIDENCE_LEVELS.EXPECTED;
    } else if (expectedLaunchDate) {
      confidence = CONFIDENCE_LEVELS.WEAK;
    } else {
      confidence = CONFIDENCE_LEVELS.UNKNOWN;
    }
  }

  const evidence = {
    evidenceType: raw.evidenceType || 'public_announcement',
    description: raw.evidenceDescription || `Discovered candidate from ${source}`,
    verifiedDate: Boolean(expectedLaunchDate),
    hasContractMint: Boolean(mint),
    sourcesCount: 1
  };

  const dedupeKey = mint
    ? `mint_${mint.toLowerCase()}`
    : `name_${name.toLowerCase().replace(/[^a-z0-9]/g, '')}_${launchPlatform.toLowerCase()}`;

  return {
    dedupeKey,
    name,
    symbol,
    chain,
    mint,
    expectedLaunchDate,
    expectedLaunchTime,
    timezone,
    launchPlatform,
    source,
    sourceUrl,
    evidence,
    allSources: [{ source, sourceUrl, expectedLaunchDate, timestamp: now }],
    evidenceTimestamp: raw.evidenceTimestamp || now,
    confidence,
    status: raw.status || CANDIDATE_STATUS.READY_FOR_LAUNCH,
    lastVerifiedAt: now
  };
}

/**
 * Deduplicates and merges candidate entries across multiple sources.
 * Detects date conflicts across independent sources and adjusts confidence accordingly.
 * 
 * @param {Array<Object>} candidates - Array of raw/normalized candidates
 * @returns {Array<Object>} Deduplicated candidates with multi-source evidence
 */
export function mergeAndDeduplicateCandidates(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  const map = new Map();

  for (const raw of candidates) {
    const candidate = raw.dedupeKey ? raw : normalizeCandidate(raw);
    const key = candidate.dedupeKey;

    if (!map.has(key)) {
      map.set(key, { ...candidate });
      continue;
    }

    const existing = map.get(key);

    // Append source record to existing candidate
    existing.allSources.push({
      source: candidate.source,
      sourceUrl: candidate.sourceUrl,
      expectedLaunchDate: candidate.expectedLaunchDate,
      timestamp: candidate.evidenceTimestamp
    });
    existing.evidence.sourcesCount = existing.allSources.length;

    // Check for launch date conflicts across sources
    if (existing.expectedLaunchDate && candidate.expectedLaunchDate && existing.expectedLaunchDate !== candidate.expectedLaunchDate) {
      existing.status = CANDIDATE_STATUS.DATE_CONFLICT;
      existing.confidence = CONFIDENCE_LEVELS.WEAK; // Downgrade confidence due to conflicting information
      existing.conflictReason = `Date mismatch: ${existing.source} claims ${existing.expectedLaunchDate}, but ${candidate.source} claims ${candidate.expectedLaunchDate}`;
    } else {
      // If dates agree and we have multiple independent sources, elevate confidence if appropriate
      if (existing.confidence === CONFIDENCE_LEVELS.EXPECTED && existing.allSources.length >= 2) {
        existing.confidence = CONFIDENCE_LEVELS.CONFIRMED;
      }
      // Keep mint if newly discovered
      if (!existing.mint && candidate.mint) {
        existing.mint = candidate.mint;
        existing.evidence.hasContractMint = true;
      }
    }

    existing.lastVerifiedAt = Math.max(existing.lastVerifiedAt, candidate.lastVerifiedAt);
  }

  return Array.from(map.values());
}

/**
 * Validates candidates against stale data or changed launch information.
 * 
 * @param {Array<Object>} candidates 
 * @param {string} targetTomorrowStr - Current expected target date YYYY-MM-DD
 * @param {number} [maxAgeMs=86400000] - Stale threshold (default 24h)
 * @returns {Array<Object>} Candidates with updated staleness status
 */
export function auditCandidateStaleness(candidates, targetTomorrowStr, maxAgeMs = 24 * 60 * 60 * 1000) {
  if (!Array.isArray(candidates)) return [];
  const now = Date.now();

  return candidates.map(c => {
    const updated = { ...c };

    // Check if verification age exceeded max age
    if (now - updated.lastVerifiedAt > maxAgeMs) {
      updated.status = CANDIDATE_STATUS.STALE;
    }

    // Check if expected date changed away from tomorrow
    if (updated.expectedLaunchDate && updated.expectedLaunchDate !== targetTomorrowStr) {
      updated.status = CANDIDATE_STATUS.DATE_CHANGED;
    }

    return updated;
  });
}

/**
 * Filters normalized candidates to return only valid TOMORROW candidates
 * meeting the strict confidence requirements (CONFIRMED or EXPECTED).
 * 
 * @param {Array<Object>} candidates 
 * @param {string} targetTomorrowStr 
 * @returns {{ shortlist: Array<Object>, rejected: Array<Object>, weak: Array<Object> }}
 */
export function filterTomorrowShortlist(candidates, targetTomorrowStr) {
  const shortlist = [];
  const rejected = [];
  const weak = [];

  if (!Array.isArray(candidates)) {
    return { shortlist, rejected, weak };
  }

  for (const candidate of candidates) {
    // Exclude DATE_CONFLICT, STALE, DATE_CHANGED, REJECTED, or LIVE candidates from shortlist
    if (candidate.status === CANDIDATE_STATUS.DATE_CONFLICT ||
        candidate.status === CANDIDATE_STATUS.STALE ||
        candidate.status === CANDIDATE_STATUS.DATE_CHANGED ||
        candidate.status === CANDIDATE_STATUS.REJECTED ||
        candidate.status === 'LIVE_ALREADY_DETECTED' ||
        candidate.category === 'liveLaunchCandidate') {
      rejected.push(candidate);
      continue;
    }

    // Exclude candidate if date does not match target tomorrow
    if (candidate.expectedLaunchDate !== targetTomorrowStr) {
      rejected.push({
        ...candidate,
        rejectionReason: `Expected launch date (${candidate.expectedLaunchDate}) does not match target tomorrow (${targetTomorrowStr})`
      });
      continue;
    }

    // Only CONFIRMED and EXPECTED can enter shortlist
    if (candidate.confidence === CONFIDENCE_LEVELS.CONFIRMED || candidate.confidence === CONFIDENCE_LEVELS.EXPECTED) {
      shortlist.push(candidate);
    } else {
      weak.push({
        ...candidate,
        rejectionReason: `Insufficient evidence confidence level: ${candidate.confidence} (requires CONFIRMED or EXPECTED)`
      });
    }
  }

  return { shortlist, rejected, weak };
}
