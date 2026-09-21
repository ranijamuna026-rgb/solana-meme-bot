// ============================================================================
// LAUNCHPAD.MEME ADAPTER (src/sources/launchpadMemeAdapter.js)
// Phase 10B — Real Future Launch Source Research & Verification
// Purpose: Fetches and normalizes live launch items and events from Launchpad.meme.
// Tier: TIER 4 (Live Launchpad Feed)
// Classification: LIVE_LAUNCH_SOURCE (Does NOT predict tomorrow launches)
// Mode: REAL MARKET DATA + PAPER TRADING ONLY (Zero Web3 signing, zero wallets, zero real trades)
// ============================================================================

import { SourceAdapter, ANNOUNCEMENT_SOURCE_TIERS, ANNOUNCEMENT_CATEGORY, ANNOUNCEMENT_STATUS } from './baseAdapter.js';
import { CONFIDENCE_LEVELS } from '../evidenceModel.js';

export class LaunchpadMemeAdapter extends SourceAdapter {
  constructor(options = {}) {
    super({
      id: 'launchpad_meme_feed',
      name: 'Launchpad.meme Public API Feed',
      url: options.url || 'https://launchpad.meme/api/public/tokens/new',
      tier: ANNOUNCEMENT_SOURCE_TIERS.TIER_4,
      type: 'live_launchpad_feed',
      officialOrAggregator: 'aggregator',
      providesFutureDate: false,
      authRequired: false,
      enabled: options.enabled !== false,
      rateLimitMs: options.rateLimitMs || 2000,
      timeoutMs: options.timeoutMs || 8000
    });
  }

  async fetchAndNormalize(bypassCache = false, options = {}) {
    const nowIso = new Date().toISOString();

    if (!this.enabled) {
      return { status: 'DISABLED', error: 'Adapter disabled', candidates: [], lastCheckedAt: nowIso };
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch(this.url, {
        headers: { 'Accept': 'application/json' },
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (response.status === 429) {
        return { status: 'SOURCE_RATE_LIMITED', error: 'HTTP 429 Rate Limited', candidates: [], lastCheckedAt: nowIso };
      }

      if (response.status === 403) {
        return { status: 'SOURCE_BLOCKED', error: 'HTTP 403 Access Blocked', candidates: [], lastCheckedAt: nowIso };
      }

      if (!response.ok) {
        return { status: 'SOURCE_UNAVAILABLE', error: `HTTP ${response.status} ${response.statusText}`, candidates: [], lastCheckedAt: nowIso };
      }

      const payload = await response.json();
      const rawItems = Array.isArray(payload) ? payload : (payload.items || payload.tokens || []);

      const candidates = [];

      for (const item of rawItems) {
        if (!item) continue;

        const mintAddress = item.address || item.token || item.contract || null;
        const projectName = (item.name || '').trim() || (mintAddress ? `Token ${mintAddress.slice(0, 6)}` : 'Launchpad.meme Token');
        const symbol = (item.raw_symbol || item.symbol || 'MEME').replace(/^\$/, '').toUpperCase();
        const chain = (item.chain || 'solana').toLowerCase();

        // Launchpad.meme only reports already live or graduating tokens
        candidates.push({
          category: ANNOUNCEMENT_CATEGORY.LIVE_DETECTED,
          projectName,
          symbol,
          chain,
          mintAddress,
          expectedLaunchDate: null,
          expectedLaunchTime: null,
          timezone: 'UTC',
          launchpad: 'launchpad_meme',
          sourceName: this.name,
          sourceUrl: item.address ? `https://launchpad.meme/token/${item.address}` : this.url,
          sourceTier: this.tier,
          evidenceType: 'live_launchpad_feed',
          rawEvidenceSummary: `Discovered token from Launchpad.meme feed. Status is '${item.status || 'live'}'. Token is ALREADY LIVE.`,
          status: ANNOUNCEMENT_STATUS.LIVE_ALREADY_DETECTED,
          discoveredAt: nowIso,
          confidence: CONFIDENCE_LEVELS.UNKNOWN
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
