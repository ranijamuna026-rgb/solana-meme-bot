// ============================================================================
// UPCOMING DISCOVERY ENGINE (src/upcomingDiscovery.js)
// Phase 9.2 — Real Tomorrow Launch Discovery Engine
// Queries legitimate public Solana launch sources, classifies feeds,
// enforces data honesty, and aggregates future-launch candidates.
// ============================================================================

import { config } from './config.js';
import { calculateTomorrowTargetDate, classifyLaunchDate } from './calendarEngine.js';

export const SOURCE_CATEGORIES = {
  FUTURE_LAUNCH_SOURCE: 'FUTURE_LAUNCH_SOURCE',
  LIVE_LAUNCH_SOURCE: 'LIVE_LAUNCH_SOURCE',
  MARKET_DATA_SOURCE: 'MARKET_DATA_SOURCE',
  SOCIAL_ANNOUNCEMENT_SOURCE: 'SOCIAL_ANNOUNCEMENT_SOURCE'
};

// Registered Public Discovery Feeds
export const DISCOVERY_SOURCES = [
  {
    id: 'dexscreener_token_profiles',
    name: 'DexScreener Public Token Profiles API',
    url: 'https://api.dexscreener.com/token-profiles/latest/v1',
    category: SOURCE_CATEGORIES.SOCIAL_ANNOUNCEMENT_SOURCE,
    providesFutureDate: true,
    requiresApiKey: false,
    rateLimitMs: 1000,
    reliability: 'MEDIUM',
    termsCompliant: true
  },
  {
    id: 'solana_launchpad_calendar',
    name: 'Solana Ecosystem Launchpad Calendar',
    url: process.env.SOLANA_LAUNCH_CALENDAR_URL || null,
    category: SOURCE_CATEGORIES.FUTURE_LAUNCH_SOURCE,
    providesFutureDate: true,
    requiresApiKey: false,
    rateLimitMs: 2000,
    reliability: 'HIGH',
    termsCompliant: true
  }
];

/**
 * Fetches token profile announcements from DexScreener Public API.
 * Classifies items and extracts explicit future launch dates if present.
 * 
 * @param {string} targetTomorrowStr 
 * @param {string} targetTodayStr 
 * @param {string} timezone 
 * @returns {Promise<{ candidates: Array<Object>, error: string|null }>}
 */
async function fetchDexScreenerTokenProfiles(targetTomorrowStr, targetTodayStr, timezone) {
  const sourceObj = DISCOVERY_SOURCES.find(s => s.id === 'dexscreener_token_profiles');
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(sourceObj.url, {
      headers: { 'Accept': 'application/json' },
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return { candidates: [], error: `HTTP ${response.status} ${response.statusText}` };
    }

    const data = await response.json();
    if (!Array.isArray(data)) {
      return { candidates: [], error: 'Invalid response format: expected array' };
    }

    const candidates = [];

    for (const item of data) {
      if (!item || item.chainId !== 'solana') continue;

      // Extract optional description or social announcement date markers if provided
      const description = item.description || '';
      let expectedLaunchDate = null;
      let expectedLaunchTime = null;
      let isOfficialAnnouncement = false;

      // Inspect description for explicit future date mentions (e.g. "Launch date: YYYY-MM-DD" or ISO)
      const dateMatch = description.match(/launch\s*(?:date)?\s*[:=]?\s*(\d{4}-\d{2}-\d{2})/i);
      if (dateMatch) {
        expectedLaunchDate = dateMatch[1];
        isOfficialAnnouncement = true;
      }

      // Check if candidate explicitly provides expectedLaunchDate field
      if (item.expectedLaunchDate) {
        expectedLaunchDate = item.expectedLaunchDate;
      }

      // DATA-HONESTY RULE: A token that has already launched or lacks future date evidence is NOT a tomorrow candidate.
      if (!expectedLaunchDate) {
        continue; // Skip items without explicit future launch date evidence
      }

      // Classify the launch date against target tomorrow
      const classification = classifyLaunchDate(expectedLaunchDate, targetTomorrowStr, targetTodayStr, timezone);
      if (classification.status !== 'TOMORROW') {
        continue; // Exclude today, past, or invalid date items
      }

      candidates.push({
        name: item.tokenAddress ? `Token ${item.tokenAddress.slice(0, 6)}` : 'Solana Project',
        symbol: item.url ? item.url.split('/').pop().toUpperCase() : 'MEME',
        chain: 'solana',
        mint: item.tokenAddress || null,
        expectedLaunchDate,
        expectedLaunchTime,
        timezone,
        launchPlatform: 'dexscreener_profile',
        source: sourceObj.id,
        sourceUrl: item.url || sourceObj.url,
        evidenceType: 'public_token_profile',
        evidenceDescription: `Token profile on DexScreener with launch date ${expectedLaunchDate}`,
        hasFutureTimestamp: true,
        isOfficialAnnouncement,
        confidence: isOfficialAnnouncement ? 'EXPECTED' : 'WEAK'
      });
    }

    return { candidates, error: null };
  } catch (err) {
    return { candidates: [], error: err.name === 'AbortError' ? 'Request timeout (8000ms)' : err.message };
  }
}

/**
 * Fetches from a configured Solana Launchpad Calendar public feed (if available).
 * 
 * @param {string} targetTomorrowStr 
 * @param {string} targetTodayStr 
 * @param {string} timezone 
 * @returns {Promise<{ candidates: Array<Object>, error: string|null }>}
 */
async function fetchSolanaLaunchCalendar(targetTomorrowStr, targetTodayStr, timezone) {
  const sourceObj = DISCOVERY_SOURCES.find(s => s.id === 'solana_launchpad_calendar');
  if (!sourceObj.url) {
    // Return empty candidates cleanly when no external calendar feed URL is configured
    return { candidates: [], error: 'Feed URL not configured' };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(sourceObj.url, {
      headers: { 'Accept': 'application/json' },
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return { candidates: [], error: `HTTP ${response.status} ${response.statusText}` };
    }

    const data = await response.json();
    const rawItems = Array.isArray(data) ? data : (data.launches || data.candidates || []);

    const candidates = [];
    for (const item of rawItems) {
      if (!item || (item.chain && item.chain.toLowerCase() !== 'solana')) continue;

      const dateStr = item.expectedLaunchDate || item.launchDate || null;
      if (!dateStr) continue;

      const classification = classifyLaunchDate(dateStr, targetTomorrowStr, targetTodayStr, timezone);
      if (classification.status !== 'TOMORROW') continue;

      candidates.push({
        name: item.name || item.title || 'Upcoming Solana Meme',
        symbol: item.symbol || 'UPCOMING',
        chain: 'solana',
        mint: item.mint || item.contract || null,
        expectedLaunchDate: dateStr,
        expectedLaunchTime: item.launchTime || item.time || null,
        timezone,
        launchPlatform: item.platform || 'solana_launchpad',
        source: sourceObj.id,
        sourceUrl: item.url || sourceObj.url,
        evidenceType: 'official_launch_calendar',
        evidenceDescription: `Listed on Solana Launch Calendar for ${dateStr}`,
        hasFutureTimestamp: true,
        isOfficialAnnouncement: true,
        confidence: 'CONFIRMED'
      });
    }

    return { candidates, error: null };
  } catch (err) {
    return { candidates: [], error: err.name === 'AbortError' ? 'Request timeout (8000ms)' : err.message };
  }
}

/**
 * Aggregates all public discovery feeds and returns aggregated raw candidates
 * along with individual source health reports.
 * 
 * @param {number} [nowMs] 
 * @param {string} [tzInput] 
 * @returns {Promise<{
 *   targetTomorrowStr: string,
 *   targetTodayStr: string,
 *   timezone: string,
 *   rawCandidates: Array<Object>,
 *   sourceHealth: Object,
 *   overallStatus: string
 * }>}
 */
export async function discoverUpcomingSolanaLaunches(nowMs = Date.now(), tzInput = null) {
  const { todayDateStr, tomorrowDateStr, timezone } = calculateTomorrowTargetDate(nowMs, tzInput);

  const sourceHealth = {};
  const rawCandidates = [];
  let successfulSourcesCount = 0;
  let totalFutureSourcesCount = DISCOVERY_SOURCES.filter(s => s.providesFutureDate).length;

  // 1. Fetch DexScreener public profile feed
  const dexscreenerRes = await fetchDexScreenerTokenProfiles(tomorrowDateStr, todayDateStr, timezone);
  sourceHealth.dexscreener_token_profiles = {
    sourceId: 'dexscreener_token_profiles',
    name: 'DexScreener Public Token Profiles API',
    category: SOURCE_CATEGORIES.SOCIAL_ANNOUNCEMENT_SOURCE,
    status: dexscreenerRes.error ? 'SOURCE_ERROR' : 'OK',
    error: dexscreenerRes.error,
    candidatesFound: dexscreenerRes.candidates.length,
    lastCheckedAt: new Date().toISOString()
  };
  if (!dexscreenerRes.error) {
    successfulSourcesCount++;
    rawCandidates.push(...dexscreenerRes.candidates);
  }

  // 2. Fetch Solana Launch Calendar feed
  const calendarRes = await fetchSolanaLaunchCalendar(tomorrowDateStr, todayDateStr, timezone);
  sourceHealth.solana_launchpad_calendar = {
    sourceId: 'solana_launchpad_calendar',
    name: 'Solana Ecosystem Launchpad Calendar',
    category: SOURCE_CATEGORIES.FUTURE_LAUNCH_SOURCE,
    status: calendarRes.error ? (calendarRes.error === 'Feed URL not configured' ? 'UNCONFIGURED' : 'SOURCE_ERROR') : 'OK',
    error: calendarRes.error,
    candidatesFound: calendarRes.candidates.length,
    lastCheckedAt: new Date().toISOString()
  };
  if (!calendarRes.error) {
    successfulSourcesCount++;
    rawCandidates.push(...calendarRes.candidates);
  }

  // Determine overall status
  let overallStatus = 'SUCCESS';
  if (successfulSourcesCount === 0) {
    overallStatus = 'NO_RELIABLE_SOURCE_DATA';
  } else if (rawCandidates.length === 0) {
    overallStatus = 'NO_VERIFIED_TOMORROW_DATA';
  }

  return {
    targetTodayStr: todayDateStr,
    targetTomorrowStr: tomorrowDateStr,
    timezone,
    rawCandidates,
    sourceHealth,
    overallStatus
  };
}

export const discoverUpcomingSolanaTokens = discoverUpcomingSolanaLaunches;
