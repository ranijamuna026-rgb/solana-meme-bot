import assert from 'node:assert';
import { startDashboardServer, stopDashboardServer } from '../src/server.js';
import { recordCandidate, resetCandidateTracker } from '../src/candidateTracker.js';
import { calculatePerformanceAnalytics, parseDurationMs } from '../src/analytics.js';

console.log('====================================================');
console.log('      RUNNING DASHBOARD API AUTOMATED TESTS         ');
console.log('====================================================\n');

let passedTests = 0;
let totalTests = 0;
const TEST_PORT = 3099;
const BASE_URL = `http://localhost:${TEST_PORT}`;

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(`       Error: ${err.message}\n${err.stack}`);
  }
}

// Initialize server before tests
try {
  await startDashboardServer(TEST_PORT);
} catch (err) {
  console.error('[FATAL] Failed to start test API server:', err);
  process.exit(1);
}

try {
  // TEST 1: GET /api/status
  await runAsyncTest('TEST 1: GET /api/status returns valid operational status', async () => {
    const res = await fetch(`${BASE_URL}/api/status`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();

    assert.strictEqual(data.status, 'RUNNING');
    assert.strictEqual(data.mode, 'PAPER TRADING ONLY');
    assert.strictEqual(data.paperTradingActive, true);
    assert.ok(typeof data.uptimeSeconds === 'number');
    assert.ok(data.startTime);
    assert.ok(data.timestamp);
  });

  // TEST 2: GET /api/candidates
  await runAsyncTest('TEST 2: GET /api/candidates returns candidate records', async () => {
    resetCandidateTracker();
    recordCandidate({
      address: 'TEST_ADDRESS_123',
      symbol: 'TEST',
      name: 'Test Candidate',
      priceUsd: 0.001,
      liquidityUsd: 15000,
      volume5mUsd: 8000,
      riskFilter: { result: 'PASS' },
      strategy: { score: 85 },
      riskManager: { approved: true, positionSize: 10 }
    });

    const res = await fetch(`${BASE_URL}/api/candidates`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();

    assert.strictEqual(data.count, 1);
    assert.ok(Array.isArray(data.candidates));
    assert.strictEqual(data.candidates[0].symbol, 'TEST');
    assert.strictEqual(data.candidates[0].address, 'TEST_ADDRESS_123');
  });

  // TEST 3: GET /api/active-trade
  await runAsyncTest('TEST 3: GET /api/active-trade returns idle/active trade state', async () => {
    const res = await fetch(`${BASE_URL}/api/active-trade`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();

    assert.strictEqual(typeof data.active, 'boolean');
  });

  // TEST 4: GET /api/risk
  await runAsyncTest('TEST 4: GET /api/risk returns risk state and limits', async () => {
    const res = await fetch(`${BASE_URL}/api/risk`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();

    assert.strictEqual(typeof data.hourlyTrades, 'number');
    assert.strictEqual(typeof data.dailyTrades, 'number');
    assert.strictEqual(typeof data.dailyPnlUsd, 'number');
    assert.ok(data.limits, 'Risk limit configuration object must exist');
    assert.strictEqual(data.limits.minLiquidityUsd, 10000);
    assert.strictEqual(data.limits.min5mVolumeUsd, 5000);
    assert.strictEqual(data.limits.minStrategyScore, 70);
  });

  // TEST 5: GET /api/trades
  await runAsyncTest('TEST 5: GET /api/trades returns trade history array', async () => {
    const res = await fetch(`${BASE_URL}/api/trades`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();

    assert.strictEqual(typeof data.count, 'number');
    assert.ok(Array.isArray(data.trades));
  });

  // TEST 6: POST /api/buy rejected with 405 Method Not Allowed
  await runAsyncTest('TEST 6: POST requests rejected with 405 Method Not Allowed', async () => {
    const res = await fetch(`${BASE_URL}/api/buy`, { method: 'POST' });
    assert.strictEqual(res.status, 405);
    const data = await res.json();

    assert.strictEqual(data.error, 'Method Not Allowed');
  });

  // TEST 7: OPTIONS preflight returned with CORS headers
  await runAsyncTest('TEST 7: OPTIONS preflight returns 204 No Content', async () => {
    const res = await fetch(`${BASE_URL}/api/status`, { method: 'OPTIONS' });
    assert.strictEqual(res.status, 204);
  });

  // TEST 8: Invalid 404 endpoint returns safe error
  await runAsyncTest('TEST 8: Unknown endpoint returns 404 Not Found', async () => {
    const res = await fetch(`${BASE_URL}/api/unknown-endpoint`);
    assert.strictEqual(res.status, 404);
  });

  // TEST 9: GET /api/performance returns performance analytics
  await runAsyncTest('TEST 9: GET /api/performance returns valid paper performance analytics', async () => {
    const res = await fetch(`${BASE_URL}/api/performance`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();

    assert.strictEqual(data.mode, 'PAPER TRADING ONLY');
    assert.strictEqual(typeof data.totalTrades, 'number');
    assert.strictEqual(typeof data.winRatePercent, 'number');
    assert.ok(data.exitReasonBreakdown, 'exitReasonBreakdown object must exist');
    assert.ok(data.dataQuality, 'dataQuality object must exist');
  });

  // TEST 10: POST /api/performance rejected with 405
  await runAsyncTest('TEST 10: POST /api/performance rejected with 405 Method Not Allowed', async () => {
    const res = await fetch(`${BASE_URL}/api/performance`, { method: 'POST' });
    assert.strictEqual(res.status, 405);
    const data = await res.json();
    assert.strictEqual(data.error, 'Method Not Allowed');
  });

  // TEST 11: Duration parsing (12:00:00 to 12:02:30 -> 150 seconds)
  await runAsyncTest('TEST 11: Duration parsing (12:00:00 to 12:02:30 -> 150s / 2m 30s)', async () => {
    const trade = { entryTime: '2026-09-01T12:00:00Z', exitTime: '2026-09-01T12:02:30Z' };
    const ms = parseDurationMs(trade);
    assert.strictEqual(ms, 150000);
    assert.strictEqual(ms / 1000, 150);
  });

  // TEST 12: Duration parsing (12:00:00 to 12:05:00 -> 300 seconds)
  await runAsyncTest('TEST 12: Duration parsing (12:00:00 to 12:05:00 -> 300s / 5m 00s)', async () => {
    const trade = { entryTime: '2026-09-01T12:00:00Z', exitTime: '2026-09-01T12:05:00Z' };
    const ms = parseDurationMs(trade);
    assert.strictEqual(ms, 300000);
    assert.strictEqual(ms / 1000, 300);
  });

  // TEST 13: Duration parsing (identical timestamps -> 0 seconds)
  await runAsyncTest('TEST 13: Duration parsing (identical entry and exit timestamps -> 0s)', async () => {
    const trade = { entryTime: '2026-09-01T12:00:00Z', exitTime: '2026-09-01T12:00:00Z' };
    const ms = parseDurationMs(trade);
    assert.strictEqual(ms, 0);
  });

  // TEST 14: Duration parsing (malformed timestamps -> safe handling without NaN/Infinity)
  await runAsyncTest('TEST 14: Duration parsing (malformed timestamps handled safely without NaN/Infinity)', async () => {
    const trade = { entryTime: 'INVALID_STAMP', exitTime: 'INVALID_STAMP_2', pnl: 0.5 };
    const analytics = calculatePerformanceAnalytics([trade]);
    assert.strictEqual(analytics.totalTrades, 1);
    assert.ok(!isNaN(analytics.averageHoldTimeMs) && isFinite(analytics.averageHoldTimeMs));
    assert.strictEqual(analytics.averageHoldTimeStr, '00m 00s');
  });

  // TEST 15: Duration parsing (missing timestamps -> safe handling according to data-quality rules)
  await runAsyncTest('TEST 15: Duration parsing (missing timestamps handled safely)', async () => {
    const trade = { pnl: 0.5 };
    const analytics = calculatePerformanceAnalytics([trade]);
    assert.strictEqual(analytics.totalTrades, 1);
    assert.strictEqual(analytics.averageHoldTimeStr, '00m 00s');
  });
} finally {
  stopDashboardServer();
}

console.log('\n====================================================');
console.log(` TEST SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
console.log('====================================================\n');

if (passedTests !== totalTests) {
  process.exit(1);
}
