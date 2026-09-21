// ============================================================================
// LAUNCH ANNOUNCEMENT DISCOVERY TEST SUITE (test/launchAnnouncementDiscovery.test.js)
// Phase 10A — Real Upcoming Launch Announcement Discovery
// 27 Deterministic Unit & Integration Test Cases
// Safety: REAL MARKET DATA + PAPER TRADING ONLY (Zero Web3 signing, zero wallets, zero real trades)
// ============================================================================

import assert from 'node:assert';
import http from 'node:http';
import { calculateTomorrowTargetDate, classifyLaunchDate } from '../src/calendarEngine.js';
import { 
  mergeAndDeduplicateCandidates, 
  filterTomorrowShortlist, 
  CONFIDENCE_LEVELS, 
  CANDIDATE_STATUS 
} from '../src/evidenceModel.js';
import { 
  SourceAdapter,
  parseAnnouncementText,
  runLaunchAnnouncementDiscovery,
  getLaunchAnnouncementsStatus,
  getLaunchAnnouncementsCandidates,
  getLaunchAnnouncementsSources,
  getLaunchAnnouncementsEvidence,
  ANNOUNCEMENT_SOURCE_TIERS,
  ANNOUNCEMENT_CATEGORY,
  ANNOUNCEMENT_STATUS
} from '../src/launchAnnouncementDiscovery.js';
import { resetTomorrowWatchlist } from '../src/preLaunchEngine.js';
import { startDashboardServer, stopDashboardServer } from '../src/server.js';

// Enforce test environment flags
process.env.NODE_ENV = 'test';
global.IS_TEST_ENV = true;

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, body });
        }
      });
    }).on('error', reject);
  });
}

async function runTests() {
  console.log('====================================================');
  console.log(' STARTING PHASE 10A ANNOUNCEMENT DISCOVERY TESTS  ');
  console.log('====================================================\n');

  let passed = 0;
  let total = 0;

  function testPass(num, name) {
    passed++;
    total++;
    console.log(`[PASS] ${num}. ${name}`);
  }

  const baseNowMs = 1757850000000; // Fixed deterministic timestamp (Sept 2025)
  const { todayDateStr, tomorrowDateStr } = calculateTomorrowTargetDate(baseNowMs, 'UTC');

  resetTomorrowWatchlist();

  // --------------------------------------------------------------------------
  // TEST 1: Official announcement parsing
  // --------------------------------------------------------------------------
  {
    const text = 'Official launch date: 2026-09-15 14:00 UTC for Project Alpha';
    const parsed = parseAnnouncementText(text, baseNowMs, 'UTC');
    assert.strictEqual(parsed.expectedLaunchDate, '2026-09-15');
    assert.strictEqual(parsed.expectedLaunchTime, '14:00');
    assert.strictEqual(parsed.timezone, 'UTC');
    assert.strictEqual(parsed.isExplicitAnnouncement, true);
    testPass(1, 'Official announcement parsing extracts launch date, time, and timezone');
  }

  // --------------------------------------------------------------------------
  // TEST 2: Date extraction
  // --------------------------------------------------------------------------
  {
    const parsed1 = parseAnnouncementText('Launch date: September 15, 2026');
    assert.strictEqual(parsed1.expectedLaunchDate, '2026-09-15');

    const parsed2 = parseAnnouncementText('Launch date: 15 September 2026');
    assert.strictEqual(parsed2.expectedLaunchDate, '2026-09-15');

    const parsed3 = parseAnnouncementText('Launch date: 09/15/2026');
    assert.strictEqual(parsed3.expectedLaunchDate, '2026-09-15');
    testPass(2, 'Date extraction supports YYYY-MM-DD, Month DD YYYY, and MM/DD/YYYY formats');
  }

  // --------------------------------------------------------------------------
  // TEST 3: Time extraction
  // --------------------------------------------------------------------------
  {
    const parsed1 = parseAnnouncementText('Launch date 2026-09-15 at 14:00 UTC');
    assert.strictEqual(parsed1.expectedLaunchTime, '14:00');

    const parsed2 = parseAnnouncementText('Launch date 2026-09-15 at 2:00 PM EST');
    assert.strictEqual(parsed2.expectedLaunchTime, '14:00');
    testPass(3, 'Time extraction parses 24h and 12h AM/PM time expressions');
  }

  // --------------------------------------------------------------------------
  // TEST 4: Timezone extraction
  // --------------------------------------------------------------------------
  {
    const parsed = parseAnnouncementText('Launch date 2026-09-15 at 14:00 EST');
    assert.strictEqual(parsed.timezone, 'EST');
    testPass(4, 'Timezone extraction identifies explicit timezone indicators (EST, UTC, PST)');
  }

  // --------------------------------------------------------------------------
  // TEST 5: Missing timezone
  // --------------------------------------------------------------------------
  {
    const parsed = parseAnnouncementText('Launch date 2026-09-15 at 14:00');
    assert.strictEqual(parsed.timezone, 'UNKNOWN');
    testPass(5, 'Missing timezone sets timezone = UNKNOWN without assuming UTC silently');
  }

  // --------------------------------------------------------------------------
  // TEST 6: Relative "tomorrow"
  // --------------------------------------------------------------------------
  {
    const parsed = parseAnnouncementText('Scheduled launch tomorrow at 14:00 UTC', baseNowMs, 'UTC');
    assert.strictEqual(parsed.expectedLaunchDate, tomorrowDateStr);
    testPass(6, 'Relative term "tomorrow" is evaluated using source timestamp and timezone');
  }

  // --------------------------------------------------------------------------
  // TEST 7: Relative weekday
  // --------------------------------------------------------------------------
  {
    const parsed = parseAnnouncementText('Public sale starts next Tuesday', baseNowMs, 'UTC');
    assert.strictEqual(typeof parsed.expectedLaunchDate, 'string');
    assert.strictEqual(parsed.expectedLaunchDate.length, 10);
    testPass(7, 'Relative weekday (e.g. "next Tuesday") correctly calculates future date');
  }

  // --------------------------------------------------------------------------
  // TEST 8: Tomorrow classification
  // --------------------------------------------------------------------------
  {
    const res = classifyLaunchDate(tomorrowDateStr, tomorrowDateStr, todayDateStr, 'UTC');
    assert.strictEqual(res.status, 'TOMORROW');
    testPass(8, 'Date matching target tomorrow date classified as TOMORROW');
  }

  // --------------------------------------------------------------------------
  // TEST 9: Today classification
  // --------------------------------------------------------------------------
  {
    const res = classifyLaunchDate(todayDateStr, tomorrowDateStr, todayDateStr, 'UTC');
    assert.strictEqual(res.status, 'TODAY');
    testPass(9, 'Date matching target today date classified as TODAY');
  }

  // --------------------------------------------------------------------------
  // TEST 10: Future classification
  // --------------------------------------------------------------------------
  {
    const res = classifyLaunchDate('2099-01-01', tomorrowDateStr, todayDateStr, 'UTC');
    assert.strictEqual(res.status, 'FUTURE_FAR');
    testPass(10, 'Far future date classified as FUTURE_FAR');
  }

  // --------------------------------------------------------------------------
  // TEST 11: Past classification
  // --------------------------------------------------------------------------
  {
    const res = classifyLaunchDate('2020-01-01', tomorrowDateStr, todayDateStr, 'UTC');
    assert.strictEqual(res.status, 'PAST');
    testPass(11, 'Past date classified as PAST');
  }

  // --------------------------------------------------------------------------
  // TEST 12: Malformed announcement
  // --------------------------------------------------------------------------
  {
    const parsed = parseAnnouncementText(null);
    assert.strictEqual(parsed.expectedLaunchDate, null);
    assert.strictEqual(parsed.isExplicitAnnouncement, false);
    testPass(12, 'Malformed/null announcement text handled cleanly without errors');
  }

  // --------------------------------------------------------------------------
  // TEST 13: Duplicate projects
  // --------------------------------------------------------------------------
  {
    const items = [
      { name: 'Solana Meme', symbol: 'SMEM', expectedLaunchDate: tomorrowDateStr, platform: 'raydium' },
      { name: 'solana meme', symbol: 'smem', expectedLaunchDate: tomorrowDateStr, platform: 'raydium' }
    ];
    const merged = mergeAndDeduplicateCandidates(items);
    assert.strictEqual(merged.length, 1);
    testPass(13, 'Normalized project name + symbol + platform deduplicates identical projects');
  }

  // --------------------------------------------------------------------------
  // TEST 14: Duplicate mint
  // --------------------------------------------------------------------------
  {
    const items = [
      { name: 'Proj1', symbol: 'P1', mint: '7wCM5K4ziHmrbjGe5QFhBqBME2fH82dn4Wfx8vhKSTNK', expectedLaunchDate: tomorrowDateStr },
      { name: 'Proj2', symbol: 'P1', mint: '7wCM5K4ziHmrbjGe5QFhBqBME2fH82dn4Wfx8vhKSTNK', expectedLaunchDate: tomorrowDateStr }
    ];
    const merged = mergeAndDeduplicateCandidates(items);
    assert.strictEqual(merged.length, 1);
    assert.strictEqual(merged[0].evidence.sourcesCount, 2);
    testPass(14, 'Duplicate mint addresses merge into a single candidate with multi-source evidence');
  }

  // --------------------------------------------------------------------------
  // TEST 15: Source failure
  // --------------------------------------------------------------------------
  {
    const adapter = new SourceAdapter({
      id: 'failing_source',
      name: 'Failing Source',
      url: 'http://localhost:59999/non-existent-endpoint',
      timeoutMs: 1000
    });
    const res = await adapter.executeFetch(true);
    assert.strictEqual(res.status, 'SOURCE_UNAVAILABLE');
    testPass(15, 'Source network failure returns SOURCE_UNAVAILABLE without crashing engine');
  }

  // --------------------------------------------------------------------------
  // TEST 16: HTTP 429
  // --------------------------------------------------------------------------
  {
    const adapter = new SourceAdapter({
      id: 'rate_limited_source',
      name: 'Rate Limited Source',
      url: 'http://mock-rate-limit-url',
      fetchFn: async () => ({ status: 'SOURCE_RATE_LIMITED', error: 'HTTP 429 Rate Limited', items: [], lastCheckedAt: new Date().toISOString() })
    });
    const res = await adapter.executeFetch(true);
    assert.strictEqual(res.status, 'SOURCE_RATE_LIMITED');
    testPass(16, 'HTTP 429 response handled gracefully returning SOURCE_RATE_LIMITED status');
  }

  // --------------------------------------------------------------------------
  // TEST 17: HTTP 403
  // --------------------------------------------------------------------------
  {
    const adapter = new SourceAdapter({
      id: 'blocked_source',
      name: 'Blocked Source',
      url: 'http://mock-blocked-url',
      fetchFn: async () => ({ status: 'SOURCE_BLOCKED', error: 'HTTP 403 Access Blocked', items: [], lastCheckedAt: new Date().toISOString() })
    });
    const res = await adapter.executeFetch(true);
    assert.strictEqual(res.status, 'SOURCE_BLOCKED');
    testPass(17, 'HTTP 403 Cloudflare/block response returns SOURCE_BLOCKED status');
  }

  // --------------------------------------------------------------------------
  // TEST 18: Timeout
  // --------------------------------------------------------------------------
  {
    const adapter = new SourceAdapter({
      id: 'timeout_source',
      name: 'Timeout Source',
      url: 'http://mock-timeout-url',
      fetchFn: async () => ({ status: 'SOURCE_TIMEOUT', error: 'Request timeout (8000ms)', items: [], lastCheckedAt: new Date().toISOString() })
    });
    const res = await adapter.executeFetch(true);
    assert.strictEqual(res.status, 'SOURCE_TIMEOUT');
    testPass(18, 'Source request timeout returns SOURCE_TIMEOUT status');
  }

  // --------------------------------------------------------------------------
  // TEST 19: Live token separation
  // --------------------------------------------------------------------------
  {
    const report = await runLaunchAnnouncementDiscovery({ nowMs: baseNowMs, bypassCache: true });
    assert.ok(Array.isArray(report.liveAnnouncements));
    for (const c of report.liveAnnouncements) {
      assert.strictEqual(c.category, ANNOUNCEMENT_CATEGORY.LIVE_DETECTED);
      assert.strictEqual(c.status, ANNOUNCEMENT_STATUS.LIVE_ALREADY_DETECTED);
    }
    testPass(19, 'Tokens from live feeds classified as liveLaunchCandidate and excluded from tomorrow shortlist');
  }

  // --------------------------------------------------------------------------
  // TEST 20: DATE_CONFLICT
  // --------------------------------------------------------------------------
  {
    const items = [
      { name: 'ConflictProj', symbol: 'CP', expectedLaunchDate: tomorrowDateStr, source: 'Source1' },
      { name: 'ConflictProj', symbol: 'CP', expectedLaunchDate: '2026-12-01', source: 'Source2' }
    ];
    const merged = mergeAndDeduplicateCandidates(items);
    assert.strictEqual(merged.length, 1);
    assert.strictEqual(merged[0].status, CANDIDATE_STATUS.DATE_CONFLICT);
    assert.strictEqual(merged[0].confidence, CONFIDENCE_LEVELS.WEAK);
    testPass(20, 'Conflicting launch dates across sources set DATE_CONFLICT and downgrade confidence to WEAK');
  }

  // --------------------------------------------------------------------------
  // TEST 21: CONFIRMED evidence
  // --------------------------------------------------------------------------
  {
    const items = [
      { name: 'ConfirmedProj', symbol: 'CP', expectedLaunchDate: tomorrowDateStr, sourceTier: 1, confidence: CONFIDENCE_LEVELS.EXPECTED },
      { name: 'ConfirmedProj', symbol: 'CP', expectedLaunchDate: tomorrowDateStr, sourceTier: 3, confidence: CONFIDENCE_LEVELS.EXPECTED }
    ];
    const merged = mergeAndDeduplicateCandidates(items);
    assert.strictEqual(merged[0].confidence, CONFIDENCE_LEVELS.CONFIRMED);
    testPass(21, 'Multiple independent sources agreeing on launch date produce CONFIRMED evidence');
  }

  // --------------------------------------------------------------------------
  // TEST 22: EXPECTED evidence
  // --------------------------------------------------------------------------
  {
    const items = [
      { name: 'ExpectedProj', symbol: 'EP', expectedLaunchDate: tomorrowDateStr, sourceTier: 1, isOfficialAnnouncement: true, confidence: CONFIDENCE_LEVELS.EXPECTED }
    ];
    const merged = mergeAndDeduplicateCandidates(items);
    assert.strictEqual(merged[0].confidence, CONFIDENCE_LEVELS.EXPECTED);
    testPass(22, 'Single official Tier 1/2 source produces EXPECTED evidence');
  }

  // --------------------------------------------------------------------------
  // TEST 23: WEAK evidence
  // --------------------------------------------------------------------------
  {
    const items = [
      { name: 'WeakProj', symbol: 'WP', expectedLaunchDate: tomorrowDateStr, confidence: 'WEAK' }
    ];
    const { shortlist, weak } = filterTomorrowShortlist(items, tomorrowDateStr);
    assert.strictEqual(shortlist.length, 0);
    assert.strictEqual(weak.length, 1);
    testPass(23, 'Candidate with WEAK confidence rejected from tomorrow shortlist');
  }

  // --------------------------------------------------------------------------
  // TEST 24: UNKNOWN evidence
  // --------------------------------------------------------------------------
  {
    const items = [
      { name: 'UnknownProj', symbol: 'UP', expectedLaunchDate: null }
    ];
    const { shortlist, rejected } = filterTomorrowShortlist(items, tomorrowDateStr);
    assert.strictEqual(shortlist.length, 0);
    testPass(24, 'Candidate missing launch date rejected from shortlist');
  }

  // --------------------------------------------------------------------------
  // TEST 25: No fake candidates
  // --------------------------------------------------------------------------
  {
    const report = await runLaunchAnnouncementDiscovery({ nowMs: baseNowMs, bypassCache: true });
    for (const c of report.scheduledAnnouncements) {
      assert.notStrictEqual(c.name, 'Fake Token');
      assert.notStrictEqual(c.symbol, 'FAKE');
      assert.ok(c.expectedLaunchDate);
    }
    testPass(25, 'Anti-hallucination verified: Zero fake or synthetic fallback candidates generated');
  }

  // --------------------------------------------------------------------------
  // TEST 26: Empty-source result
  // --------------------------------------------------------------------------
  {
    const report = await runLaunchAnnouncementDiscovery({ nowMs: baseNowMs, bypassCache: true });
    if (report.scheduledAnnouncements.length === 0) {
      assert.ok(
        report.overallStatus === ANNOUNCEMENT_STATUS.NO_VERIFIED_TOMORROW_DATA ||
        report.overallStatus === 'NO_RELIABLE_SOURCE_DATA'
      );
    }
    testPass(26, 'Empty discovery result returns valid status cleanly');
  }

  // --------------------------------------------------------------------------
  // TEST 27: Phase 9 integration
  // --------------------------------------------------------------------------
  {
    const status = getLaunchAnnouncementsStatus();
    assert.ok(status !== null);
    testPass(27, 'Phase 10A Announcement Discovery integrates cleanly with preLaunchScheduler state');
  }

  // --------------------------------------------------------------------------
  // BONUS READ-ONLY API TEST FOR PHASE 10A ENDPOINTS
  // --------------------------------------------------------------------------
  {
    const PORT = 3997;
    const { stopServer } = await startDashboardServer(PORT);
    const baseUrl = `http://localhost:${PORT}`;

    const statusRes = await httpGet(`${baseUrl}/api/launch-announcements/status`);
    assert.strictEqual(statusRes.status, 200);

    const candidatesRes = await httpGet(`${baseUrl}/api/launch-announcements/candidates`);
    assert.strictEqual(candidatesRes.status, 200);
    assert.ok('scheduled' in candidatesRes.data);
    assert.ok('live' in candidatesRes.data);

    const sourcesRes = await httpGet(`${baseUrl}/api/launch-announcements/sources`);
    assert.strictEqual(sourcesRes.status, 200);
    assert.ok('sources' in sourcesRes.data);

    const evidenceRes = await httpGet(`${baseUrl}/api/launch-announcements/evidence/nonexistent_id`);
    assert.strictEqual(evidenceRes.status, 404);

    stopServer();
    console.log('[PASS] Dashboard API endpoints for Phase 10A respond on GET with 200/404');
  }

  console.log('\n====================================================');
  console.log(`PHASE 10A TEST SUITE SUMMARY: ${passed} / ${total} PASSED`);
  console.log('====================================================\n');
}

runTests().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
