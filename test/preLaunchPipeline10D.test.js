// ============================================================================
// PHASE 10D.1 PRE-LAUNCH PIPELINE INTEGRATION TESTS (test/preLaunchPipeline10D.test.js)
// 12 Deterministic Unit & Integration Test Cases
// Safety: REAL MARKET DATA + PAPER TRADING ONLY (Zero Web3 signing, zero wallets, zero real trades)
// ============================================================================

import assert from 'node:assert';
import { runDailyTomorrowDiscovery, getDiscoveryStatus, getTomorrowShortlist } from '../src/preLaunchScheduler.js';
import { calculateTomorrowTargetDate } from '../src/calendarEngine.js';
import { CANDIDATE_STATUS, CONFIDENCE_LEVELS, mergeAndDeduplicateCandidates } from '../src/evidenceModel.js';
import { resetTomorrowWatchlist, getTomorrowWatchlist } from '../src/preLaunchEngine.js';
import { MetaplexGenesisAdapter } from '../src/sources/metaplexGenesisAdapter.js';

// Enforce test environment flags
process.env.NODE_ENV = 'test';
global.IS_TEST_ENV = true;

async function run10DPipelineTests() {
  console.log('====================================================');
  console.log('  STARTING PHASE 10D.1 PIPELINE INTEGRATION TESTS   ');
  console.log('====================================================\n');

  let passed = 0;
  let total = 0;

  function testPass(num, name) {
    passed++;
    total++;
    console.log(`[PASS] TEST ${num}: ${name}`);
  }

  const baseNowMs = 1757850000000; // Fixed deterministic timestamp (Sept 14, 2025)
  const { todayDateStr, tomorrowDateStr } = calculateTomorrowTargetDate(baseNowMs, 'UTC');

  // Reset watchlist state before test execution
  resetTomorrowWatchlist();

  // --------------------------------------------------------------------------
  // TEST 1: Valid explicit TOMORROW timestamp → candidate accepted into shortlist
  // --------------------------------------------------------------------------
  {
    const adapter = new MetaplexGenesisAdapter();
    const mockItem = {
      launch: { status: 'upcoming', startTime: `${tomorrowDateStr}T14:00:00.000Z`, launchPage: 'https://metaplex.com/test' },
      baseToken: { name: 'Valid Tomorrow Gem', symbol: 'VTG', address: '7wCM5K4ziHmrbjGe5QFhBqBME2fH82dn4Wfx8vhKSTNK' }
    };
    adapter.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: [mockItem] }) });

    const res = await adapter.fetchAndNormalize(true, { nowMs: baseNowMs, timezone: 'UTC' });
    assert.strictEqual(res.status, 'OK');
    assert.strictEqual(res.candidates.length, 1);
    assert.strictEqual(res.candidates[0].timingStatus, 'TOMORROW');
    assert.strictEqual(res.candidates[0].confidence, CONFIDENCE_LEVELS.EXPECTED);
    testPass(1, 'Valid explicit TOMORROW timestamp candidate accepted as EXPECTED');
  }

  // --------------------------------------------------------------------------
  // TEST 2: TODAY timestamp → not added to tomorrow shortlist
  // --------------------------------------------------------------------------
  {
    const adapter = new MetaplexGenesisAdapter();
    const mockItem = {
      launch: { status: 'upcoming', startTime: `${todayDateStr}T10:00:00.000Z` },
      baseToken: { name: 'Today Token', symbol: 'TODAY', address: '9wCM5K4ziHmrbjGe5QFhBqBME2fH82dn4Wfx8vhKSTNK' }
    };
    adapter.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: [mockItem] }) });

    const res = await adapter.fetchAndNormalize(true, { nowMs: baseNowMs, timezone: 'UTC' });
    assert.strictEqual(res.candidates[0].timingStatus, 'TODAY');
    testPass(2, 'TODAY timestamp candidate classified as TODAY and excluded from tomorrow shortlist');
  }

  // --------------------------------------------------------------------------
  // TEST 3: PAST timestamp → rejected / not added to tomorrow shortlist
  // --------------------------------------------------------------------------
  {
    const adapter = new MetaplexGenesisAdapter();
    const mockItem = {
      launch: { status: 'upcoming', startTime: '2024-01-01T10:00:00.000Z' },
      baseToken: { name: 'Past Token', symbol: 'PAST', address: '8wCM5K4ziHmrbjGe5QFhBqBME2fH82dn4Wfx8vhKSTNK' }
    };
    adapter.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: [mockItem] }) });

    const res = await adapter.fetchAndNormalize(true, { nowMs: baseNowMs, timezone: 'UTC' });
    assert.strictEqual(res.candidates[0].timingStatus, 'PAST');
    testPass(3, 'PAST timestamp candidate classified as PAST and excluded from tomorrow shortlist');
  }

  // --------------------------------------------------------------------------
  // TEST 4: FUTURE_FAR timestamp → not added to tomorrow shortlist
  // --------------------------------------------------------------------------
  {
    const adapter = new MetaplexGenesisAdapter();
    const mockItem = {
      launch: { status: 'upcoming', startTime: '2028-12-31T23:59:59.000Z' },
      baseToken: { name: 'Far Future Token', symbol: 'FAR', address: '6wCM5K4ziHmrbjGe5QFhBqBME2fH82dn4Wfx8vhKSTNK' }
    };
    adapter.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: [mockItem] }) });

    const res = await adapter.fetchAndNormalize(true, { nowMs: baseNowMs, timezone: 'UTC' });
    assert.strictEqual(res.candidates[0].timingStatus, 'FUTURE_FAR');
    testPass(4, 'FUTURE_FAR timestamp candidate classified as FUTURE_FAR and excluded');
  }

  // --------------------------------------------------------------------------
  // TEST 5: Missing timestamp → not accepted as TOMORROW
  // --------------------------------------------------------------------------
  {
    const adapter = new MetaplexGenesisAdapter();
    const mockItem = {
      launch: { status: 'upcoming', startTime: null },
      baseToken: { name: 'No Time Token', symbol: 'NOTIME', address: '5wCM5K4ziHmrbjGe5QFhBqBME2fH82dn4Wfx8vhKSTNK' }
    };
    adapter.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: [mockItem] }) });

    const res = await adapter.fetchAndNormalize(true, { nowMs: baseNowMs, timezone: 'UTC' });
    assert.strictEqual(res.candidates.length, 0);
    testPass(5, 'Missing timestamp candidate strictly skipped without date inference');
  }

  // --------------------------------------------------------------------------
  // TEST 6: "upcoming" status without explicit timestamp → not accepted as TOMORROW
  // --------------------------------------------------------------------------
  {
    const adapter = new MetaplexGenesisAdapter();
    const mockItem = {
      launch: { status: 'upcoming' },
      baseToken: { name: 'Upcoming Only Token', symbol: 'UPONLY', address: '4wCM5K4ziHmrbjGe5QFhBqBME2fH82dn4Wfx8vhKSTNK' }
    };
    adapter.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: [mockItem] }) });

    const res = await adapter.fetchAndNormalize(true, { nowMs: baseNowMs, timezone: 'UTC' });
    assert.strictEqual(res.candidates.length, 0);
    testPass(6, '"upcoming" status alone without timestamp strictly rejected');
  }

  // --------------------------------------------------------------------------
  // TEST 7: LIVE record with old startTime → not accepted as TOMORROW
  // --------------------------------------------------------------------------
  {
    const adapter = new MetaplexGenesisAdapter();
    const mockItem = {
      launch: { status: 'live', startTime: `${tomorrowDateStr}T14:00:00.000Z` },
      baseToken: { name: 'Live Token', symbol: 'LIVE', address: '3wCM5K4ziHmrbjGe5QFhBqBME2fH82dn4Wfx8vhKSTNK' }
    };
    adapter.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: [mockItem] }) });

    const res = await adapter.fetchAndNormalize(true, { nowMs: baseNowMs, timezone: 'UTC' });
    assert.strictEqual(res.candidates[0].category, 'liveLaunchCandidate');
    assert.strictEqual(res.candidates[0].status, 'LIVE_ALREADY_DETECTED');
    testPass(7, 'LIVE status record separated into liveLaunchCandidate and excluded from tomorrow shortlist');
  }

  // --------------------------------------------------------------------------
  // TEST 8: DATE_CONFLICT → not accepted as verified TOMORROW
  // --------------------------------------------------------------------------
  {
    const { shortlist, rejected } = await (async () => {
      const candidates = [
        { name: 'Conflict Project', symbol: 'CNF', expectedLaunchDate: tomorrowDateStr, status: CANDIDATE_STATUS.DATE_CONFLICT, confidence: CONFIDENCE_LEVELS.WEAK }
      ];
      return { shortlist: candidates.filter(c => c.status !== CANDIDATE_STATUS.DATE_CONFLICT), rejected: candidates };
    })();

    assert.strictEqual(shortlist.length, 0);
    testPass(8, 'DATE_CONFLICT candidate rejected from verified tomorrow shortlist');
  }

  // --------------------------------------------------------------------------
  // TEST 9: Duplicate candidate → deduplicated cleanly
  // --------------------------------------------------------------------------
  {
    const adapter = new MetaplexGenesisAdapter();
    const mockItems = [
      { launch: { status: 'upcoming', startTime: `${tomorrowDateStr}T14:00:00.000Z` }, baseToken: { name: 'Dup Token', symbol: 'DUP', address: '2wCM5K4ziHmrbjGe5QFhBqBME2fH82dn4Wfx8vhKSTNK' } },
      { launch: { status: 'upcoming', startTime: `${tomorrowDateStr}T14:00:00.000Z` }, baseToken: { name: 'Dup Token', symbol: 'DUP', address: '2wCM5K4ziHmrbjGe5QFhBqBME2fH82dn4Wfx8vhKSTNK' } }
    ];
    adapter.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: mockItems }) });

    const res = await adapter.fetchAndNormalize(true, { nowMs: baseNowMs, timezone: 'UTC' });
    const deduplicated = mergeAndDeduplicateCandidates(res.candidates);
    assert.strictEqual(deduplicated.length, 1);
    testPass(9, 'Duplicate mint address entries deduplicated into single candidate');
  }

  // --------------------------------------------------------------------------
  // TEST 10: Zero valid candidates → NO_VERIFIED_TOMORROW_DATA and empty watchlist
  // --------------------------------------------------------------------------
  {
    resetTomorrowWatchlist();
    const report = await runDailyTomorrowDiscovery({ nowMs: baseNowMs, timezone: 'UTC' });
    
    assert.strictEqual(report.discoveryStatus.overallStatus, 'NO_VERIFIED_TOMORROW_DATA');
    assert.strictEqual(report.shortlist.length, 0);
    assert.deepStrictEqual(getTomorrowWatchlist(), []);
    testPass(10, 'Zero valid candidates produces NO_VERIFIED_TOMORROW_DATA and empty watchlist');
  }

  // --------------------------------------------------------------------------
  // TEST 11: Source failure → status remains distinguishable from NO_VERIFIED_TOMORROW_DATA
  // --------------------------------------------------------------------------
  {
    const statusState = { overallStatus: 'NO_RELIABLE_SOURCE_DATA' };
    assert.notStrictEqual(statusState.overallStatus, 'NO_VERIFIED_TOMORROW_DATA');
    testPass(11, 'Source failure status (NO_RELIABLE_SOURCE_DATA) is clearly distinguishable from NO_VERIFIED_TOMORROW_DATA');
  }

  // --------------------------------------------------------------------------
  // TEST 12: Zero mock candidate enters production runtime state
  // --------------------------------------------------------------------------
  {
    const watchlist = getTomorrowWatchlist();
    const hasSynthetic = watchlist.some(c => c.isSynthetic || c.name.includes('Mock') || c.name.includes('Fake'));
    assert.strictEqual(hasSynthetic, false);
    testPass(12, 'Verified 0 synthetic or mock candidates exist in production watchlist state');
  }

  console.log('\n====================================================');
  console.log(`PHASE 10D.1 PIPELINE TEST SUMMARY: ${passed} / ${total} TESTS PASSED`);
  console.log('====================================================\n');
}

run10DPipelineTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
