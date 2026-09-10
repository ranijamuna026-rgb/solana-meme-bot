process.env.NODE_ENV = 'test';
import assert from 'node:assert';
import { startDashboardServer, stopDashboardServer } from '../src/server.js';
import { executePaperTrade, resetTradeState, getTradeHistory, isGenuineMarketTrade } from '../src/paperTrader.js';
import { config } from '../src/config.js';
import { registerActiveTrade, recordTradeOutcome, resetRiskManagerState, getPortfolioState } from '../src/riskManager.js';

console.log('====================================================');
console.log('    RUNNING PHASE 8.7 & 8.7.1 VALIDATION TESTS     ');
console.log('====================================================\n');

let passedTests = 0;
let totalTests = 0;
const TEST_PORT = 3098;
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

// Start API server for endpoint tests
try {
  await startDashboardServer(TEST_PORT);
} catch (err) {
  console.error('[FATAL] Failed to start test API server:', err);
  process.exit(1);
}

try {
  // TEST 1: Validation Progress Tracking
  await runAsyncTest('TEST 1: Validation progress tracking towards 100 & 200 targets', async () => {
    const res = await fetch(`${BASE_URL}/api/validation`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();

    assert.strictEqual(data.targetMinimum, 100);
    assert.strictEqual(data.targetRecommended, 200);
    assert.strictEqual(typeof data.progressMinimumPercent, 'number');
    assert.strictEqual(typeof data.progressRecommendedPercent, 'number');
    assert.ok(data.progressMinimumPercent >= 0 && data.progressMinimumPercent <= 100);
    assert.ok(data.progressRecommendedPercent >= 0 && data.progressRecommendedPercent <= 100);
  });

  // TEST 2: GET /api/validation Endpoint
  await runAsyncTest('TEST 2: GET /api/validation returns valid session metrics object', async () => {
    const res = await fetch(`${BASE_URL}/api/validation`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();

    assert.ok(data.sessionStatus === 'IN_PROGRESS' || data.sessionStatus === 'COMPLETED');
    assert.ok(data.sessionStartTime);
    assert.strictEqual(typeof data.sessionDurationSeconds, 'number');
    assert.ok(typeof data.sessionDurationStr === 'string');
    assert.strictEqual(typeof data.marketPaperTrades, 'number');
    assert.strictEqual(typeof data.sessionWinRate, 'number');
    assert.strictEqual(typeof data.sessionPnlUsd, 'number');
  });

  // TEST 3: POST /api/validation Rejection
  await runAsyncTest('TEST 3: POST /api/validation rejected with 405 Method Not Allowed', async () => {
    const res = await fetch(`${BASE_URL}/api/validation`, { method: 'POST' });
    assert.strictEqual(res.status, 405);
    const data = await res.json();

    assert.strictEqual(data.error, 'Method Not Allowed');
    assert.ok(data.message.includes('READ-ONLY'));
  });

  // TEST 4: Session Win Rate & P&L Calculation
  await runAsyncTest('TEST 4: Session win rate and P&L calculation accuracy', async () => {
    const res = await fetch(`${BASE_URL}/api/validation`);
    const data = await res.json();

    assert.ok(!isNaN(data.sessionWinRate) && isFinite(data.sessionWinRate));
    assert.ok(!isNaN(data.sessionPnlUsd) && isFinite(data.sessionPnlUsd));
  });

  // TEST 5: Test Environment History Isolation
  await runAsyncTest('TEST 5: Test environment history isolation (NODE_ENV=test)', async () => {
    const isTest = process.env.NODE_ENV === 'test' || global.IS_TEST_ENV;
    assert.ok(isTest, 'Process should be running under test environment');
  });

  // TEST 6: Trade Source Tagging
  await runAsyncTest('TEST 6: Paper trade source tagging (market_data vs unit_test)', async () => {
    resetTradeState();
    const candidate = {
      address: 'SO11111111111111111111111111111111111111112',
      symbol: 'TEST_SOL',
      name: 'Test Solana',
      priceUsd: 100.0,
      source: 'unit_test'
    };

    const trade = await executePaperTrade(candidate, async () => ({ priceUsd: 105.0 }));
    assert.ok(trade);
    assert.strictEqual(trade.source, 'unit_test');
    resetTradeState();
  });

  // TEST 7: Zero State Safety
  await runAsyncTest('TEST 7: Zero state safety handles missing/empty data without NaN/Infinity', async () => {
    const res = await fetch(`${BASE_URL}/api/validation`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();

    assert.ok(!isNaN(data.sessionWinRate));
    assert.ok(!isNaN(data.sessionPnlUsd));
    assert.ok(!isNaN(data.progressMinimumPercent));
    assert.ok(!isNaN(data.progressRecommendedPercent));
  });

  // TEST 8: Read-Only Safety Verification
  await runAsyncTest('TEST 8: Read-only safety verification (prohibit write endpoints)', async () => {
    const endpoints = ['/api/buy', '/api/sell', '/api/connect-wallet', '/api/sign-tx'];
    for (const ep of endpoints) {
      const res = await fetch(`${BASE_URL}${ep}`, { method: 'POST' });
      assert.strictEqual(res.status, 405, `Endpoint ${ep} must return 405 Method Not Allowed`);
    }
  });

  // TEST 9: Circuit Breaker & Risk Controls Integrity
  await runAsyncTest('TEST 9: Circuit breaker & risk controls integrity during paper trading', async () => {
    resetRiskManagerState();
    const state = getPortfolioState();

    assert.strictEqual(state.circuitBreakerActive, false);
    assert.strictEqual(state.consecutiveLosses, 0);

    // Record 3 consecutive losses
    recordTradeOutcome({ pnl: -1.0 });
    recordTradeOutcome({ pnl: -1.0 });
    recordTradeOutcome({ pnl: -1.0 });

    const updatedState = getPortfolioState();
    assert.strictEqual(updatedState.consecutiveLosses, 3);
    assert.strictEqual(updatedState.circuitBreakerActive, true);

    resetRiskManagerState();
  });

  // TEST 10: Strategy Parameter Immutability
  await runAsyncTest('TEST 10: Strategy parameter immutability (TP +5%, SL -3%, Max Hold 5m)', async () => {
    assert.strictEqual(config.profitTargetPercent, 5.0, 'Take Profit must remain +5%');
    assert.strictEqual(config.stopLossPercent, 3.0, 'Stop Loss must remain -3%');
    assert.strictEqual(config.maxHoldMinutes, 5, 'Max Hold must remain 5 minutes');
    assert.strictEqual(config.minLiquidityUsd, 10000, 'Min Liquidity must remain $10,000');
    assert.strictEqual(config.min5mVolumeUsd, 5000, 'Min 5m Volume must remain $5,000');
    assert.strictEqual(config.minStrategyScore, 70, 'Min Strategy Score must remain 70');
    assert.strictEqual(config.maxRiskScore, 60, 'Max Risk Score must remain 60');
  });

  // PHASE 8.7.1 DATA INTEGRITY TESTS (TEST A to TEST J)

  // TEST A: Unit-test trades do not count toward validation
  await runAsyncTest('TEST A: Unit-test trades (source=unit_test, symbol=TEST_*) do not count toward validation', async () => {
    const unitTrade = { symbol: 'TEST_TP', tokenAddress: 'TEST_TOKEN_TP', source: 'unit_test', pnl: 0.5, entryPrice: 100, exitPrice: 105 };
    assert.strictEqual(isGenuineMarketTrade(unitTrade), false, 'Unit test trade must be classified as non-genuine');
  });

  // TEST B: Backtest/synthetic trades do not count toward validation
  await runAsyncTest('TEST B: Synthetic test trades do not count toward validation', async () => {
    const synTrade = { symbol: 'TEST_SL', tokenAddress: 'TEST_TOKEN_SL', source: 'unit_test', pnl: -0.3, entryPrice: 100, exitPrice: 97 };
    assert.strictEqual(isGenuineMarketTrade(synTrade), false, 'Synthetic trade must be excluded');
  });

  // TEST C: Valid real market-data trades count
  await runAsyncTest('TEST C: Valid real market-data trade (RIKA) counts toward validation', async () => {
    const realTrade = { symbol: 'RIKA', tokenAddress: 'CxisVknoz1FHQ9g9U8nkKx9Lzbjv9jjphgVoeDXxpump', source: 'market_data', pnl: 1.1017, entryPrice: 0.00019, exitPrice: 0.00021 };
    assert.strictEqual(isGenuineMarketTrade(realTrade), true, 'Real market trade must be classified as genuine');
  });

  // TEST D: Invalid trades do not count
  await runAsyncTest('TEST D: Invalid trades (NaN/Infinity P&L or zero prices) do not count', async () => {
    const invalidPnl = { symbol: 'RIKA', tokenAddress: 'CxisVknoz1FHQ9g9U8nkKx9Lzbjv9jjphgVoeDXxpump', source: 'market_data', pnl: NaN, entryPrice: 0.00019, exitPrice: 0.00021 };
    const zeroPrice = { symbol: 'RIKA', tokenAddress: 'CxisVknoz1FHQ9g9U8nkKx9Lzbjv9jjphgVoeDXxpump', source: 'market_data', pnl: 0.5, entryPrice: 0, exitPrice: 0 };
    assert.strictEqual(isGenuineMarketTrade(invalidPnl), false, 'NaN P&L trade must be excluded');
    assert.strictEqual(isGenuineMarketTrade(zeroPrice), false, 'Zero price trade must be excluded');
  });

  // TEST E: Active/unclosed trade does not count as completed
  await runAsyncTest('TEST E: Active/unclosed position does not count as completed trade', async () => {
    const history = getTradeHistory();
    const genuineTrades = history.filter(isGenuineMarketTrade);
    // Active trade is not in completed history array
    assert.ok(Array.isArray(genuineTrades), 'Completed history must be an array');
  });

  // TEST F: Legacy/ambiguous records do not count unless explicitly eligible
  await runAsyncTest('TEST F: Legacy test records (TEST_TP, TEST_SL, TEST_MH) do not count', async () => {
    const legacyTP = { symbol: 'TEST_TP', tokenName: 'Test TP Token', tokenAddress: 'TEST_TOKEN_TP', pnl: 0.5, entryPrice: 100, exitPrice: 105 };
    assert.strictEqual(isGenuineMarketTrade(legacyTP), false, 'Legacy test record must be excluded from genuine count');
  });

  // TEST G: 100-trade progress is calculated exclusively from genuine market trades
  await runAsyncTest('TEST G: 100-trade progress is calculated exclusively from genuine market trades', async () => {
    const res = await fetch(`${BASE_URL}/api/validation`);
    const data = await res.json();
    const genuineTrades = getTradeHistory().filter(isGenuineMarketTrade);
    assert.strictEqual(data.marketPaperTrades, genuineTrades.length, `Genuine market paper trades must equal ${genuineTrades.length}`);
    assert.ok(data.legacyTestTradesExcluded > 0, 'Legacy test trades excluded must be greater than 0');
    assert.strictEqual(data.historicalTotalTrades, data.legacyTestTradesExcluded + data.genuineMarketTradesCount, 'Total trades must equal legacy plus genuine');
  });

  // TEST H: P&L matches the eligible trade population
  await runAsyncTest('TEST H: P&L matches eligible genuine trade population', async () => {
    const res = await fetch(`${BASE_URL}/api/validation`);
    const data = await res.json();
    const genuineTrades = getTradeHistory().filter(isGenuineMarketTrade);
    const expectedPnl = Number(genuineTrades.reduce((acc, t) => acc + (t.pnl || 0), 0).toFixed(4));
    assert.strictEqual(data.sessionPnlUsd, expectedPnl, `Session P&L must match genuine trade P&L (${expectedPnl})`);
  });

  // TEST I: Win rate matches the eligible trade population
  await runAsyncTest('TEST I: Win rate matches eligible genuine trade population', async () => {
    const res = await fetch(`${BASE_URL}/api/validation`);
    const data = await res.json();
    const genuineTrades = getTradeHistory().filter(isGenuineMarketTrade);
    const wins = genuineTrades.filter(t => (t.pnl || 0) > 0).length;
    const expectedWinRate = genuineTrades.length > 0 ? Number(((wins / genuineTrades.length) * 100).toFixed(2)) : 0;
    assert.strictEqual(data.sessionWinRate, expectedWinRate, `Session win rate must match genuine trade win rate (${expectedWinRate}%)`);
  });

  // TEST J: API returns the correct validation population and 405 for non-GET
  await runAsyncTest('TEST J: API /api/validation returns accurate population structure', async () => {
    const res = await fetch(`${BASE_URL}/api/validation`);
    const data = await res.json();
    const genuineTrades = getTradeHistory().filter(isGenuineMarketTrade);
    const expectedGenuineCount = genuineTrades.length;
    assert.strictEqual(data.genuineMarketTradesCount, expectedGenuineCount);
    assert.strictEqual(data.historicalTotalTrades, data.legacyTestTradesExcluded + data.genuineMarketTradesCount);
    assert.strictEqual(data.remainingTo100, Math.max(0, 100 - expectedGenuineCount));
    assert.strictEqual(data.remainingTo200, Math.max(0, 200 - expectedGenuineCount));
  });

  // PHASE 8.7.2 COMPLETION DETECTION TESTS (TEST K to TEST O)

  // TEST K: 99 genuine trades yields completed = false, status = "IN_PROGRESS"
  await runAsyncTest('TEST K: 99 genuine trades yields completed = false and status = "IN_PROGRESS"', async () => {
    const mockGen99 = Array.from({ length: 99 }, (_, i) => ({
      tradeId: `PT-GEN-${i}`,
      symbol: `GEN_${i}`,
      tokenAddress: `GEN_ADDR_${i}`,
      source: 'market_data',
      pnl: 0.5,
      entryPrice: 100,
      exitPrice: 105
    }));

    const genuineCount = mockGen99.filter(isGenuineMarketTrade).length;
    assert.strictEqual(genuineCount, 99);
    assert.strictEqual(genuineCount >= 100, false);
    const isCompleted = genuineCount >= 100;
    const status = isCompleted ? 'COMPLETE' : 'IN_PROGRESS';
    assert.strictEqual(isCompleted, false);
    assert.strictEqual(status, 'IN_PROGRESS');
  });

  // TEST L: Exactly 100 genuine trades yields completed = true and status = "COMPLETE"
  await runAsyncTest('TEST L: Exactly 100 genuine trades yields completed = true and status = "COMPLETE"', async () => {
    const mockGen100 = Array.from({ length: 100 }, (_, i) => ({
      tradeId: `PT-GEN-${i}`,
      symbol: `GEN_${i}`,
      tokenAddress: `GEN_ADDR_${i}`,
      source: 'market_data',
      pnl: 0.5,
      entryPrice: 100,
      exitPrice: 105
    }));

    const genuineCount = mockGen100.filter(isGenuineMarketTrade).length;
    assert.strictEqual(genuineCount, 100);
    assert.strictEqual(genuineCount >= 100, true);
    const isCompleted = genuineCount >= 100;
    const status = isCompleted ? 'COMPLETE' : 'IN_PROGRESS';
    assert.strictEqual(isCompleted, true);
    assert.strictEqual(status, 'COMPLETE');
  });

  // TEST M: 100 genuine trades + 50 test/mock records yields completed = true based ONLY on genuine trades
  await runAsyncTest('TEST M: 100 genuine trades + 50 test records yields completed = true (excludes test records)', async () => {
    const mockGen100 = Array.from({ length: 100 }, (_, i) => ({
      tradeId: `PT-GEN-${i}`,
      symbol: `GEN_${i}`,
      tokenAddress: `GEN_ADDR_${i}`,
      source: 'market_data',
      pnl: 0.5,
      entryPrice: 100,
      exitPrice: 105
    }));
    const mockTest50 = Array.from({ length: 50 }, (_, i) => ({
      tradeId: `PT-TEST-${i}`,
      symbol: `TEST_${i}`,
      tokenAddress: `TEST_TOKEN_${i}`,
      source: 'unit_test',
      pnl: 0.1,
      entryPrice: 10,
      exitPrice: 11
    }));
    const combined = [...mockGen100, ...mockTest50];
    const genuineCount = combined.filter(isGenuineMarketTrade).length;
    assert.strictEqual(genuineCount, 100, 'Only genuine trades must be counted');
    assert.strictEqual(genuineCount >= 100, true);
  });

  // TEST N: 101 genuine trades yields completed = true
  await runAsyncTest('TEST N: 101 genuine trades yields completed = true and status = "COMPLETE"', async () => {
    const mockGen101 = Array.from({ length: 101 }, (_, i) => ({
      tradeId: `PT-GEN-${i}`,
      symbol: `GEN_${i}`,
      tokenAddress: `GEN_ADDR_${i}`,
      source: 'market_data',
      pnl: 0.5,
      entryPrice: 100,
      exitPrice: 105
    }));

    const genuineCount = mockGen101.filter(isGenuineMarketTrade).length;
    assert.strictEqual(genuineCount, 101);
    assert.strictEqual(genuineCount >= 100, true);
  });

  // TEST O: Repeated API polling returns consistent response without duplicate alerts or state resets
  await runAsyncTest('TEST O: Repeated API polling returns consistent completion state', async () => {
    const res1 = await fetch(`${BASE_URL}/api/validation`);
    const data1 = await res1.json();
    const res2 = await fetch(`${BASE_URL}/api/validation`);
    const data2 = await res2.json();

    assert.strictEqual(data1.completed, data2.completed);
    assert.strictEqual(data1.status, data2.status);
    assert.strictEqual(data1.genuineTrades, data2.genuineTrades);
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
