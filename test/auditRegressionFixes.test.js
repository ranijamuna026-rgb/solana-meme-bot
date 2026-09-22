// ============================================================================
// AUDIT REGRESSION FIXES TEST SUITE (test/auditRegressionFixes.test.js)
// Purpose: Verifies fixes for P&L anomaly, undefined scores, trade counts, and SL overshoot
// ============================================================================

import assert from 'node:assert';
import { isGenuineMarketTrade, processMonitoringCycle, resetTradeState, executePaperTrade, executePaperSell, getTradeHistory } from '../src/paperTrader.js';
import { calculatePerformanceAnalytics } from '../src/analytics.js';
import { evaluateTokenRisk } from '../src/riskFilter.js';
import { evaluateTradeRisk, calculateRiskScore } from '../src/riskManager.js';
import { recordCandidate, getCandidates, resetCandidateTracker } from '../src/candidateTracker.js';
import { config } from '../src/config.js';

// Assert test environment lock
global.IS_TEST_ENV = true;

console.log('====================================================');
console.log('    RUNNING AUDIT REGRESSION FIXES TEST SUITE       ');
console.log('====================================================\n');

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    resetTradeState();
    resetCandidateTracker();
    fn();
    console.log(`[PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(`       Error: ${err.message}\n${err.stack}`);
  }
}

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    resetTradeState();
    resetCandidateTracker();
    await fn();
    console.log(`[PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(`       Error: ${err.message}\n${err.stack}`);
  }
}

// --------------------------------------------------------------------------
// 1. ISSUE 1 REGRESSION: P&L ANOMALY & DATA SANITY
// --------------------------------------------------------------------------
runTest('1.1 isGenuineMarketTrade excludes corrupted high-P&L outlier records', () => {
  const corruptedTrade = {
    tradeId: 'PT-999999',
    symbol: 'wardog',
    tokenAddress: 'DFMZUn2Bg6u29LzM2rVapKDjWoCt216JArpjNMER8saE',
    entryPrice: 0.00007407,
    exitPrice: 680.689,
    quantity: 135007.42,
    investment: 10,
    pnl: 91898064.35,
    pnlPercent: 918980643.5,
    source: 'market_data'
  };

  assert.strictEqual(isGenuineMarketTrade(corruptedTrade), false);
});

runTest('1.2 isGenuineMarketTrade accepts normal real market paper trades', () => {
  const validTrade = {
    tradeId: 'PT-000001',
    symbol: 'BOF',
    tokenAddress: '2TyuHXqPL9CKPcLnP8NPjpizmePESMZP6nnewL7ZG1y3',
    entryPrice: 0.00002809,
    exitPrice: 0.00002949,
    quantity: 355998.57,
    investment: 10,
    pnl: 0.50,
    pnlPercent: 5.0,
    source: 'market_data'
  };

  assert.strictEqual(isGenuineMarketTrade(validTrade), true);
});

runTest('1.3 calculatePerformanceAnalytics produces realistic statistics on clean genuine trade data', () => {
  const genuineTrades = [
    { tradeId: 'PT-001', symbol: 'BOF', entryPrice: 1.0, exitPrice: 1.05, pnl: 0.50, pnlPercent: 5.0, exitReason: 'TAKE_PROFIT', source: 'market_data' },
    { tradeId: 'PT-002', symbol: 'CLCTV', entryPrice: 1.0, exitPrice: 0.96, pnl: -0.40, pnlPercent: -4.0, exitReason: 'STOP_LOSS', source: 'market_data' },
    { tradeId: 'PT-003', symbol: 'BITCAT', entryPrice: 1.0, exitPrice: 1.05, pnl: 0.50, pnlPercent: 5.0, exitReason: 'TAKE_PROFIT', source: 'market_data' }
  ];

  const analytics = calculatePerformanceAnalytics(genuineTrades, 1000);

  assert.strictEqual(analytics.totalTrades, 3);
  assert.strictEqual(analytics.winningTrades, 2);
  assert.strictEqual(analytics.losingTrades, 1);
  assert.strictEqual(analytics.netPnlUsd, 0.60);
  assert.strictEqual(analytics.averageTradeUsd, 0.20);
  assert.strictEqual(analytics.largestWinUsd, 0.50);
  assert.strictEqual(analytics.largestLossUsd, -0.40);
  assert.strictEqual(analytics.profitFactorDisplay, '2.50');
});

// --------------------------------------------------------------------------
// 2. ISSUE 2 REGRESSION: SCORE COMPLETENESS & UNDEFINED SCORE PREVENTION
// --------------------------------------------------------------------------
runTest('2.1 evaluateTokenRisk includes valid numeric riskScore and riskRating', () => {
  const mockToken = {
    address: '2TyuHXqPL9CKPcLnP8NPjpizmePESMZP6nnewL7ZG1y3',
    symbol: 'SAFE',
    name: 'Safe Token',
    priceUsd: 0.0001,
    liquidityUsd: 25000,
    volume5mUsd: 15000,
    buys5m: 20,
    sells5m: 10,
    ageMinutes: 20
  };

  const riskResult = evaluateTokenRisk(mockToken);
  assert.strictEqual(riskResult.isCandidate, true);
  assert.strictEqual(typeof riskResult.riskScore, 'number');
  assert.ok(riskResult.riskScore >= 0 && riskResult.riskScore <= 100);
  assert.strictEqual(typeof riskResult.riskRating, 'string');
});

runTest('2.2 evaluateTradeRisk rejects candidate with missing/undefined strategy score', () => {
  const mockToken = {
    address: '2TyuHXqPL9CKPcLnP8NPjpizmePESMZP6nnewL7ZG1y3',
    symbol: 'NOSTRAT',
    priceUsd: 0.0001,
    liquidityUsd: 25000,
    volume5mUsd: 15000
  };

  const decision = evaluateTradeRisk(mockToken, null);

  assert.strictEqual(decision.approved, false);
  assert.ok(decision.reasons.includes('Missing or invalid strategy score'));
});

runTest('2.3 recordCandidate normalizes top-level riskScore, strategyScore, and decision fields', () => {
  const mockCandidate = {
    address: '2TyuHXqPL9CKPcLnP8NPjpizmePESMZP6nnewL7ZG1y3',
    symbol: 'TEST1',
    name: 'Test Token 1',
    priceUsd: 0.0001,
    liquidityUsd: 25000,
    volume5mUsd: 15000,
    strategy: { totalScore: 85, status: 'CANDIDATE' },
    riskManager: { approved: true, riskScore: 15, reasons: [] }
  };

  recordCandidate(mockCandidate);

  const candidates = getCandidates();
  assert.strictEqual(candidates.length, 1);
  const recorded = candidates[0];

  assert.strictEqual(typeof recorded.riskScore, 'number');
  assert.strictEqual(recorded.riskScore, 15);
  assert.strictEqual(typeof recorded.strategyScore, 'number');
  assert.strictEqual(recorded.strategyScore, 85);
  assert.strictEqual(recorded.decision, 'APPROVED');
});

runTest('2.4 recordCandidate prevents APPROVED decision if scores are missing or invalid', () => {
  const invalidCandidate = {
    address: '2TyuHXqPL9CKPcLnP8NPjpizmePESMZP6nnewL7ZG1y3',
    symbol: 'BAD',
    priceUsd: 0.0001,
    decision: 'APPROVED',
    riskManager: { approved: true }
  };

  recordCandidate(invalidCandidate);

  const candidates = getCandidates();
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].decision, 'REJECTED');
});

// --------------------------------------------------------------------------
// 3. ISSUE 3 REGRESSION: TRADE COUNT SEMANTICS
// --------------------------------------------------------------------------
runTest('3.1 isGenuineMarketTrade correctly segregates unit test trades from market trades', () => {
  const unitTestTrade = { symbol: 'TEST_TP', source: 'unit_test', entryPrice: 100, exitPrice: 105, pnl: 0.5 };
  const marketTrade = { symbol: 'SOLMEME', source: 'market_data', entryPrice: 0.001, exitPrice: 0.00105, pnl: 0.5 };

  assert.strictEqual(isGenuineMarketTrade(unitTestTrade), false);
  assert.strictEqual(isGenuineMarketTrade(marketTrade), true);
});

// --------------------------------------------------------------------------
// 4. ISSUE 4 REGRESSION: STOP-LOSS / TAKE-PROFIT OVERSHOOT MODELING
// --------------------------------------------------------------------------
await runAsyncTest('4.1 Stop loss exit executes at configured SL threshold price when market price drops sharply', async () => {
  const mockToken = {
    address: 'TEST_TOKEN_SL_GAP',
    symbol: 'SL_GAP',
    name: 'SL Gap Token',
    priceUsd: 100.0
  };

  const tradeRecord = await executePaperTrade(mockToken, async () => ({ priceUsd: 50.0 }));

  // Trigger monitoring tick with gap-down price ($50.0)
  await processMonitoringCycle(tradeRecord, async () => ({ priceUsd: 50.0 }));

  const history = getTradeHistory();
  const lastTrade = history[history.length - 1];

  assert.strictEqual(lastTrade.exitReason, 'STOP_LOSS');
  // Exit price must be modeled at SL threshold (-3% plus 1% max slippage = -4% -> $96.00), NOT extreme gap down $50.00
  assert.strictEqual(lastTrade.exitPrice, 96.0);
  assert.strictEqual(lastTrade.pnlPercent, -4.0);
});

console.log(`\n====================================================`);
console.log(`AUDIT REGRESSION FIXES SUMMARY: ${passedTests} / ${totalTests} PASSED`);
console.log(`====================================================\n`);

if (passedTests !== totalTests) {
  process.exit(1);
}
