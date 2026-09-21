// ============================================================================
// LAUNCH ANNOUNCEMENT DISCOVERY ENGINE (src/launchAnnouncementDiscovery.js)
// Phase 10A — Real Upcoming Launch Announcement Discovery
// Purpose: Continuous discovery, verification, tiering, parsing, and ranking
//          of real public upcoming Solana token launch announcements.
// Mode: REAL MARKET DATA + PAPER TRADING ONLY (Zero Web3 signing, zero wallets, zero real trades)
// ============================================================================

import { config } from './config.js';
import { calculateTomorrowTargetDate, classifyLaunchDate, formatDateInTimezone } from './calendarEngine.js';
import { 
  normalizeCandidate, 
  mergeAndDeduplicateCandidates, 
  auditCandidateStaleness, 
  filterTomorrowShortlist,
  CONFIDENCE_LEVELS,
  CANDIDATE_STATUS 
} from './evidenceModel.js';
import { processPreLaunchCandidates } from './preLaunchEngine.js';
import { MetaplexGenesisAdapter } from './sources/metaplexGenesisAdapter.js';
import { LaunchpadMemeAdapter } from './sources/launchpadMemeAdapter.js';

import {
  ANNOUNCEMENT_SOURCE_TIERS,
  ANNOUNCEMENT_CATEGORY,
  ANNOUNCEMENT_STATUS,
  SourceAdapter
} from './sources/baseAdapter.js';

export {
  ANNOUNCEMENT_SOURCE_TIERS,
  ANNOUNCEMENT_CATEGORY,
  ANNOUNCEMENT_STATUS,
  SourceAdapter
};

// Central Source Adapters Registry
export const REGISTERED_SOURCE_ADAPTERS = [
  new MetaplexGenesisAdapter(),
  new SourceAdapter({
    id: 'solana_launchpad_announcements',
    name: 'Solana Launchpad Official Announcement Calendar',
    url: process.env.SOLANA_LAUNCH_CALENDAR_URL || null,
    tier: ANNOUNCEMENT_SOURCE_TIERS.TIER_1,
    type: 'official_launch_calendar',
    officialOrAggregator: 'official',
    providesFutureDate: true,
    rateLimitMs: 2000,
    timeoutMs: 8000
  }),
  new SourceAdapter({
    id: 'dexscreener_token_announcements',
    name: 'DexScreener Token Profiles Announcement Feed',
    url: 'https://api.dexscreener.com/token-profiles/latest/v1',
    tier: ANNOUNCEMENT_SOURCE_TIERS.TIER_3,
    type: 'public_token_profiles',
    officialOrAggregator: 'aggregator',
    providesFutureDate: true,
    rateLimitMs: 1000,
    timeoutMs: 8000
  }),
  new SourceAdapter({
    id: 'solana_ecosystem_announcements',
    name: 'Solana Ecosystem Project Feed',
    url: process.env.SOLANA_ECOSYSTEM_FEED_URL || null,
    tier: ANNOUNCEMENT_SOURCE_TIERS.TIER_3,
    type: 'ecosystem_announcements',
    officialOrAggregator: 'aggregator',
    providesFutureDate: true,
    rateLimitMs: 2000,
    timeoutMs: 8000
  }),
  new LaunchpadMemeAdapter(),
  new SourceAdapter({
    id: 'pumpfun_live_announcements',
    name: 'Pump.fun Live Tokens Feed',
    url: 'https://frontend-api.pump.fun/coins/latest',
    tier: ANNOUNCEMENT_SOURCE_TIERS.TIER_4,
    type: 'live_launchpad_feed',
    officialOrAggregator: 'aggregator',
    providesFutureDate: false,
    rateLimitMs: 2000,
    timeoutMs: 8000
  }),
  new SourceAdapter({
    id: 'moonshot_live_announcements',
    name: 'Moonshot Live Tokens Feed',
    url: 'https://api.moonshot.cc/v1/tokens/latest',
    tier: ANNOUNCEMENT_SOURCE_TIERS.TIER_4,
    type: 'live_market_feed',
    officialOrAggregator: 'aggregator',
    providesFutureDate: false,
    rateLimitMs: 2000,
    timeoutMs: 8000
  })
];

// ============================================================================
// TEXT & DATE EXTRACTION PARSER
// ============================================================================

const MONTH_NAMES = {
  january: '01', feb: '02', february: '02', mar: '03', march: '03',
  apr: '04', april: '04', may: '05', jun: '06', june: '06',
  jul: '07', july: '07', aug: '08', august: '08', sep: '09',
  september: '09', oct: '10', october: '10', nov: '11', november: '11',
  dec: '12', december: '12'
};

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Parses raw announcement text or structured fields to extract explicit launch date, time, and timezone.
 * Enforces strict semantic rules:
 * Rejects terms like "new token", "latest token", "trending", "boosted", "token created" from being classified as future scheduled launches!
 * 
 * @param {string} text 
 * @param {number} [sourceTimestampMs] 
 * @param {string} [sourceTimezone] 
 * @returns {{
 *   expectedLaunchDate: string|null,
 *   expectedLaunchTime: string|null,
 *   timezone: string,
 *   isExplicitAnnouncement: boolean,
 *   parsedConfidence: string,
 *   rawEvidenceText: string
 * }}
 */
export function parseAnnouncementText(text, sourceTimestampMs = Date.now(), sourceTimezone = null) {
  if (!text || typeof text !== 'string') {
    return {
      expectedLaunchDate: null,
      expectedLaunchTime: null,
      timezone: 'UNKNOWN',
      isExplicitAnnouncement: false,
      parsedConfidence: CONFIDENCE_LEVELS.UNKNOWN,
      rawEvidenceText: ''
    };
  }

  const cleanText = text.trim();

  // 1. REJECTION RULE: Generic live/recent status markers are NOT future launch dates!
  const liveOnlyPattern = /\b(new token|latest token|recent token|trending token|new profile|token created|token launched|live|graduating|bonding curve active)\b/i;
  const explicitFutureIntentPattern = /\b(launch date|launch time|scheduled launch|public sale|presale|launching on|launches on|launching tomorrow|official launch)\b/i;

  if (liveOnlyPattern.test(cleanText) && !explicitFutureIntentPattern.test(cleanText)) {
    return {
      expectedLaunchDate: null,
      expectedLaunchTime: null,
      timezone: 'UNKNOWN',
      isExplicitAnnouncement: false,
      parsedConfidence: CONFIDENCE_LEVELS.UNKNOWN,
      rawEvidenceText: cleanText.slice(0, 150)
    };
  }

  let expectedLaunchDate = null;
  let expectedLaunchTime = null;
  let timezone = sourceTimezone || 'UNKNOWN';
  let isExplicitAnnouncement = false;
  let parsedConfidence = CONFIDENCE_LEVELS.WEAK;

  // Pattern A: Standard YYYY-MM-DD
  const ymdMatch = cleanText.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (ymdMatch) {
    expectedLaunchDate = ymdMatch[0];
    isExplicitAnnouncement = true;
  }

  // Pattern B: Month DD, YYYY or DD Month YYYY (e.g. September 15, 2026 or 15 September 2026)
  if (!expectedLaunchDate) {
    const monthFirstMatch = cleanText.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?\b/i);
    const dayFirstMatch = !monthFirstMatch ? cleanText.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec),?\s*(\d{4})?\b/i) : null;

    if (monthFirstMatch) {
      const monthStr = MONTH_NAMES[monthFirstMatch[1].toLowerCase()];
      const dayStr = String(monthFirstMatch[2]).padStart(2, '0');
      const currentYear = new Date(sourceTimestampMs).getUTCFullYear();
      const yearStr = monthFirstMatch[3] || String(currentYear);
      if (monthStr) {
        expectedLaunchDate = `${yearStr}-${monthStr}-${dayStr}`;
        isExplicitAnnouncement = true;
      }
    } else if (dayFirstMatch) {
      const dayStr = String(dayFirstMatch[1]).padStart(2, '0');
      const monthStr = MONTH_NAMES[dayFirstMatch[2].toLowerCase()];
      const currentYear = new Date(sourceTimestampMs).getUTCFullYear();
      const yearStr = dayFirstMatch[3] || String(currentYear);
      if (monthStr) {
        expectedLaunchDate = `${yearStr}-${monthStr}-${dayStr}`;
        isExplicitAnnouncement = true;
      }
    }
  }

  // Pattern C: MM/DD/YYYY
  if (!expectedLaunchDate) {
    const mdyMatch = cleanText.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
    if (mdyMatch) {
      const monthStr = String(mdyMatch[1]).padStart(2, '0');
      const dayStr = String(mdyMatch[2]).padStart(2, '0');
      const yearStr = mdyMatch[3];
      expectedLaunchDate = `${yearStr}-${monthStr}-${dayStr}`;
      isExplicitAnnouncement = true;
    }
  }

  // Pattern D: Relative Dates ("tomorrow", "next tuesday", "this friday")
  if (!expectedLaunchDate) {
    const sourceDate = new Date(sourceTimestampMs);
    const tzForCalc = timezone !== 'UNKNOWN' ? timezone : 'UTC';

    if (/\btomorrow\b/i.test(cleanText)) {
      const tomorrowObj = new Date(sourceDate.getTime() + 24 * 60 * 60 * 1000);
      expectedLaunchDate = formatDateInTimezone(tomorrowObj, tzForCalc);
      isExplicitAnnouncement = true;
      if (timezone === 'UNKNOWN') {
        parsedConfidence = CONFIDENCE_LEVELS.WEAK; // Downgrade relative date without timezone
      }
    } else {
      const weekdayMatch = cleanText.match(/\b(?:next|this)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i);
      if (weekdayMatch) {
        const targetDayIdx = DAY_NAMES.indexOf(weekdayMatch[1].toLowerCase());
        if (targetDayIdx !== -1) {
          const currentDayIdx = sourceDate.getUTCDay();
          let daysToAdd = (targetDayIdx - currentDayIdx + 7) % 7;
          if (daysToAdd === 0) daysToAdd = 7;
          const targetObj = new Date(sourceDate.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
          expectedLaunchDate = formatDateInTimezone(targetObj, tzForCalc);
          isExplicitAnnouncement = true;
        }
      }
    }
  }

  // Time Extraction: Matches "14:00 UTC", "2:00 PM UTC", "14:00", "2 PM UTC", "2:30 PM"
  let textForTime = cleanText;
  if (expectedLaunchDate) {
    textForTime = textForTime.replace(expectedLaunchDate, '');
  }

  const colonTimeMatch = textForTime.match(/\b([01]?\d|2[0-3]):([0-5]\d)(?:\s*(am|pm))?(?:\s*(utc|est|pst|gmt|cet))?\b/i);
  const ampmTimeMatch = !colonTimeMatch ? textForTime.match(/\b([1-9]|1[0-2])\s*(am|pm)(?:\s*(utc|est|pst|gmt|cet))?\b/i) : null;

  if (colonTimeMatch && expectedLaunchDate) {
    let hours = parseInt(colonTimeMatch[1], 10);
    const minutes = colonTimeMatch[2];
    const ampm = colonTimeMatch[3] ? colonTimeMatch[3].toLowerCase() : null;
    const tzStr = colonTimeMatch[4] ? colonTimeMatch[4].toUpperCase() : null;

    if (ampm === 'pm' && hours < 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;

    expectedLaunchTime = `${String(hours).padStart(2, '0')}:${minutes}`;
    if (tzStr) timezone = tzStr;
  } else if (ampmTimeMatch && expectedLaunchDate) {
    let hours = parseInt(ampmTimeMatch[1], 10);
    const minutes = '00';
    const ampm = ampmTimeMatch[2] ? ampmTimeMatch[2].toLowerCase() : null;
    const tzStr = ampmTimeMatch[3] ? ampmTimeMatch[3].toUpperCase() : null;

    if (ampm === 'pm' && hours < 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;

    expectedLaunchTime = `${String(hours).padStart(2, '0')}:${minutes}`;
    if (tzStr) timezone = tzStr;
  }

  if (isExplicitAnnouncement && expectedLaunchDate) {
    parsedConfidence = timezone !== 'UNKNOWN' ? CONFIDENCE_LEVELS.EXPECTED : CONFIDENCE_LEVELS.WEAK;
  }

  return {
    expectedLaunchDate,
    expectedLaunchTime,
    timezone,
    isExplicitAnnouncement,
    parsedConfidence,
    rawEvidenceText: cleanText.slice(0, 200)
  };
}

// ============================================================================
// IN-MEMORY RUNTIME STATE & CACHING
// ============================================================================

let discoveryRuntimeState = {
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
  message: 'Launch Announcement Discovery engine has not executed yet.'
};

let cachedSourcesHealth = {};
let cachedScheduledAnnouncements = [];
let cachedLiveAnnouncements = [];
let cachedEvidenceStore = new Map();

// ============================================================================
// MAIN ANNOUNCEMENT DISCOVERY ENGINE ORCHESTRATOR
// ============================================================================

/**
 * Executes Launch Announcement Discovery across all registered source adapters.
 * 
 * @param {Object} [options]
 * @param {number} [options.nowMs]
 * @param {string} [options.timezone]
 * @param {boolean} [options.bypassCache]
 * @returns {Promise<Object>} Launch Announcement Discovery Report
 */
export async function runLaunchAnnouncementDiscovery(options = {}) {
  const nowMs = options.nowMs || Date.now();
  const timezone = options.timezone || config.prelaunchTimezone || 'UTC';
  const bypassCache = Boolean(options.bypassCache);

  const { todayDateStr, tomorrowDateStr } = calculateTomorrowTargetDate(nowMs, timezone);

  const sourcesHealth = {};
  const scheduledRawAnnouncements = [];
  const liveRawAnnouncements = [];

  let successfulFutureSources = 0;
  let totalFutureSources = REGISTERED_SOURCE_ADAPTERS.filter(a => a.providesFutureDate).length;

  for (const adapter of REGISTERED_SOURCE_ADAPTERS) {
    const res = await adapter.executeFetch(bypassCache);

    sourcesHealth[adapter.id] = {
      sourceId: adapter.id,
      sourceName: adapter.name,
      sourceTier: adapter.tier,
      officialOrAggregator: adapter.officialOrAggregator,
      providesFutureDate: adapter.providesFutureDate,
      status: res.status,
      error: res.error,
      itemsCount: Array.isArray(res.candidates) ? res.candidates.length : (Array.isArray(res.items) ? res.items.length : 0),
      lastCheckedAt: res.lastCheckedAt
    };

    if (res.status !== 'OK') {
      continue;
    }

    if (adapter.providesFutureDate) {
      successfulFutureSources++;
    }

    if (Array.isArray(res.candidates)) {
      for (const cand of res.candidates) {
        if (cand.category === ANNOUNCEMENT_CATEGORY.LIVE_DETECTED) {
          liveRawAnnouncements.push(cand);
        } else if (cand.category === ANNOUNCEMENT_CATEGORY.SCHEDULED_FUTURE) {
          scheduledRawAnnouncements.push(cand);
        }
      }
      continue;
    }

    if (!Array.isArray(res.items)) {
      continue;
    }

    for (const item of res.items) {
      if (!item) continue;

      // Extract description or announcement content
      const text = item.description || item.announcement || item.title || item.name || '';
      const parsedText = parseAnnouncementText(text, nowMs, timezone);

      const expectedLaunchDate = item.expectedLaunchDate || item.launchDate || parsedText.expectedLaunchDate || null;
      const expectedLaunchTime = item.expectedLaunchTime || item.launchTime || parsedText.expectedLaunchTime || null;
      const itemTimezone = item.timezone || parsedText.timezone || timezone;

      const mintAddress = item.mint || item.contractAddress || item.tokenAddress || item.address || null;
      const projectName = item.name || item.title || (mintAddress ? `Solana Token ${mintAddress.slice(0, 6)}` : 'Upcoming Project');
      const symbol = (item.symbol || 'UPCOMING').toUpperCase();

      if (!adapter.providesFutureDate || (!expectedLaunchDate && (item.chainId === 'solana' || !item.chainId))) {
        // Classify live launch tokens
        liveRawAnnouncements.push({
          category: ANNOUNCEMENT_CATEGORY.LIVE_DETECTED,
          projectName,
          symbol,
          mintAddress,
          expectedLaunchDate: null,
          expectedLaunchTime: null,
          timezone: 'UTC',
          launchpad: item.platform || 'solana_launchpad',
          sourceName: adapter.name,
          sourceUrl: item.url || adapter.url,
          sourceTier: adapter.tier,
          evidenceType: 'live_launch_feed',
          rawEvidenceSummary: 'Token detected from live feed. Token is ALREADY LIVE.',
          status: ANNOUNCEMENT_STATUS.LIVE_ALREADY_DETECTED,
          discoveredAt: new Date(nowMs).toISOString(),
          confidence: CONFIDENCE_LEVELS.UNKNOWN
        });
        continue;
      }

      if (!expectedLaunchDate) {
        continue; // Strictly skip items lacking explicit future launch date evidence
      }

      const classification = classifyLaunchDate(expectedLaunchDate, tomorrowDateStr, todayDateStr, itemTimezone);

      // Determine candidate confidence based on tier & explicit evidence
      let confidence = parsedText.parsedConfidence;
      if (adapter.tier <= ANNOUNCEMENT_SOURCE_TIERS.TIER_2) {
        confidence = CONFIDENCE_LEVELS.EXPECTED;
      }

      scheduledRawAnnouncements.push({
        category: ANNOUNCEMENT_CATEGORY.SCHEDULED_FUTURE,
        projectName,
        symbol,
        mintAddress,
        expectedLaunchDate,
        expectedLaunchTime,
        timezone: itemTimezone,
        launchpad: item.platform || 'solana_launchpad',
        sourceName: adapter.name,
        sourceUrl: item.url || adapter.url,
        sourceTier: adapter.tier,
        evidenceType: 'announcement_feed',
        rawEvidenceSummary: parsedText.rawEvidenceText || `Discovered upcoming launch announcement on ${adapter.name}`,
        discoveredAt: new Date(nowMs).toISOString(),
        confidence,
        timingStatus: classification.status,
        isOfficialAnnouncement: adapter.officialOrAggregator === 'official'
      });
    }
  }

  cachedSourcesHealth = sourcesHealth;

  // Deduplicate Scheduled Announcements
  const deduplicatedScheduled = mergeAndDeduplicateCandidates(scheduledRawAnnouncements.map(c => ({
    ...c,
    name: c.projectName,
    symbol: c.symbol,
    mint: c.mintAddress,
    platform: c.launchpad,
    source: c.sourceName,
    sourceUrl: c.sourceUrl,
    evidenceType: c.evidenceType
  })));

  // Audit Staleness against Target Tomorrow Date
  const auditedScheduled = auditCandidateStaleness(deduplicatedScheduled, tomorrowDateStr);

  // Filter Tomorrow Shortlist (Strict TOMORROW date + CONFIRMED/EXPECTED confidence)
  const { shortlist, rejected, weak } = filterTomorrowShortlist(auditedScheduled, tomorrowDateStr);

  const confirmedCount = shortlist.filter(c => c.confidence === CONFIDENCE_LEVELS.CONFIRMED).length;
  const expectedCount = shortlist.filter(c => c.confidence === CONFIDENCE_LEVELS.EXPECTED).length;

  // Cache Evidence Store for API lookup
  cachedEvidenceStore.clear();
  for (const c of [...shortlist, ...weak, ...rejected]) {
    const candidateId = c.mint ? `mint_${c.mint}` : `name_${(c.name || 'token').toLowerCase()}`;
    cachedEvidenceStore.set(candidateId, {
      candidateId,
      projectName: c.name,
      symbol: c.symbol,
      mintAddress: c.mint || 'UNKNOWN',
      expectedLaunchDate: c.expectedLaunchDate || 'UNKNOWN',
      expectedLaunchTime: c.expectedLaunchTime || 'UNKNOWN',
      timezone: c.timezone || timezone,
      launchpad: c.launchPlatform || 'solana_launchpad',
      sourceName: c.source || 'Public Feed',
      sourceUrl: c.sourceUrl || null,
      sourceTier: c.sourceTier || ANNOUNCEMENT_SOURCE_TIERS.TIER_3,
      evidenceType: c.evidenceType || 'announcement_feed',
      rawEvidenceSummary: c.conflictReason || `Discovered launch announcement from ${c.source}`,
      discoveredAt: new Date(c.evidenceTimestamp || nowMs).toISOString(),
      confidence: c.confidence,
      status: c.status,
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

  cachedScheduledAnnouncements = processedShortlist;
  cachedLiveAnnouncements = liveRawAnnouncements;

  // Determine Overall Engine Status
  let overallStatus = ANNOUNCEMENT_STATUS.VERIFIED_TOMORROW;
  let message = `Successfully verified ${shortlist.length} upcoming launch announcement(s) for TOMORROW (${tomorrowDateStr}).`;

  if (successfulFutureSources === 0) {
    overallStatus = 'NO_RELIABLE_SOURCE_DATA';
    message = 'All future launch announcement sources are currently unavailable or unconfigured.';
  } else if (shortlist.length === 0) {
    overallStatus = ANNOUNCEMENT_STATUS.NO_VERIFIED_TOMORROW_DATA;
    message = `Checked ${successfulFutureSources} public source(s) for target date ${tomorrowDateStr}. Zero verified tomorrow launch announcements were found.`;
  }

  discoveryRuntimeState = {
    lastRunTime: new Date(nowMs).toISOString(),
    targetDate: tomorrowDateStr,
    timezone,
    scheduledCount: deduplicatedScheduled.length,
    liveCount: liveRawAnnouncements.length,
    confirmedCount,
    expectedCount,
    weakCount: weak.length,
    rejectedCount: rejected.length,
    overallStatus,
    message
  };

  return {
    status: discoveryRuntimeState,
    targetDate: tomorrowDateStr,
    scheduledAnnouncements: processedShortlist,
    liveAnnouncements: liveRawAnnouncements,
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
// GETTERS FOR DASHBOARD REST API ENDPOINTS
// ============================================================================

export function getLaunchAnnouncementsStatus() {
  return { ...discoveryRuntimeState };
}

export function getLaunchAnnouncementsCandidates() {
  return {
    scheduled: [...cachedScheduledAnnouncements],
    live: [...cachedLiveAnnouncements]
  };
}

export function getLaunchAnnouncementsSources() {
  return { sources: { ...cachedSourcesHealth } };
}

export function getLaunchAnnouncementsEvidence(candidateId) {
  if (!candidateId) return null;
  const match = cachedEvidenceStore.get(candidateId);
  if (match) return { ...match };

  for (const [key, item] of cachedEvidenceStore.entries()) {
    if (key.toLowerCase() === candidateId.toLowerCase() || (item.mintAddress && item.mintAddress.toLowerCase() === candidateId.toLowerCase())) {
      return { ...item };
    }
  }

  return null;
}
