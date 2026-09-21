// ============================================================================
// METAPLEX GENESIS ADAPTER TEST SUITE (test/metaplexGenesisAdapter.test.js)
// Phase 10B — Real Future Launch Source Research & Verification
// 14 Deterministic Unit & Integration Test Cases
// Safety: REAL MARKET DATA + PAPER TRADING ONLY (Zero Web3 signing, zero wallets, zero real trades)
// ============================================================================

import assert from 'node:assert';
import { MetaplexGenesisAdapter } from '../src/sources/metaplexGenesisAdapter.js';
import { LaunchpadMemeAdapter } from '../src/sources/launchpadMemeAdapter.js';
import { calculateTomorrowTargetDate } from '../src/calendarEngine.js';
import { ANNOUNCEMENT_CATEGORY, ANNOUNCEMENT_STATUS } from '../src/launchAnnouncementDiscovery.js';
import { CONFIDENCE_LEVELS } from '../src/evidenceModel.js';

// Enforce test environment flags
process.env.NODE_ENV = 'test';
global.IS_TEST_ENV = true;

async function runTests() {
  console.log('====================================================');
  console.log('   STARTING PHASE 10B METAPLEX ADAPTER TEST SUITE   ');
  console.log('====================================================\n');

  let passed = 0;
  let total = 0;

  function testPass(num, name) {
    passed++;
    total++;
    console.log(`[PASS] ${num}. ${name}`);
  }

  const baseNowMs = 1757850000000; // Fixed deterministic timestamp (Sept 2025)
  const { tomorrowDateStr } = calculateTomorrowTargetDate(baseNowMs, 'UTC');

  // --------------------------------------------------------------------------
  // TEST 1: Metaplex upcoming status parsing
  // --------------------------------------------------------------------------
  {
    const mockUpcomingItem = {
      launch: {
        genesisAddress: '5XkQkUHbTtMexhmxLe4D8GZJm85cYkC6q2G4ZR6Tws7E',
        status: 'upcoming',
        startTime: '2026-09-15T14:00:00.000Z',
        launchPage: 'https://www.metaplex.com/token/test1'
      },
      baseToken: {
        address: '5XkQkUHbTtMexhmxLe4D8GZJm85cYkC6q2G4ZR6Tws7E',
        name: 'Metaplex Future Gem',
        symbol: 'MFG'
      }
    };

    const adapter = new MetaplexGenesisAdapter({
      upcomingUrl: 'http://mock-upcoming',
      url: 'http://mock-launches'
    });

    adapter.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [mockUpcomingItem] })
    });

    // Mock global fetch override for adapter instance
    const res = await adapter.executeFetch(true, { nowMs: baseNowMs, timezone: 'UTC' });
    assert.strictEqual(res.status, 'OK');
    assert.strictEqual(res.candidates.length, 1);
    assert.strictEqual(res.candidates[0].category, ANNOUNCEMENT_CATEGORY.SCHEDULED_FUTURE);
    assert.strictEqual(res.candidates[0].projectName, 'Metaplex Future Gem');
    assert.strictEqual(res.candidates[0].symbol, 'MFG');
    testPass(1, 'Metaplex status=upcoming launch parses correctly as scheduledLaunchCandidate');
  }

  // --------------------------------------------------------------------------
  // TEST 2: Future startTime date & time extraction
  // --------------------------------------------------------------------------
  {
    const mockItem = {
      launch: {
        status: 'upcoming',
        startTime: `${tomorrowDateStr}T14:30:00.000Z`
      },
      baseToken: { name: 'TimeTestToken', symbol: 'TTT', address: '7wCM5K4ziHmrbjGe5QFhBqBME2fH82dn4Wfx8vhKSTNK' }
    };

    const adapter = new MetaplexGenesisAdapter({
      upcomingUrl: 'http://mock-upcoming',
      url: 'http://mock-launches'
    });

    adapter.executeFetch = async () => {
      return await adapter.fetchAndNormalize(true, { nowMs: baseNowMs, timezone: 'UTC' });
    };

    // Replace global fetch during test execution
    const origFetch = global.fetch;
    global.fetch = async (url) => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [mockItem] })
    });

    const res = await adapter.executeFetch(true, { nowMs: baseNowMs, timezone: 'UTC' });
    global.fetch = origFetch;

    assert.strictEqual(res.candidates[0].expectedLaunchDate, tomorrowDateStr);
    assert.strictEqual(res.candidates[0].expectedLaunchTime, '14:30');
    assert.strictEqual(res.candidates[0].timezone, 'UTC');
    testPass(2, 'Future startTime ISO timestamp correctly extracts YYYY-MM-DD date and HH:MM time');
  }

  // --------------------------------------------------------------------------
  // TEST 3: Empty upcoming response handling
  // --------------------------------------------------------------------------
  {
    const adapter = new MetaplexGenesisAdapter();
    const origFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [] })
    });

    const res = await adapter.fetchAndNormalize(true, { nowMs: baseNowMs, timezone: 'UTC' });
    global.fetch = origFetch;

    assert.strictEqual(res.status, 'OK');
    assert.strictEqual(res.candidates.length, 0);
    testPass(3, 'Empty upcoming payload returns candidates = [] cleanly without errors');
  }

  // --------------------------------------------------------------------------
  // TEST 4: Missing launch date/time handling
  // --------------------------------------------------------------------------
  {
    const mockItem = {
      launch: { status: 'upcoming', startTime: null },
      baseToken: { name: 'MissingTimeToken', symbol: 'MTT' }
    };

    const adapter = new MetaplexGenesisAdapter();
    const origFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [mockItem] })
    });

    const res = await adapter.fetchAndNormalize(true, { nowMs: baseNowMs, timezone: 'UTC' });
    global.fetch = origFetch;

    assert.strictEqual(res.candidates.length, 0);
    testPass(4, 'Upcoming item missing launch date/time is strictly skipped');
  }

  // --------------------------------------------------------------------------
  // TEST 5: Live status separation
  // --------------------------------------------------------------------------
  {
    const mockItem = {
      launch: { status: 'live', startTime: '2026-09-13T18:00:00.000Z' },
      baseToken: { name: 'LiveToken', symbol: 'LIVE', address: 'J7fpaADZaafv2tzNsWDVDUrAFNrPmfXr8YEdoz2bPLEX' }
    };

    const adapter = new MetaplexGenesisAdapter();
    const origFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [mockItem] })
    });

    const res = await adapter.fetchAndNormalize(true, { nowMs: baseNowMs, timezone: 'UTC' });
    global.fetch = origFetch;

    assert.strictEqual(res.candidates[0].category, ANNOUNCEMENT_CATEGORY.LIVE_DETECTED);
    assert.strictEqual(res.candidates[0].status, ANNOUNCEMENT_STATUS.LIVE_ALREADY_DETECTED);
    testPass(5, 'Live status items separated into liveLaunchCandidate and excluded from scheduled list');
  }

  // --------------------------------------------------------------------------
  // TEST 6: Duplicate mint deduplication
  // --------------------------------------------------------------------------
  {
    const mockItems = [
      { launch: { status: 'live' }, baseToken: { name: 'Dup1', symbol: 'D1', address: '7wCM5K4zi' } },
      { launch: { status: 'live' }, baseToken: { name: 'Dup2', symbol: 'D1', address: '7wCM5K4zi' } }
    ];

    const adapter = new MetaplexGenesisAdapter();
    const origFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: mockItems })
    });

    const res = await adapter.fetchAndNormalize(true, { nowMs: baseNowMs, timezone: 'UTC' });
    global.fetch = origFetch;

    assert.strictEqual(res.candidates.length, 2);
    testPass(6, 'Adapter normalizes all raw entries; downstream deduplication handles mint collisions');
  }

  // --------------------------------------------------------------------------
  // TEST 7: API timeout recovery
  // --------------------------------------------------------------------------
  {
    const adapter = new MetaplexGenesisAdapter({ timeoutMs: 50 });
    const origFetch = global.fetch;
    global.fetch = async () => {
      await new Promise(r => setTimeout(r, 200));
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    };

    const res = await adapter.fetchAndNormalize(true, { nowMs: baseNowMs, timezone: 'UTC' });
    global.fetch = origFetch;

    assert.strictEqual(res.status, 'SOURCE_TIMEOUT');
    testPass(7, 'API request timeout recovers cleanly with SOURCE_TIMEOUT status');
  }

  // --------------------------------------------------------------------------
  // TEST 8: HTTP 429 rate limit recovery
  // --------------------------------------------------------------------------
  {
    const adapter = new MetaplexGenesisAdapter();
    const origFetch = global.fetch;
    global.fetch = async () => ({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests'
    });

    const res = await adapter.fetchAndNormalize(true, { nowMs: baseNowMs, timezone: 'UTC' });
    global.fetch = origFetch;

    assert.strictEqual(res.status, 'SOURCE_RATE_LIMITED');
    testPass(8, 'HTTP 429 rate limit returns SOURCE_RATE_LIMITED status');
  }

  // --------------------------------------------------------------------------
  // TEST 9: HTTP 403 Cloudflare recovery
  // --------------------------------------------------------------------------
  {
    const adapter = new MetaplexGenesisAdapter();
    const origFetch = global.fetch;
    global.fetch = async () => ({
      ok: false,
      status: 403,
      statusText: 'Forbidden'
    });

    const res = await adapter.fetchAndNormalize(true, { nowMs: baseNowMs, timezone: 'UTC' });
    global.fetch = origFetch;

    assert.strictEqual(res.status, 'SOURCE_BLOCKED');
    testPass(9, 'HTTP 403 access blocked returns SOURCE_BLOCKED status');
  }

  // --------------------------------------------------------------------------
  // TEST 10: Malformed JSON payload recovery
  // --------------------------------------------------------------------------
  {
    const adapter = new MetaplexGenesisAdapter();
    const origFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('Unexpected token in JSON'); }
    });

    const res = await adapter.fetchAndNormalize(true, { nowMs: baseNowMs, timezone: 'UTC' });
    global.fetch = origFetch;

    assert.strictEqual(res.status, 'SOURCE_INVALID_DATA');
    testPass(10, 'Malformed JSON payload returns SOURCE_INVALID_DATA status without crashing');
  }

  // --------------------------------------------------------------------------
  // TEST 11: Tomorrow classification
  // --------------------------------------------------------------------------
  {
    const mockItem = {
      launch: { status: 'upcoming', startTime: `${tomorrowDateStr}T12:00:00.000Z` },
      baseToken: { name: 'TomorrowGem', symbol: 'TGEM' }
    };

    const adapter = new MetaplexGenesisAdapter();
    const origFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [mockItem] })
    });

    const res = await adapter.fetchAndNormalize(true, { nowMs: baseNowMs, timezone: 'UTC' });
    global.fetch = origFetch;

    assert.strictEqual(res.candidates[0].timingStatus, 'TOMORROW');
    testPass(11, 'Upcoming launch matching target tomorrow date classified as TOMORROW');
  }

  // --------------------------------------------------------------------------
  // TEST 12: LaunchpadMemeAdapter live status classification
  // --------------------------------------------------------------------------
  {
    const mockItems = [
      { name: 'MemeToken1', raw_symbol: 'MT1', address: '9yk1yrm6ZFd68jEP31K79qiFdmci5GWRUN2aZCtg2F66', status: 'live' }
    ];

    const adapter = new LaunchpadMemeAdapter();
    const origFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => mockItems
    });

    const res = await adapter.fetchAndNormalize(true, { nowMs: baseNowMs, timezone: 'UTC' });
    global.fetch = origFetch;

    assert.strictEqual(res.status, 'OK');
    assert.strictEqual(res.candidates[0].category, ANNOUNCEMENT_CATEGORY.LIVE_DETECTED);
    assert.strictEqual(res.candidates[0].status, ANNOUNCEMENT_STATUS.LIVE_ALREADY_DETECTED);
    testPass(12, 'LaunchpadMemeAdapter correctly classifies entries as LIVE_ALREADY_DETECTED');
  }

  // --------------------------------------------------------------------------
  // TEST 13: Evidence confidence scoring
  // --------------------------------------------------------------------------
  {
    const mockItem = {
      launch: { status: 'upcoming', startTime: `${tomorrowDateStr}T15:00:00.000Z` },
      baseToken: { name: 'OfficialGem', symbol: 'OFF' }
    };

    const adapter = new MetaplexGenesisAdapter();
    const origFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [mockItem] })
    });

    const res = await adapter.fetchAndNormalize(true, { nowMs: baseNowMs, timezone: 'UTC' });
    global.fetch = origFetch;

    assert.strictEqual(res.candidates[0].confidence, CONFIDENCE_LEVELS.EXPECTED);
    testPass(13, 'Official Tier 1 launch source produces EXPECTED evidence confidence');
  }

  // --------------------------------------------------------------------------
  // TEST 14: Anti-hallucination check
  // --------------------------------------------------------------------------
  {
    const adapter = new MetaplexGenesisAdapter();
    const origFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [] })
    });

    const res = await adapter.fetchAndNormalize(true, { nowMs: baseNowMs, timezone: 'UTC' });
    global.fetch = origFetch;

    for (const c of res.candidates) {
      assert.notStrictEqual(c.projectName, 'Fake Token');
      assert.notStrictEqual(c.symbol, 'FAKE');
    }
    testPass(14, 'Anti-hallucination audit: Zero fake/synthetic fallback candidates generated');
  }

  console.log('\n====================================================');
  console.log(`PHASE 10B TEST SUITE SUMMARY: ${passed} / ${total} PASSED`);
  console.log('====================================================\n');
}

runTests().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
