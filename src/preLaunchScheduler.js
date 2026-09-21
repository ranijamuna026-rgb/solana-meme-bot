// ============================================================================
// PRE-LAUNCH SCHEDULER & PIPELINE ORCHESTRATOR (src/preLaunchScheduler.js)
// Phase 9.2 — Real Tomorrow Launch Discovery Engine
// Coordinates automated daily discovery, data honesty filtering, Phase 9 integration,
// and state tracking for pre-launch monitoring endpoints.
// ============================================================================

import { config } from './config.js';
import { discoverUpcomingSolanaLaunches } from './upcomingDiscovery.js';
import { 
  mergeAndDeduplicateCandidates, 
  auditCandidateStaleness, 
  filterTomorrowShortlist,
  CONFIDENCE_LEVELS 
} from './evidenceModel.js';
import { processPreLaunchCandidates, saveTomorrowWatchlist, getTomorrowWatchlist } from './preLaunchEngine.js';
import { runLaunchIntelligence } from './launchIntelligence.js';
import { runLaunchAnnouncementDiscovery } from './launchAnnouncementDiscovery.js';

let discoveryStatusState = {
  lastScanTime: null,
  nextScanTime: null,
  targetDate: null,
  candidatesFound: 0,
  deduplicatedCandidates: 0,
  confirmedCandidates: 0,
  expectedCandidates: 0,
  weakCandidates: 0,
  rejectedCandidates: 0,
  overallStatus: 'NOT_RUN',
  sourceErrors: []
};

let lastSourceHealth = {};
let lastEvidenceReport = {
  confirmed: [],
  expected: [],
  weak: [],
  rejected: []
};

let schedulerIntervalId = null;

/**
 * Runs the full automated daily pre-launch discovery pipeline.
 * 
 * Pipeline Workflow:
 * 1. Calculate Tomorrow target date in PRELAUNCH_TIMEZONE
 * 2. Query configured public feeds (discoverUpcomingSolanaLaunches)
 * 3. Deduplicate and cross-check evidence across sources (mergeAndDeduplicateCandidates)
 * 4. Audit candidate staleness (auditCandidateStaleness)
 * 5. Filter for matching date & confidence (filterTomorrowShortlist)
 * 6. Pass clean candidates to Phase 9 processPreLaunchCandidates pipeline
 * 7. Update tomorrow_watchlist.json and discovery status metrics
 * 
 * @param {Object} [options]
 * @param {number} [options.nowMs]
 * @param {string} [options.timezone]
 * @returns {Promise<Object>} Discovery Summary Report
 */
export async function runDailyTomorrowDiscovery(options = {}) {
  const nowMs = options.nowMs || Date.now();
  const timezone = options.timezone || config.prelaunchTimezone || 'UTC';

  console.log(`[DISCOVERY] Starting daily pre-launch discovery scan (TZ: ${timezone})...`);

  // Run Launch Intelligence scan (Phase 9.3)
  try {
    await runLaunchIntelligence({ nowMs, timezone });
  } catch (err) {
    console.error('[WARN] Launch Intelligence scan error:', err.message);
  }

  // Run Launch Announcement Discovery scan (Phase 10A/10B/10C adapters including Metaplex Genesis)
  let announcementRes = null;
  try {
    announcementRes = await runLaunchAnnouncementDiscovery({ nowMs, timezone, bypassCache: true });
  } catch (err) {
    console.error('[WARN] Launch Announcement Discovery scan error:', err.message);
  }

  // Step 1 & 2: Discover raw candidates from public feeds
  const discoveryResult = await discoverUpcomingSolanaLaunches(nowMs, timezone);
  const { targetTomorrowStr, targetTodayStr, rawCandidates, sourceHealth } = discoveryResult;

  // Combine raw candidates from feeds & announcement adapters
  const combinedRawCandidates = [...rawCandidates];
  if (announcementRes && Array.isArray(announcementRes.scheduledAnnouncements)) {
    for (const ann of announcementRes.scheduledAnnouncements) {
      combinedRawCandidates.push({
        name: ann.name || ann.projectName,
        symbol: ann.symbol,
        chain: ann.chain || 'solana',
        mint: ann.contractAddress !== 'UNKNOWN' ? ann.contractAddress : (ann.mintAddress || null),
        expectedLaunchDate: ann.expectedLaunchDate,
        expectedLaunchTime: ann.expectedLaunchTime || 'UNKNOWN',
        launchPlatform: ann.platform || ann.launchpad || 'solana_launchpad',
        sourceName: ann.sourceName || 'Announcement Feed',
        sourceUrl: ann.websiteUrl || ann.sourceUrl || null,
        sourceTier: ann.sourceTier || 3,
        evidenceType: ann.evidenceType || 'announcement_feed',
        rawEvidenceText: ann.rawEvidenceSummary || 'Discovered launch announcement',
        evidenceTimestamp: nowMs,
        confidence: ann.confidence || CONFIDENCE_LEVELS.EXPECTED
      });
    }
  }

  // Combine source health statuses
  const combinedSourceHealth = {
    ...sourceHealth,
    ...(announcementRes ? announcementRes.sources : {})
  };
  lastSourceHealth = combinedSourceHealth;

  // Extract source errors for reporting
  const sourceErrors = Object.values(combinedSourceHealth)
    .filter(s => s.status === 'SOURCE_ERROR' || s.status === 'SOURCE_UNAVAILABLE')
    .map(s => `${s.name || s.sourceName || s.sourceId}: ${s.error}`);

  // Step 3: Deduplicate & cross-check evidence across sources
  const deduplicated = mergeAndDeduplicateCandidates(combinedRawCandidates);

  // Step 4: Audit staleness against target date
  const audited = auditCandidateStaleness(deduplicated, targetTomorrowStr);

  // Step 5: Filter candidates matching tomorrow date & strict confidence
  const { shortlist, rejected, weak } = filterTomorrowShortlist(audited, targetTomorrowStr);

  const confirmedCount = shortlist.filter(c => c.confidence === CONFIDENCE_LEVELS.CONFIRMED).length;
  const expectedCount = shortlist.filter(c => c.confidence === CONFIDENCE_LEVELS.EXPECTED).length;

  lastEvidenceReport = {
    confirmed: shortlist.filter(c => c.confidence === CONFIDENCE_LEVELS.CONFIRMED),
    expected: shortlist.filter(c => c.confidence === CONFIDENCE_LEVELS.EXPECTED),
    weak,
    rejected
  };

  // Step 6 & 7: Convert clean candidates into Phase 9 format and pass to processPreLaunchCandidates
  let phase9Candidates = shortlist.map(c => ({
    name: c.name,
    symbol: c.symbol,
    chain: c.chain,
    contractAddress: c.mint || 'UNKNOWN',
    expectedLaunchDate: c.expectedLaunchDate,
    expectedLaunchTime: c.expectedLaunchTime || 'UNKNOWN',
    platform: c.launchPlatform,
    websiteUrl: c.sourceUrl || 'UNKNOWN',
    socialLinks: c.sourceUrl ? [c.sourceUrl] : [],
    creatorInfo: 'UNKNOWN',
    expectedLiquidityUsd: null,
    tokenomics: 'UNKNOWN'
  }));

  // Hand off to Phase 9 scoring & persistence engine
  const processedShortlist = processPreLaunchCandidates(phase9Candidates);

  // Determine overall pipeline status
  let overallPipelineStatus = 'NO_VERIFIED_TOMORROW_DATA';
  if (processedShortlist.length > 0) {
    overallPipelineStatus = 'VERIFIED_TOMORROW_DATA';
  } else {
    const totalSources = Object.keys(combinedSourceHealth).length;
    const okSources = Object.values(combinedSourceHealth).filter(s => s.status === 'OK').length;
    if (totalSources > 0 && okSources === 0) {
      overallPipelineStatus = 'NO_RELIABLE_SOURCE_DATA';
    }
  }

  const nextScanDate = new Date(nowMs + 24 * 60 * 60 * 1000);

  discoveryStatusState = {
    lastScanTime: new Date(nowMs).toISOString(),
    nextScanTime: nextScanDate.toISOString(),
    targetDate: targetTomorrowStr,
    candidatesFound: combinedRawCandidates.length,
    deduplicatedCandidates: deduplicated.length,
    confirmedCandidates: confirmedCount,
    expectedCandidates: expectedCount,
    weakCandidates: weak.length,
    rejectedCandidates: rejected.length,
    overallStatus: overallPipelineStatus,
    sourceErrors
  };

  console.log(`[DISCOVERY] Daily discovery complete. Target Date: ${targetTomorrowStr}. Shortlist count: ${processedShortlist.length}. Status: ${overallPipelineStatus}`);

  return {
    discoveryStatus: discoveryStatusState,
    sourceHealth: lastSourceHealth,
    evidenceReport: lastEvidenceReport,
    shortlist: processedShortlist
  };
}

/**
 * Returns current read-only Discovery Status.
 */
export function getDiscoveryStatus() {
  return { ...discoveryStatusState };
}

/**
 * Returns current read-only Source Health Status.
 */
export function getSourcesStatus() {
  return { ...lastSourceHealth };
}

/**
 * Returns current read-only Evidence Report.
 */
export function getEvidenceReport() {
  return { ...lastEvidenceReport };
}

/**
 * Returns current Tomorrow Shortlist.
 */
export function getTomorrowShortlist() {
  return getTomorrowWatchlist();
}

/**
 * Starts the automated daily discovery background scheduler.
 * 
 * @param {number} [intervalMs=86400000] - Interval in ms (default 24 hours)
 */
export function startScheduledDiscoveryJob(intervalMs = 24 * 60 * 60 * 1000) {
  if (schedulerIntervalId) {
    clearInterval(schedulerIntervalId);
  }

  // Trigger initial discovery run immediately
  runDailyTomorrowDiscovery().catch(err => {
    console.error('[ERROR] Initial pre-launch discovery job failed:', err.message);
  });

  schedulerIntervalId = setInterval(() => {
    runDailyTomorrowDiscovery().catch(err => {
      console.error('[ERROR] Scheduled pre-launch discovery job failed:', err.message);
    });
  }, intervalMs);

  console.log(`[SCHEDULER] Background pre-launch discovery job scheduled every ${Math.round(intervalMs / 3600000)}h.`);
}

/**
 * Stops the scheduled background discovery job.
 */
export function stopScheduledDiscoveryJob() {
  if (schedulerIntervalId) {
    clearInterval(schedulerIntervalId);
    schedulerIntervalId = null;
    console.log('[SCHEDULER] Background pre-launch discovery job stopped.');
  }
}
