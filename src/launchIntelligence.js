// ============================================================================
// LAUNCH INTELLIGENCE ENGINE (src/launchIntelligence.js)
// Phase 9.3 — Real Solana Launch Intelligence
// Purpose: Continuous discovery, verification, tiering, pre-filtering, and ranking
//          of real Solana token launches from public sources.
// Safety: REAL MARKET DATA + PAPER TRADING ONLY (Zero Web3 signing, zero wallets, zero real trades)
// ============================================================================

import { config } from './config.js';
import { calculateTomorrowTargetDate, classifyLaunchDate } from './calendarEngine.js';
import { 
  normalizeCandidate, 
  mergeAndDeduplicateCandidates, 
  auditCandidateStaleness, 
  filterTomorrowShortlist,
  CONFIDENCE_LEVELS,
  CANDIDATE_STATUS 
} from './evidenceModel.js';
import { processPreLaunchCandidates, getTomorrowWatchlist } from './preLaunchEngine.js';

// ============================================================================
// SOURCE TIERS & DATA TYPES
// ============================================================================

export const SOURCE_TIERS = Object.freeze({
  TIER_1: 1, // Official launchpad structured data / official project announcement
  TIER_2: 2, // Reliable public launch calendar / aggregator
  TIER_3: 3, // Public announcement evidence / profile
  TIER_4: 4, // General live market-data discovery
  TIER_5: 5  // Unverified social claim
});

export const SOURCE_DATA_TYPES = Object.freeze({
  FUTURE_LAUNCH_DATA: 'FUTURE_LAUNCH_DATA',
  LIVE_LAUNCH_DATA: 'LIVE_LAUNCH_DATA'
});

export const LAUNCH_CANDIDATE_CATEGORY = Object.freeze({
  SCHEDULED_LAUNCH: 'scheduledLaunchCandidate',
  LIVE_LAUNCH: 'liveLaunchCandidate'
});

export const LAUNCH_INTELLIGENCE_STATUS = Object.freeze({
  VERIFIED_TOMORROW: 'VERIFIED_TOMORROW',
  POSSIBLE_TOMORROW: 'POSSIBLE_TOMORROW',
  LIVE_ALREADY_DETECTED: 'LIVE_ALREADY_DETECTED',
  FUTURE_FAR: 'FUTURE_FAR',
  PAST: 'PAST',
  UNKNOWN: 'UNKNOWN',
  DATE_CONFLICT: 'DATE_CONFLICT',
  NO_VERIFIED_TOMORROW_DATA: 'NO_VERIFIED_TOMORROW_DATA'
});

// ============================================================================
// REGISTERED PUBLIC DATA SOURCES
// ============================================================================

export const LAUNCH_SOURCES = [
  {
    sourceId: 'solana_launchpad_calendar',
    sourceName: 'Solana Ecosystem Launchpad Calendar',
    sourceUrl: process.env.SOLANA_LAUNCH_CALENDAR_URL || null,
    sourceType: 'official_launch_calendar',
    sourceTier: SOURCE_TIERS.TIER_1,
    dataType: SOURCE_DATA_TYPES.FUTURE_LAUNCH_DATA,
    providesFutureDate: true,
    reliability: 'HIGH',
    rateLimitMs: 2000,
    timeoutMs: 8000
  },
  {
    sourceId: 'dexscreener_token_profiles',
    sourceName: 'DexScreener Public Token Profiles API',
    sourceUrl: 'https://api.dexscreener.com/token-profiles/latest/v1',
    sourceType: 'public_token_profiles',
    sourceTier: SOURCE_TIERS.TIER_3,
    dataType: SOURCE_DATA_TYPES.FUTURE_LAUNCH_DATA,
    providesFutureDate: true,
    reliability: 'MEDIUM',
    rateLimitMs: 1000,
    timeoutMs: 8000
  },
  {
    sourceId: 'pumpfun_public_feed',
    sourceName: 'Pump.fun Public Token Feed',
    sourceUrl: 'https://frontend-api.pump.fun/coins/latest',
    sourceType: 'live_launchpad_feed',
    sourceTier: SOURCE_TIERS.TIER_4,
    dataType: SOURCE_DATA_TYPES.LIVE_LAUNCH_DATA,
    providesFutureDate: false,
    reliability: 'MEDIUM',
    rateLimitMs: 2000,
    timeoutMs: 8000
  },
  {
    sourceId: 'moonshot_public_feed',
    sourceName: 'Moonshot Public Market Feed',
    sourceUrl: 'https://api.moonshot.cc/v1/tokens/latest',
    sourceType: 'live_market_feed',
    sourceTier: SOURCE_TIERS.TIER_4,
    dataType: SOURCE_DATA_TYPES.LIVE_LAUNCH_DATA,
    providesFutureDate: false,
    reliability: 'MEDIUM',
    rateLimitMs: 2000,
    timeoutMs: 8000
  }
];

// In-Memory Response Caching
const responseCache = new Map();
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// In-Memory Runtime State
let intelligenceState = {
  lastRunTime: null,
  targetDate: null,
  timezone: 'UTC',
  scheduledCount: 0,
  liveCount: 0,
  confirmedCount: 0,
  expectedCount: 0,
  weakCount: 0,
  rejectedCount: 0,
  overallStatus: 'NOT_RUN',
  message: 'Launch Intelligence has not been executed yet.'
};

let cachedSourcesHealth = {};
let cachedScheduledCandidates = [];
let cachedLiveCandidates = [];
let cachedEvidenceStore = new Map();

// ============================================================================
// CACHING UTILITIES
// ============================================================================

function getCachedResponse(sourceId, ttlMs = DEFAULT_CACHE_TTL_MS) {
  const cached = responseCache.get(sourceId);
  if (cached && (Date.now() - cached.timestamp < ttlMs)) {
    return cached.data;
  }
  return null;
}

function setCachedResponse(sourceId, data) {
  responseCache.set(sourceId, {
    timestamp: Date.now(),
    data
  });
}

export function clearLaunchIntelligenceCache() {
  responseCache.clear();
}

// ============================================================================
// SOURCE FETCHERS & NORMALIZERS
// ============================================================================

/**
 * Generic safe public HTTP fetch with timeout, error classification, and caching.
 */
async function fetchSourceData(source, fetchFn, bypassCache = false) {
  const now = new Date().toISOString();
  
  if (!bypassCache) {
    const cached = getCachedResponse(source.sourceId);
    if (cached) {
      return cached;
    }
  }

  if (!source.sourceUrl) {
    const result = {
      status: 'UNCONFIGURED',
      error: 'Source URL not configured',
      items: [],
      lastCheckedAt: now
    };
    setCachedResponse(source.sourceId, result);
    return result;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), source.timeoutMs || 8000);

    const response = await fetchFn(source.sourceUrl, controller.signal);
    clearTimeout(timeout);

    if (!response) {
      const result = { status: 'SOURCE_UNAVAILABLE', error: 'No response returned', items: [], lastCheckedAt: now };
      setCachedResponse(source.sourceId, result);
      return result;
    }

    if (response.status === 429) {
      const result = { status: 'SOURCE_RATE_LIMITED', error: 'HTTP 429 Rate Limited', items: [], lastCheckedAt: now };
      setCachedResponse(source.sourceId, result);
      return result;
    }

    if (!response.ok) {
      const result = { status: 'SOURCE_UNAVAILABLE', error: `HTTP ${response.status} ${response.statusText}`, items: [], lastCheckedAt: now };
      setCachedResponse(source.sourceId, result);
      return result;
    }

    const data = await response.json();
    if (!data) {
      const result = { status: 'SOURCE_INVALID_DATA', error: 'Null response payload', items: [], lastCheckedAt: now };
      setCachedResponse(source.sourceId, result);
      return result;
    }

    const result = {
      status: 'OK',
      error: null,
      items: data,
      lastCheckedAt: now
    };
    setCachedResponse(source.sourceId, result);
    return result;

  } catch (err) {
    let status = 'SOURCE_UNAVAILABLE';
    let errorMsg = err.message;

    if (err.name === 'AbortError') {
      status = 'SOURCE_TIMEOUT';
      errorMsg = `Request timeout (${source.timeoutMs || 8000}ms)`;
    } else if (err.name === 'SyntaxError') {
      status = 'SOURCE_INVALID_DATA';
      errorMsg = 'Malformed JSON response';
    }

    const result = { status, error: errorMsg, items: [], lastCheckedAt: now };
    setCachedResponse(source.sourceId, result);
    return result;
  }
}

/**
 * Fetches and normalizes Solana Launchpad Calendar.
 */
async function fetchSolanaLaunchCalendar(source, targetTomorrowStr, targetTodayStr, timezone, bypassCache) {
  const fetchRes = await fetchSourceData(source, async (url, signal) => {
    return await fetch(url, { headers: { 'Accept': 'application/json' }, signal });
  }, bypassCache);

  if (fetchRes.status !== 'OK') {
    return { status: fetchRes.status, error: fetchRes.error, candidates: [], lastCheckedAt: fetchRes.lastCheckedAt };
  }

  const rawItems = Array.isArray(fetchRes.items) ? fetchRes.items : (fetchRes.items.launches || fetchRes.items.candidates || []);
  if (!Array.isArray(rawItems)) {
    return { status: 'SOURCE_INVALID_DATA', error: 'Expected array format', candidates: [], lastCheckedAt: fetchRes.lastCheckedAt };
  }

  const candidates = [];
  for (const item of rawItems) {
    if (!item || (item.chain && item.chain.toLowerCase() !== 'solana')) continue;

    const dateStr = item.expectedLaunchDate || item.launchDate || null;
    if (!dateStr) continue;

    const classification = classifyLaunchDate(dateStr, targetTomorrowStr, targetTodayStr, timezone);
    
    candidates.push({
      category: LAUNCH_CANDIDATE_CATEGORY.SCHEDULED_LAUNCH,
      projectName: item.name || item.title || 'Upcoming Solana Token',
      symbol: item.symbol || 'UPCOMING',
      chain: 'solana',
      mintAddress: item.mint || item.contract || null,
      expectedLaunchDate: dateStr,
      expectedLaunchTime: item.launchTime || item.time || null,
      timezone,
      launchPlatform: item.platform || 'solana_launchpad',
      sourceName: source.sourceName,
      sourceUrl: item.url || source.sourceUrl,
      sourceType: source.sourceType,
      sourceTier: source.sourceTier,
      evidenceType: 'official_launch_calendar',
      hasFutureTimestamp: true,
      isOfficialAnnouncement: true,
      confidence: CONFIDENCE_LEVELS.CONFIRMED,
      rawEvidenceSummary: `Listed on official Solana Launch Calendar for ${dateStr}`,
      timingStatus: classification.status
    });
  }

  return { status: 'OK', error: null, candidates, lastCheckedAt: fetchRes.lastCheckedAt };
}

/**
 * Fetches and normalizes DexScreener Public Token Profiles.
 */
async function fetchDexScreenerProfiles(source, targetTomorrowStr, targetTodayStr, timezone, bypassCache) {
  const fetchRes = await fetchSourceData(source, async (url, signal) => {
    return await fetch(url, { headers: { 'Accept': 'application/json' }, signal });
  }, bypassCache);

  if (fetchRes.status !== 'OK') {
    return { status: fetchRes.status, error: fetchRes.error, candidates: [], lastCheckedAt: fetchRes.lastCheckedAt };
  }

  if (!Array.isArray(fetchRes.items)) {
    return { status: 'SOURCE_INVALID_DATA', error: 'Expected array payload', candidates: [], lastCheckedAt: fetchRes.lastCheckedAt };
  }

  const candidates = [];
  for (const item of fetchRes.items) {
    if (!item || item.chainId !== 'solana') continue;

    const description = item.description || '';
    let expectedLaunchDate = item.expectedLaunchDate || null;
    let expectedLaunchTime = item.expectedLaunchTime || null;
    let isOfficialAnnouncement = false;

    // Check description for explicit date strings like "Launch date: 2026-09-15"
    if (!expectedLaunchDate) {
      const dateMatch = description.match(/launch\s*(?:date)?\s*[:=]?\s*(\d{4}-\d{2}-\d{2})/i);
      if (dateMatch) {
        expectedLaunchDate = dateMatch[1];
        isOfficialAnnouncement = true;
      }
    }

    // Strictly skip items without explicit future date evidence
    if (!expectedLaunchDate) {
      continue;
    }

    const classification = classifyLaunchDate(expectedLaunchDate, targetTomorrowStr, targetTodayStr, timezone);

    candidates.push({
      category: LAUNCH_CANDIDATE_CATEGORY.SCHEDULED_LAUNCH,
      projectName: item.tokenAddress ? `Solana Token ${item.tokenAddress.slice(0, 6)}` : 'Solana Profile Project',
      symbol: item.url ? item.url.split('/').pop().toUpperCase() : 'MEME',
      chain: 'solana',
      mintAddress: item.tokenAddress || null,
      expectedLaunchDate,
      expectedLaunchTime,
      timezone,
      launchPlatform: 'dexscreener_profile',
      sourceName: source.sourceName,
      sourceUrl: item.url || source.sourceUrl,
      sourceType: source.sourceType,
      sourceTier: source.sourceTier,
      evidenceType: 'public_token_profile',
      hasFutureTimestamp: true,
      isOfficialAnnouncement,
      confidence: isOfficialAnnouncement ? CONFIDENCE_LEVELS.EXPECTED : CONFIDENCE_LEVELS.WEAK,
      rawEvidenceSummary: `DexScreener profile specifies launch date ${expectedLaunchDate}`,
      timingStatus: classification.status
    });
  }

  return { status: 'OK', error: null, candidates, lastCheckedAt: fetchRes.lastCheckedAt };
}

/**
 * Fetches and normalizes Pump.fun Live Token Feed (Separated into LIVE_ALREADY_DETECTED).
 */
async function fetchPumpFunFeed(source, bypassCache) {
  const fetchRes = await fetchSourceData(source, async (url, signal) => {
    return await fetch(url, { headers: { 'Accept': 'application/json' }, signal });
  }, bypassCache);

  if (fetchRes.status !== 'OK') {
    return { status: fetchRes.status, error: fetchRes.error, candidates: [], lastCheckedAt: fetchRes.lastCheckedAt };
  }

  const rawItems = Array.isArray(fetchRes.items) ? fetchRes.items : (fetchRes.items.coins || []);
  const candidates = [];

  for (const item of rawItems) {
    if (!item) continue;

    candidates.push({
      category: LAUNCH_CANDIDATE_CATEGORY.LIVE_LAUNCH,
      projectName: item.name || 'Pump.fun Token',
      symbol: (item.symbol || 'PUMP').toUpperCase(),
      chain: 'solana',
      mintAddress: item.mint || item.contract || item.address || null,
      expectedLaunchDate: null,
      expectedLaunchTime: null,
      timezone: 'UTC',
      launchPlatform: 'pumpfun',
      sourceName: source.sourceName,
      sourceUrl: item.mint ? `https://pump.fun/coin/${item.mint}` : source.sourceUrl,
      sourceType: source.sourceType,
      sourceTier: source.sourceTier,
      evidenceType: 'live_launchpad_feed',
      confidence: CONFIDENCE_LEVELS.UNKNOWN,
      status: LAUNCH_INTELLIGENCE_STATUS.LIVE_ALREADY_DETECTED,
      rawEvidenceSummary: 'Discovered from live Pump.fun token feed. Token is ALREADY LIVE.',
      timingStatus: 'LIVE'
    });
  }

  return { status: 'OK', error: null, candidates, lastCheckedAt: fetchRes.lastCheckedAt };
}

/**
 * Fetches and normalizes Moonshot Live Feed.
 */
async function fetchMoonshotFeed(source, bypassCache) {
  const fetchRes = await fetchSourceData(source, async (url, signal) => {
    return await fetch(url, { headers: { 'Accept': 'application/json' }, signal });
  }, bypassCache);

  if (fetchRes.status !== 'OK') {
    return { status: fetchRes.status, error: fetchRes.error, candidates: [], lastCheckedAt: fetchRes.lastCheckedAt };
  }

  const rawItems = Array.isArray(fetchRes.items) ? fetchRes.items : (fetchRes.items.tokens || []);
  const candidates = [];

  for (const item of rawItems) {
    if (!item) continue;

    candidates.push({
      category: LAUNCH_CANDIDATE_CATEGORY.LIVE_LAUNCH,
      projectName: item.name || 'Moonshot Token',
      symbol: (item.symbol || 'MOON').toUpperCase(),
      chain: 'solana',
      mintAddress: item.mint || item.address || null,
      expectedLaunchDate: null,
      expectedLaunchTime: null,
      timezone: 'UTC',
      launchPlatform: 'moonshot',
      sourceName: source.sourceName,
      sourceUrl: source.sourceUrl,
      sourceType: source.sourceType,
      sourceTier: source.sourceTier,
      evidenceType: 'live_market_feed',
      confidence: CONFIDENCE_LEVELS.UNKNOWN,
      status: LAUNCH_INTELLIGENCE_STATUS.LIVE_ALREADY_DETECTED,
      rawEvidenceSummary: 'Discovered from live Moonshot market feed. Token is ALREADY LIVE.',
      timingStatus: 'LIVE'
    });
  }

  return { status: 'OK', error: null, candidates, lastCheckedAt: fetchRes.lastCheckedAt };
}

// ============================================================================
// EVIDENCE SCORE & CONFIDENCE EVALUATION
// ============================================================================

/**
 * Calculates evidence confidence level according to strict Phase 9.3 rules.
 * 
 * Rules:
 * - Tier 4 or 5 alone can NEVER produce CONFIRMED status.
 * - Multiple independent reliable sources agreeing on launch date -> CONFIRMED.
 * - Single reliable structured Tier 1/2 source -> EXPECTED.
 * - Announcement exists but weak/unverified date -> WEAK.
 * - Missing date -> UNKNOWN.
 */
export function calculateEvidenceConfidence(candidate, allSources = []) {
  if (!candidate.expectedLaunchDate) {
    return CONFIDENCE_LEVELS.UNKNOWN;
  }

  const sources = allSources.length > 0 ? allSources : [candidate];
  const maxTier = Math.min(...sources.map(s => s.sourceTier || SOURCE_TIERS.TIER_4));

  // Check for date conflict across sources
  const dates = new Set(sources.map(s => s.expectedLaunchDate).filter(Boolean));
  if (dates.size > 1) {
    return CONFIDENCE_LEVELS.WEAK; // Date conflict degrades to WEAK
  }

  // Tier 4 or 5 alone cannot create CONFIRMED
  if (maxTier >= SOURCE_TIERS.TIER_4) {
    return candidate.expectedLaunchDate ? CONFIDENCE_LEVELS.WEAK : CONFIDENCE_LEVELS.UNKNOWN;
  }

  if (sources.length >= 2 && maxTier <= SOURCE_TIERS.TIER_3) {
    return CONFIDENCE_LEVELS.CONFIRMED;
  }

  if (maxTier <= SOURCE_TIERS.TIER_2) {
    return CONFIDENCE_LEVELS.EXPECTED;
  }

  if (candidate.isOfficialAnnouncement) {
    return CONFIDENCE_LEVELS.EXPECTED;
  }

  return CONFIDENCE_LEVELS.WEAK;
}

// ============================================================================
// MAIN LAUNCH INTELLIGENCE ORCHESTRATOR
// ============================================================================

/**
 * Executes full Launch Intelligence scan across all registered public sources.
 * 
 * @param {Object} [options] 
 * @param {number} [options.nowMs]
 * @param {string} [options.timezone]
 * @param {boolean} [options.bypassCache]
 * @returns {Promise<Object>} Launch Intelligence Execution Summary Report
 */
export async function runLaunchIntelligence(options = {}) {
  const nowMs = options.nowMs || Date.now();
  const timezone = options.timezone || config.prelaunchTimezone || 'UTC';
  const bypassCache = Boolean(options.bypassCache);

  const { todayDateStr, tomorrowDateStr } = calculateTomorrowTargetDate(nowMs, timezone);

  const sourcesHealth = {};
  const scheduledRawCandidates = [];
  const liveRawCandidates = [];

  let successfulFutureSources = 0;
  let totalFutureSources = LAUNCH_SOURCES.filter(s => s.dataType === SOURCE_DATA_TYPES.FUTURE_LAUNCH_DATA).length;

  // 1. Query Solana Launchpad Calendar
  const calSource = LAUNCH_SOURCES.find(s => s.sourceId === 'solana_launchpad_calendar');
  const calRes = await fetchSolanaLaunchCalendar(calSource, tomorrowDateStr, todayDateStr, timezone, bypassCache);
  sourcesHealth.solana_launchpad_calendar = {
    sourceId: calSource.sourceId,
    sourceName: calSource.sourceName,
    sourceTier: calSource.sourceTier,
    dataType: calSource.dataType,
    status: calRes.status,
    error: calRes.error,
    candidatesFound: calRes.candidates.length,
    lastCheckedAt: calRes.lastCheckedAt
  };
  if (calRes.status === 'OK') {
    successfulFutureSources++;
    scheduledRawCandidates.push(...calRes.candidates);
  }

  // 2. Query DexScreener Public Profiles
  const dexSource = LAUNCH_SOURCES.find(s => s.sourceId === 'dexscreener_token_profiles');
  const dexRes = await fetchDexScreenerProfiles(dexSource, tomorrowDateStr, todayDateStr, timezone, bypassCache);
  sourcesHealth.dexscreener_token_profiles = {
    sourceId: dexSource.sourceId,
    sourceName: dexSource.sourceName,
    sourceTier: dexSource.sourceTier,
    dataType: dexSource.dataType,
    status: dexRes.status,
    error: dexRes.error,
    candidatesFound: dexRes.candidates.length,
    lastCheckedAt: dexRes.lastCheckedAt
  };
  if (dexRes.status === 'OK') {
    successfulFutureSources++;
    scheduledRawCandidates.push(...dexRes.candidates);
  }

  // 3. Query Pump.fun Live Feed (Separated from scheduled)
  const pumpSource = LAUNCH_SOURCES.find(s => s.sourceId === 'pumpfun_public_feed');
  const pumpRes = await fetchPumpFunFeed(pumpSource, bypassCache);
  sourcesHealth.pumpfun_public_feed = {
    sourceId: pumpSource.sourceId,
    sourceName: pumpSource.sourceName,
    sourceTier: pumpSource.sourceTier,
    dataType: pumpSource.dataType,
    status: pumpRes.status,
    error: pumpRes.error,
    candidatesFound: pumpRes.candidates.length,
    lastCheckedAt: pumpRes.lastCheckedAt
  };
  if (pumpRes.status === 'OK') {
    liveRawCandidates.push(...pumpRes.candidates);
  }

  // 4. Query Moonshot Live Feed (Separated from scheduled)
  const moonSource = LAUNCH_SOURCES.find(s => s.sourceId === 'moonshot_public_feed');
  const moonRes = await fetchMoonshotFeed(moonSource, bypassCache);
  sourcesHealth.moonshot_public_feed = {
    sourceId: moonSource.sourceId,
    sourceName: moonSource.sourceName,
    sourceTier: moonSource.sourceTier,
    dataType: moonSource.dataType,
    status: moonRes.status,
    error: moonRes.error,
    candidatesFound: moonRes.candidates.length,
    lastCheckedAt: moonRes.lastCheckedAt
  };
  if (moonRes.status === 'OK') {
    liveRawCandidates.push(...moonRes.candidates);
  }

  cachedSourcesHealth = sourcesHealth;

  // Process & Deduplicate Scheduled Candidates
  const deduplicatedScheduled = mergeAndDeduplicateCandidates(scheduledRawCandidates.map(c => ({
    ...c,
    name: c.projectName,
    symbol: c.symbol,
    mint: c.mintAddress,
    platform: c.launchPlatform,
    source: c.sourceName,
    sourceUrl: c.sourceUrl,
    evidenceType: c.evidenceType
  })));

  // Audit Staleness against Tomorrow Date
  const auditedScheduled = auditCandidateStaleness(deduplicatedScheduled, tomorrowDateStr);

  // Filter Tomorrow Shortlist (Strict TOMORROW date + CONFIRMED/EXPECTED confidence)
  const { shortlist, rejected, weak } = filterTomorrowShortlist(auditedScheduled, tomorrowDateStr);

  const confirmedCount = shortlist.filter(c => c.confidence === CONFIDENCE_LEVELS.CONFIRMED).length;
  const expectedCount = shortlist.filter(c => c.confidence === CONFIDENCE_LEVELS.EXPECTED).length;

  // Store detailed evidence model for candidate lookup
  cachedEvidenceStore.clear();
  for (const c of [...shortlist, ...weak, ...rejected]) {
    const candidateId = c.mint ? `mint_${c.mint}` : `name_${(c.name || 'token').toLowerCase()}`;
    cachedEvidenceStore.set(candidateId, {
      candidateId,
      sourceName: c.source || 'Public Feed',
      sourceUrl: c.sourceUrl || null,
      sourceType: c.evidenceType || 'public_announcement',
      discoveredAt: new Date(c.evidenceTimestamp || nowMs).toISOString(),
      projectName: c.name,
      symbol: c.symbol,
      mintAddress: c.mint || 'UNKNOWN',
      expectedLaunchDate: c.expectedLaunchDate || 'UNKNOWN',
      expectedLaunchTime: c.expectedLaunchTime || 'UNKNOWN',
      timezone: c.timezone || timezone,
      evidenceType: c.evidenceType || 'public_announcement',
      confidence: c.confidence,
      rawEvidenceSummary: c.conflictReason || `Discovered candidate from ${c.source}`,
      allSources: c.allSources || []
    });
  }

  // Hand off clean candidates to Phase 9 processPreLaunchCandidates
  const phase9Formatted = shortlist.map(c => ({
    name: c.name,
    symbol: c.symbol,
    chain: c.chain || 'solana',
    contractAddress: c.mint || 'UNKNOWN',
    expectedLaunchDate: c.expectedLaunchDate,
    expectedLaunchTime: c.expectedLaunchTime || 'UNKNOWN',
    platform: c.launchPlatform || 'solana_launchpad',
    websiteUrl: c.sourceUrl || 'UNKNOWN',
    socialLinks: c.sourceUrl ? [c.sourceUrl] : [],
    creatorInfo: 'UNKNOWN',
    expectedLiquidityUsd: null,
    tokenomics: 'UNKNOWN'
  }));

  const processedShortlist = processPreLaunchCandidates(phase9Formatted);

  cachedScheduledCandidates = processedShortlist;
  cachedLiveCandidates = liveRawCandidates;

  // Determine Overall Status
  let overallStatus = LAUNCH_INTELLIGENCE_STATUS.VERIFIED_TOMORROW;
  let message = `Successfully verified ${shortlist.length} launch opportunity(s) for TOMORROW (${tomorrowDateStr}).`;

  if (successfulFutureSources === 0) {
    overallStatus = 'NO_RELIABLE_SOURCE_DATA';
    message = 'All future launch data sources are currently unavailable or unconfigured.';
  } else if (shortlist.length === 0) {
    overallStatus = LAUNCH_INTELLIGENCE_STATUS.NO_VERIFIED_TOMORROW_DATA;
    message = `Checked ${successfulFutureSources} public source(s) for target date ${tomorrowDateStr}. Zero verified tomorrow launches were found.`;
  }

  intelligenceState = {
    lastRunTime: new Date(nowMs).toISOString(),
    targetDate: tomorrowDateStr,
    timezone,
    scheduledCount: deduplicatedScheduled.length,
    liveCount: liveRawCandidates.length,
    confirmedCount,
    expectedCount,
    weakCount: weak.length,
    rejectedCount: rejected.length,
    overallStatus,
    message
  };

  return {
    status: intelligenceState,
    targetDate: tomorrowDateStr,
    scheduledCandidates: processedShortlist,
    liveCandidates: liveRawCandidates,
    sources: sourcesHealth,
    evidenceReport: {
      confirmed: shortlist.filter(c => c.confidence === CONFIDENCE_LEVELS.CONFIRMED),
      expected: shortlist.filter(c => c.confidence === CONFIDENCE_LEVELS.EXPECTED),
      weak,
      rejected
    },
    overallStatus,
    message
  };
}

// ============================================================================
// GETTERS FOR API ENDPOINTS
// ============================================================================

export function getLaunchIntelligenceStatus() {
  return { ...intelligenceState };
}

export function getLaunchIntelligenceCandidates() {
  return {
    scheduled: [...cachedScheduledCandidates],
    live: [...cachedLiveCandidates]
  };
}

export function getLaunchIntelligenceSources() {
  return { sources: { ...cachedSourcesHealth } };
}

export function getLaunchIntelligenceEvidence(candidateId) {
  if (!candidateId) return null;
  const match = cachedEvidenceStore.get(candidateId);
  if (match) return { ...match };

  // Case-insensitive search fallback
  for (const [key, item] of cachedEvidenceStore.entries()) {
    if (key.toLowerCase() === candidateId.toLowerCase() || (item.mintAddress && item.mintAddress.toLowerCase() === candidateId.toLowerCase())) {
      return { ...item };
    }
  }

  return null;
}
