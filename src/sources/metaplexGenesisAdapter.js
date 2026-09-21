// ============================================================================
// METAPLEX GENESIS ADAPTER (src/sources/metaplexGenesisAdapter.js)
// Phase 10B — Real Future Launch Source Research & Verification
// Purpose: Fetches and normalizes official upcoming launches from Metaplex Genesis API.
// Tier: TIER 1 (Official Solana Launch Source)
// Mode: REAL MARKET DATA + PAPER TRADING ONLY (Zero Web3 signing, zero wallets, zero real trades)
// ============================================================================

import { SourceAdapter, ANNOUNCEMENT_SOURCE_TIERS, ANNOUNCEMENT_CATEGORY, ANNOUNCEMENT_STATUS } from './baseAdapter.js';
import { formatDateInTimezone, classifyLaunchDate, calculateTomorrowTargetDate } from '../calendarEngine.js';
import { CONFIDENCE_LEVELS } from '../evidenceModel.js';

export class MetaplexGenesisAdapter extends SourceAdapter {
  constructor(options = {}) {
    super({
      id: 'metaplex_genesis_launches',
      name: 'Metaplex Genesis Official Launch API',
      url: options.url || 'https://api.metaplex.com/v1/launches',
      tier: ANNOUNCEMENT_SOURCE_TIERS.TIER_1,
      type: 'official_genesis_launch',
      officialOrAggregator: 'official',
      providesFutureDate: true,
      authRequired: false,
      enabled: options.enabled !== false,
      rateLimitMs: options.rateLimitMs || 2000,
      timeoutMs: options.timeoutMs || 8000
    });

    this.upcomingUrl = options.upcomingUrl || 'https://api.metaplex.com/v1/launches?status=upcoming';
  }

  async fetchAndNormalize(bypassCache = false, options = {}) {
    const nowMs = options.nowMs || Date.now();
    const timezone = options.timezone || 'UTC';
    const { todayDateStr, tomorrowDateStr } = calculateTomorrowTargetDate(nowMs, timezone);
    const nowIso = new Date(nowMs).toISOString();

    if (!this.enabled) {
      return { status: 'DISABLED', error: 'Adapter disabled', candidates: [], lastCheckedAt: nowIso };
    }

    try {
      const fetchFn = (url, init) => (typeof this.fetch === 'function' ? this.fetch(url, init) : globalThis.fetch(url, init));

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      // Query upcoming status endpoint first
      let response = await fetchFn(this.upcomingUrl, {
        headers: { 'Accept': 'application/json' },
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (controller.signal.aborted) {
        return { status: 'SOURCE_TIMEOUT', error: `Request timeout (${this.timeoutMs}ms)`, candidates: [], lastCheckedAt: nowIso };
      }

      if (response.status === 429) {
        return { status: 'SOURCE_RATE_LIMITED', error: 'HTTP 429 Rate Limited', candidates: [], lastCheckedAt: nowIso };
      }

      if (response.status === 403) {
        return { status: 'SOURCE_BLOCKED', error: 'HTTP 403 Access Blocked', candidates: [], lastCheckedAt: nowIso };
      }

      if (!response.ok) {
        return { status: 'SOURCE_UNAVAILABLE', error: `HTTP ${response.status} ${response.statusText}`, candidates: [], lastCheckedAt: nowIso };
      }

      let payload = await response.json();
      let rawItems = Array.isArray(payload) ? payload : (payload.data || payload.launches || []);

      // If upcoming query returns empty data, query main launches endpoint to check for future startTimes
      if (rawItems.length === 0) {
        const controller2 = new AbortController();
        const timeout2 = setTimeout(() => controller2.abort(), this.timeoutMs);
        const res2 = await fetchFn(this.url, { headers: { 'Accept': 'application/json' }, signal: controller2.signal });
        clearTimeout(timeout2);

        if (res2.ok) {
          const payload2 = await res2.json();
          rawItems = Array.isArray(payload2) ? payload2 : (payload2.data || payload2.launches || []);
        }
      }

      const candidates = [];

      for (const item of rawItems) {
        if (!item) continue;

        const launch = item.launch || item;
        const baseToken = item.baseToken || item.token || {};
        const status = (launch.status || '').toLowerCase();
        const startTime = launch.startTime || null;

        const mintAddress = baseToken.address || launch.genesisAddress || null;
        const projectName = (baseToken.name || '').trim() || (mintAddress ? `Solana Token ${mintAddress.slice(0, 6)}` : 'Upcoming Metaplex Token');
        const symbol = (baseToken.symbol || 'GENESIS').trim().toUpperCase();
        const sourceUrl = launch.launchPage || item.website || 'https://www.metaplex.com/genesis';

        let expectedLaunchDate = null;
        let expectedLaunchTime = null;

        if (startTime) {
          const startDate = new Date(startTime);
          if (!isNaN(startDate.getTime())) {
            expectedLaunchDate = formatDateInTimezone(startDate, timezone);
            const hrs = String(startDate.getUTCHours()).padStart(2, '0');
            const mins = String(startDate.getUTCMinutes()).padStart(2, '0');
            expectedLaunchTime = `${hrs}:${mins}`;
          }
        }

        const isExplicitNonUpcoming = ['live', 'ended', 'graduated', 'cancelled'].includes(status);
        const isUpcomingStatus = !isExplicitNonUpcoming && (status === 'upcoming' || (startTime && new Date(startTime).getTime() > nowMs));

        if (!isUpcomingStatus) {
          // Classify live/ended/graduated items cleanly
          candidates.push({
            category: ANNOUNCEMENT_CATEGORY.LIVE_DETECTED,
            projectName,
            symbol,
            mintAddress,
            expectedLaunchDate: null,
            expectedLaunchTime: null,
            timezone: 'UTC',
            launchpad: 'metaplex_genesis',
            sourceName: this.name,
            sourceUrl,
            sourceTier: this.tier,
            evidenceType: 'official_genesis_launch',
            rawEvidenceSummary: `Metaplex Genesis token. Launch status is '${status}'.`,
            status: ANNOUNCEMENT_STATUS.LIVE_ALREADY_DETECTED,
            discoveredAt: nowIso,
            confidence: CONFIDENCE_LEVELS.UNKNOWN
          });
          continue;
        }

        if (!expectedLaunchDate) {
          continue; // Skip upcoming items lacking valid launch date
        }

        const classification = classifyLaunchDate(expectedLaunchDate, tomorrowDateStr, todayDateStr, timezone);

        candidates.push({
          category: ANNOUNCEMENT_CATEGORY.SCHEDULED_FUTURE,
          projectName,
          symbol,
          mintAddress,
          expectedLaunchDate,
          expectedLaunchTime,
          timezone,
          launchpad: 'metaplex_genesis',
          sourceName: this.name,
          sourceUrl,
          sourceTier: this.tier,
          evidenceType: 'official_genesis_launch',
          rawEvidenceSummary: `Metaplex Genesis official launch scheduled for ${startTime || expectedLaunchDate}`,
          discoveredAt: nowIso,
          confidence: CONFIDENCE_LEVELS.EXPECTED,
          timingStatus: classification.status,
          isOfficialAnnouncement: true
        });
      }

      return {
        status: 'OK',
        error: null,
        candidates,
        lastCheckedAt: nowIso
      };

    } catch (err) {
      let status = 'SOURCE_UNAVAILABLE';
      let errorMsg = err.message;

      if (err.name === 'AbortError') {
        status = 'SOURCE_TIMEOUT';
        errorMsg = `Request timeout (${this.timeoutMs}ms)`;
      } else if (err.name === 'SyntaxError') {
        status = 'SOURCE_INVALID_DATA';
        errorMsg = 'Malformed JSON payload';
      }

      return { status, error: errorMsg, candidates: [], lastCheckedAt: nowIso };
    }
  }
}
