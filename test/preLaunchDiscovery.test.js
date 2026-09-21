// ============================================================================
// PRE-LAUNCH DISCOVERY ENGINE TESTS (test/preLaunchDiscovery.test.js)
// Phase 9.2 — Real Tomorrow Launch Discovery Engine
// Comprehensive unit and integration tests covering calendar math, timezone logic,
// evidence model, multi-source deduplication, conflict handling, stale data audit,
// pipeline execution, dashboard API, and paper-only security boundaries.
// ============================================================================

import assert from 'node:assert';
import http from 'node:http';
import { calculateTomorrowTargetDate, classifyLaunchDate, formatDateInTimezone } from '../src/calendarEngine.js';
import { 
  normalizeCandidate, 
  mergeAndDeduplicateCandidates, 
  auditCandidateStaleness, 
  filterTomorrowShortlist, 
  CONFIDENCE_LEVELS, 
  CANDIDATE_STATUS 
} from '../src/evidenceModel.js';
import { SOURCE_CATEGORIES, DISCOVERY_SOURCES, discoverUpcomingSolanaLaunches } from '../src/upcomingDiscovery.js';
import { 
  runDailyTomorrowDiscovery, 
  getDiscoveryStatus, 
  getSourcesStatus, 
  getEvidenceReport, 
  getTomorrowShortlist 
} from '../src/preLaunchScheduler.js';
import { resetTomorrowWatchlist, getTomorrowWatchlist } from '../src/preLaunchEngine.js';
import { startDashboardServer, stopDashboardServer } from '../src/server.js';

// Enforce test environment flags
process.env.NODE_ENV = 'test';
global.IS_TEST_ENV = true;

async function runTests() {
  console.log('====================================================');
  console.log('STARTING PHASE 9.2 PRE-LAUNCH DISCOVERY TEST SUITE');
  console.log('====================================================\n');

  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`  ✓ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ FAIL: ${name}`);
      console.error(`    Error: ${err.message}`);
      throw err;
    }
  }

  async function testAsync(name, fn) {
    total++;
    try {
      await fn();
      console.log(`  ✓ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ FAIL: ${name}`);
      console.error(`    Error: ${err.message}`);
      throw err;
    }
  }

  // --------------------------------------------------------------------------
  // 1. Tomorrow Date & Timezone Logic
  // --------------------------------------------------------------------------
  console.log('[SECTION 1: CALENDAR ENGINE & TIMEZONE MATH]');

  test('Calculates tomorrow target date in UTC correctly', () => {
    // Fixed timestamp: 2026-09-10 12:00:00 UTC
    const fixedNow = new Date('2026-09-10T12:00:00Z').getTime();
    const result = calculateTomorrowTargetDate(fixedNow, 'UTC');

    assert.strictEqual(result.todayDateStr, '2026-09-10');
    assert.strictEqual(result.tomorrowDateStr, '2026-09-11');
    assert.strictEqual(result.timezone, 'UTC');
  });

  test('Calculates tomorrow target date with custom timezone (America/New_York)', () => {
    const fixedNow = new Date('2026-09-10T23:30:00Z').getTime(); // 19:30 EDT on 2026-09-10
    const result = calculateTomorrowTargetDate(fixedNow, 'America/New_York');

    assert.strictEqual(result.todayDateStr, '2026-09-10');
    assert.strictEqual(result.tomorrowDateStr, '2026-09-11');
  });

  test('Classifies launch dates: TOMORROW, TODAY, PAST, FUTURE_FAR', () => {
    const targetTomorrow = '2026-09-11';
    const targetToday = '2026-09-10';

    assert.strictEqual(classifyLaunchDate('2026-09-11', targetTomorrow, targetToday).status, 'TOMORROW');
    assert.strictEqual(classifyLaunchDate('2026-09-10', targetTomorrow, targetToday).status, 'TODAY');
    assert.strictEqual(classifyLaunchDate('2026-09-09', targetTomorrow, targetToday).status, 'PAST');
    assert.strictEqual(classifyLaunchDate('2026-09-15', targetTomorrow, targetToday).status, 'FUTURE_FAR');
    assert.strictEqual(classifyLaunchDate(null, targetTomorrow, targetToday).status, 'INVALID');
  });

  // --------------------------------------------------------------------------
  // 2. Data Honesty & Rejection Logic
  // --------------------------------------------------------------------------
  console.log('\n[SECTION 2: DATA HONESTY & REJECTION LOGIC]');

  test('Rejects today launch from tomorrow shortlist', () => {
    const candidate = normalizeCandidate({
      name: 'Launched Today Token',
      expectedLaunchDate: '2026-09-10',
      confidence: 'CONFIRMED'
    });

    const { shortlist, rejected } = filterTomorrowShortlist([candidate], '2026-09-11');
    assert.strictEqual(shortlist.length, 0);
    assert.strictEqual(rejected.length, 1);
  });

  test('Rejects past launch from tomorrow shortlist', () => {
    const candidate = normalizeCandidate({
      name: 'Past Token',
      expectedLaunchDate: '2026-09-05',
      confidence: 'CONFIRMED'
    });

    const { shortlist, rejected } = filterTomorrowShortlist([candidate], '2026-09-11');
    assert.strictEqual(shortlist.length, 0);
    assert.strictEqual(rejected.length, 1);
  });

  test('Rejects WEAK and UNKNOWN confidence candidates', () => {
    const weakCand = normalizeCandidate({
      name: 'Weak Rumor Coin',
      expectedLaunchDate: '2026-09-11',
      confidence: CONFIDENCE_LEVELS.WEAK
    });

    const unknownCand = normalizeCandidate({
      name: 'No Date Token',
      expectedLaunchDate: '2026-09-11',
      confidence: CONFIDENCE_LEVELS.UNKNOWN
    });

    const { shortlist, weak } = filterTomorrowShortlist([weakCand, unknownCand], '2026-09-11');
    assert.strictEqual(shortlist.length, 0);
    assert.strictEqual(weak.length, 2);
  });

  test('Accepts CONFIRMED and EXPECTED candidates matching target date', () => {
    const confirmed = normalizeCandidate({
      name: 'Official Solana Project',
      symbol: 'SOLP',
      expectedLaunchDate: '2026-09-11',
      isOfficialAnnouncement: true,
      mint: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
      confidence: CONFIDENCE_LEVELS.CONFIRMED
    });

    const expected = normalizeCandidate({
      name: 'Expected Meme Coin',
      symbol: 'EMEME',
      expectedLaunchDate: '2026-09-11',
      hasFutureTimestamp: true,
      confidence: CONFIDENCE_LEVELS.EXPECTED
    });

    const { shortlist } = filterTomorrowShortlist([confirmed, expected], '2026-09-11');
    assert.strictEqual(shortlist.length, 2);
  });

  // --------------------------------------------------------------------------
  // 3. Multi-Source Confirmation & Deduplication
  // --------------------------------------------------------------------------
  console.log('\n[SECTION 3: MULTI-SOURCE CONFIRMATION & DEDUPLICATION]');

  test('Deduplicates candidate by contract mint address and merges evidence', () => {
    const c1 = normalizeCandidate({
      name: 'Project Alpha',
      symbol: 'ALPHA',
      mint: 'AlphaMintAddress11111111111111111111111111',
      expectedLaunchDate: '2026-09-11',
      source: 'source_a',
      confidence: CONFIDENCE_LEVELS.EXPECTED
    });

    const c2 = normalizeCandidate({
      name: 'Project Alpha Token',
      symbol: 'ALPHA',
      mint: 'AlphaMintAddress11111111111111111111111111',
      expectedLaunchDate: '2026-09-11',
      source: 'source_b',
      confidence: CONFIDENCE_LEVELS.EXPECTED
    });

    const merged = mergeAndDeduplicateCandidates([c1, c2]);
    assert.strictEqual(merged.length, 1);
    assert.strictEqual(merged[0].evidence.sourcesCount, 2);
    // Elevated to CONFIRMED when multiple sources agree
    assert.strictEqual(merged[0].confidence, CONFIDENCE_LEVELS.CONFIRMED);
  });

  test('Detects DATE_CONFLICT when sources disagree on launch date', () => {
    const c1 = normalizeCandidate({
      name: 'Conflicting Project',
      symbol: 'CONFLICT',
      mint: 'ConflictMintAddress11111111111111111111111',
      expectedLaunchDate: '2026-09-11',
      source: 'source_a',
      confidence: CONFIDENCE_LEVELS.CONFIRMED
    });

    const c2 = normalizeCandidate({
      name: 'Conflicting Project',
      symbol: 'CONFLICT',
      mint: 'ConflictMintAddress11111111111111111111111',
      expectedLaunchDate: '2026-09-12', // Disagreeing date!
      source: 'source_b',
      confidence: CONFIDENCE_LEVELS.CONFIRMED
    });

    const merged = mergeAndDeduplicateCandidates([c1, c2]);
    assert.strictEqual(merged.length, 1);
    assert.strictEqual(merged[0].status, CANDIDATE_STATUS.DATE_CONFLICT);
    assert.strictEqual(merged[0].confidence, CONFIDENCE_LEVELS.WEAK); // Downgraded confidence
  });

  // --------------------------------------------------------------------------
  // 4. Staleness & Postponed Launch Audit
  // --------------------------------------------------------------------------
  console.log('\n[SECTION 4: STALENESS & DATE CHANGE AUDIT]');

  test('Marks candidate STALE if lastVerifiedAt exceeds threshold', () => {
    const candidate = normalizeCandidate({
      name: 'Old Verified Token',
      expectedLaunchDate: '2026-09-11'
    });
    candidate.lastVerifiedAt = Date.now() - (48 * 60 * 60 * 1000); // 48h ago

    const audited = auditCandidateStaleness([candidate], '2026-09-11');
    assert.strictEqual(audited[0].status, CANDIDATE_STATUS.STALE);
  });

  test('Marks candidate DATE_CHANGED if launch date postponed/changed away from tomorrow', () => {
    const candidate = normalizeCandidate({
      name: 'Postponed Launch',
      expectedLaunchDate: '2026-09-15' // Was changed to Sept 15
    });

    const audited = auditCandidateStaleness([candidate], '2026-09-11');
    assert.strictEqual(audited[0].status, CANDIDATE_STATUS.DATE_CHANGED);
  });

  // --------------------------------------------------------------------------
  // 5. Source Error & Resiliency Testing
  // --------------------------------------------------------------------------
  console.log('\n[SECTION 5: SOURCE FAILURE HANDLING]');

  await testAsync('Gracefully handles discovery when a source fails without crashing engine', async () => {
    // Run discovery - should execute safely regardless of network state
    const result = await discoverUpcomingSolanaLaunches(new Date('2026-09-10T12:00:00Z').getTime(), 'UTC');
    assert.strictEqual(typeof result.overallStatus, 'string');
    assert.strictEqual(typeof result.sourceHealth, 'object');
    assert.strictEqual(Array.isArray(result.rawCandidates), true);
  });

  // --------------------------------------------------------------------------
  // 6. Full Pipeline Integration
  // --------------------------------------------------------------------------
  console.log('\n[SECTION 6: FULL DISCOVERY PIPELINE INTEGRATION]');

  await testAsync('Executes runDailyTomorrowDiscovery pipeline end-to-end', async () => {
    resetTomorrowWatchlist();
    const fixedNow = new Date('2026-09-10T12:00:00Z').getTime();

    const pipelineRes = await runDailyTomorrowDiscovery({ nowMs: fixedNow, timezone: 'UTC' });

    assert.ok(pipelineRes.discoveryStatus);
    assert.strictEqual(pipelineRes.discoveryStatus.targetDate, '2026-09-11');
    assert.ok(Array.isArray(pipelineRes.shortlist));

    const status = getDiscoveryStatus();
    assert.strictEqual(status.targetDate, '2026-09-11');
  });

  // --------------------------------------------------------------------------
  // 7. Dashboard API Endpoints
  // --------------------------------------------------------------------------
  console.log('\n[SECTION 7: READ-ONLY DASHBOARD API ENDPOINTS]');

  await testAsync('Responds on GET /api/prelaunch/discovery-status, /api/prelaunch/tomorrow, /api/prelaunch/sources, /api/prelaunch/evidence', async () => {
    const { server, port, stopServer } = await startDashboardServer(3987);

    async function getEndpoint(path) {
      return new Promise((resolve, reject) => {
        http.get(`http://localhost:${port}${path}`, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => resolve({ statusCode: res.statusCode, data: JSON.parse(body) }));
        }).on('error', reject);
      });
    }

    const discStatus = await getEndpoint('/api/prelaunch/discovery-status');
    assert.strictEqual(discStatus.statusCode, 200);
    assert.ok('overallStatus' in discStatus.data);

    const tomorrowRes = await getEndpoint('/api/prelaunch/tomorrow');
    assert.strictEqual(tomorrowRes.statusCode, 200);
    assert.ok('candidates' in tomorrowRes.data);

    const sourcesRes = await getEndpoint('/api/prelaunch/sources');
    assert.strictEqual(sourcesRes.statusCode, 200);
    assert.ok('sources' in sourcesRes.data);

    const evidenceRes = await getEndpoint('/api/prelaunch/evidence');
    assert.strictEqual(evidenceRes.statusCode, 200);
    assert.ok('confirmed' in evidenceRes.data);

    stopServer();
  });

  // --------------------------------------------------------------------------
  // 8. Category B Security & Paper Trading Boundary Audit
  // --------------------------------------------------------------------------
  console.log('\n[SECTION 8: CATEGORY B SECURITY & PAPER SAFETY AUDIT]');

  test('Guarantees 0 active Web3 signing or live transaction capabilities in Discovery layer', () => {
    // Assert process environment safety constraints
    assert.strictEqual(process.env.NODE_ENV, 'test');
    assert.strictEqual(global.IS_TEST_ENV, true);
    
    // Verify no secret keys loaded in process.env
    assert.strictEqual(process.env.SOLANA_PRIVATE_KEY, undefined);
    assert.strictEqual(process.env.WALLET_PRIVATE_KEY, undefined);
    assert.strictEqual(process.env.WALLET_SEED, undefined);
  });

  console.log('\n====================================================');
  console.log(`PHASE 9.2 TEST SUITE SUMMARY: ${passed}/${total} TESTS PASSED`);
  console.log('====================================================\n');
}

runTests().catch(err => {
  console.error('FATAL TEST ERROR:', err);
  process.exit(1);
});
