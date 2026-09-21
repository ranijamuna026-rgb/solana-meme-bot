// ============================================================================
// BASE SOURCE ADAPTER (src/sources/baseAdapter.js)
// Phase 10B — Base class and enum definitions for Discovery Source Adapters
// Safety: REAL MARKET DATA + PAPER TRADING ONLY (Zero Web3 signing, zero wallets, zero real trades)
// ============================================================================

export const ANNOUNCEMENT_SOURCE_TIERS = Object.freeze({
  TIER_1: 1, // Official launchpad structured announcement page / official launch calendar
  TIER_2: 2, // Reliable launch calendar / aggregator
  TIER_3: 3, // Public project announcement feed / profile
  TIER_4: 4, // General discovery source / live market feed
  TIER_5: 5  // Unverified social claim
});

export const ANNOUNCEMENT_CATEGORY = Object.freeze({
  SCHEDULED_FUTURE: 'scheduledLaunchCandidate',
  LIVE_DETECTED: 'liveLaunchCandidate'
});

export const ANNOUNCEMENT_STATUS = Object.freeze({
  VERIFIED_TOMORROW: 'VERIFIED_TOMORROW',
  POSSIBLE_TOMORROW: 'POSSIBLE_TOMORROW',
  LIVE_ALREADY_DETECTED: 'LIVE_ALREADY_DETECTED',
  FUTURE_FAR: 'FUTURE_FAR',
  PAST: 'PAST',
  UNKNOWN: 'UNKNOWN',
  DATE_CONFLICT: 'DATE_CONFLICT',
  NO_VERIFIED_TOMORROW_DATA: 'NO_VERIFIED_TOMORROW_DATA'
});

export class SourceAdapter {
  constructor(options = {}) {
    this.id = options.id;
    this.name = options.name;
    this.url = options.url || null;
    this.tier = options.tier || ANNOUNCEMENT_SOURCE_TIERS.TIER_4;
    this.type = options.type || 'public_announcement';
    this.officialOrAggregator = options.officialOrAggregator || 'aggregator';
    this.authRequired = Boolean(options.authRequired);
    this.enabled = options.enabled !== false;
    this.rateLimitMs = options.rateLimitMs || 1000;
    this.timeoutMs = options.timeoutMs || 8000;
    this.providesFutureDate = Boolean(options.providesFutureDate);
    this.customFetch = options.fetchFn || null;
  }

  async executeFetch(bypassCache = false, options = {}) {
    if (typeof this.fetchAndNormalize === 'function') {
      return await this.fetchAndNormalize(bypassCache, options);
    }

    const now = new Date().toISOString();

    if (!this.enabled) {
      return { status: 'DISABLED', error: 'Source adapter disabled', items: [], lastCheckedAt: now };
    }

    if (this.authRequired && !this.url) {
      return { status: 'AUTH_REQUIRED', error: 'Authentication or URL credentials required', items: [], lastCheckedAt: now };
    }

    if (!this.url) {
      return { status: 'UNCONFIGURED', error: 'Source URL not configured', items: [], lastCheckedAt: now };
    }

    try {
      if (this.customFetch) {
        return await this.customFetch(this, bypassCache);
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch(this.url, {
        headers: { 'Accept': 'application/json' },
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (response.status === 429) {
        return { status: 'SOURCE_RATE_LIMITED', error: 'HTTP 429 Rate Limited', items: [], lastCheckedAt: now };
      }

      if (response.status === 403) {
        return { status: 'SOURCE_BLOCKED', error: 'HTTP 403 Access Blocked / Cloudflare', items: [], lastCheckedAt: now };
      }

      if (!response.ok) {
        return { status: 'SOURCE_UNAVAILABLE', error: `HTTP ${response.status} ${response.statusText}`, items: [], lastCheckedAt: now };
      }

      const data = await response.json();
      if (!data) {
        return { status: 'SOURCE_INVALID_DATA', error: 'Empty/null payload', items: [], lastCheckedAt: now };
      }

      return { status: 'OK', error: null, items: data, lastCheckedAt: now };

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

      return { status, error: errorMsg, items: [], lastCheckedAt: now };
    }
  }
}
