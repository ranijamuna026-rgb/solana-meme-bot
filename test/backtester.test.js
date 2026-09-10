import assert from 'node:assert';
import { runBacktest } from '../src/backtester.js';
import { calculatePerformanceAnalytics } from '../src/analytics.js';
import { validateBacktestData } from '../src/dataValidator.js';

console.log('====================================================');
console.log('       RUNNING BACKTESTER AUTOMATED TESTS           ');
console.log('====================================================\n');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(`       Error: ${err.message}\n${err.stack}`);
  }
}

// TEST A: Take Profit (+5%) Trigger
runTest('TEST A: Take Profit (+5%) Trigger', () => {
  const data = [
    { timestamp: '2026-09-09T04:00:00Z', token: 'T_A', price: 100 },
    { timestamp: '2026-09-09T04:00:10Z', token: 'T_A', price: 105 }
  ];
  const result = runBacktest(data);
  assert.strictEqual(result.trades.length, 1);
  const t = result.trades[0];
  assert.strictEqual(t.exitReason, 'TAKE_PROFIT');
  assert.strictEqual(t.pnlPercent, 5);
  assert.strictEqual(t.pnl, 0.5);
});

// TEST B: Stop Loss (-3%) Trigger
runTest('TEST B: Stop Loss (-3%) Trigger', () => {
  const data = [
    { timestamp: '2026-09-09T04:00:00Z', token: 'T_B', price: 100 },
    { timestamp: '2026-09-09T04:00:10Z', token: 'T_B', price: 97 }
  ];
  const result = runBacktest(data);
  assert.strictEqual(result.trades.length, 1);
  const t = result.trades[0];
  assert.strictEqual(t.exitReason, 'STOP_LOSS');
  assert.strictEqual(t.pnlPercent, -3);
  assert.ok(Math.abs(t.pnl - (-0.3)) < 1e-5);
});

// TEST C: Maximum Hold Time (5 Minutes) Trigger
runTest('TEST C: Maximum Hold Time (5 Minutes) Trigger', () => {
  const data = [
    { timestamp: '2026-09-09T04:00:00Z', token: 'T_C', price: 100 },
    { timestamp: '2026-09-09T04:02:00Z', token: 'T_C', price: 101 },
    { timestamp: '2026-09-09T04:05:01Z', token: 'T_C', price: 102 }
  ];
  const result = runBacktest(data);
  assert.strictEqual(result.trades.length, 1);
  const t = result.trades[0];
  assert.strictEqual(t.exitReason, 'MAX_HOLD_TIME');
  assert.strictEqual(t.pnlPercent, 2);
  assert.strictEqual(t.pnl, 0.2);
});

// TEST D: Multiple Tokens (Isolated Per Token)
runTest('TEST D: Multiple Tokens Isolation', () => {
  const data = [
    { timestamp: '2026-09-09T04:00:00Z', token: 'TOKEN_1', price: 100 },
    { timestamp: '2026-09-09T04:00:05Z', token: 'TOKEN_1', price: 106 },
    { timestamp: '2026-09-09T04:00:00Z', token: 'TOKEN_2', price: 50 },
    { timestamp: '2026-09-09T04:00:05Z', token: 'TOKEN_2', price: 48.5 }
  ];
  const result = runBacktest(data);
  assert.strictEqual(result.trades.length, 2);
  const t1 = result.trades.find(t => t.symbol === 'TOKEN_1');
  const t2 = result.trades.find(t => t.symbol === 'TOKEN_2');
  assert.ok(t1 && t2, 'Both token trades must exist');
  assert.strictEqual(t1.exitReason, 'TAKE_PROFIT');
  assert.strictEqual(t2.exitReason, 'STOP_LOSS');
});

// TEST E: No Valid Data (Graceful Failure)
runTest('TEST E: No Valid Data Graceful Failure', () => {
  const result = runBacktest([]);
  assert.strictEqual(result.trades.length, 0);
  const analytics = calculatePerformanceAnalytics(result.trades);
  assert.strictEqual(analytics.totalTrades, 0);
  assert.strictEqual(analytics.netPnlUsd, 0);
  assert.strictEqual(analytics.profitFactor, 0);
});

// TEST F: Invalid Price Rejection
runTest('TEST F: Invalid Price Record Rejection', () => {
  const data = [
    { timestamp: '2026-09-09T04:00:00Z', token: 'BAD_P', price: -10 },
    { timestamp: '2026-09-09T04:00:05Z', token: 'BAD_P', price: 0 },
    { timestamp: '2026-09-09T04:00:10Z', token: 'BAD_P', price: NaN }
  ];
  const validation = validateBacktestData(data);
  assert.strictEqual(validation.validRecordsCount, 0);
  assert.strictEqual(validation.rejectedCount, 3);
  assert.ok(validation.warnings.length >= 3);
});

// TEST G: Profit Factor Zero Losses Safety
runTest('TEST G: Profit Factor Zero Losses Safety', () => {
  const trades = [
    { pnl: 0.5, exitReason: 'TAKE_PROFIT' },
    { pnl: 1.0, exitReason: 'TAKE_PROFIT' }
  ];
  const analytics = calculatePerformanceAnalytics(trades);
  assert.strictEqual(analytics.losingTrades, 0);
  assert.strictEqual(analytics.grossLossUsd, 0);
  assert.strictEqual(analytics.grossProfitUsd, 1.5);
  assert.strictEqual(analytics.profitFactor, 1.5, 'Profit factor with 0 losses should equal gross profit');
  assert.ok(!isNaN(analytics.profitFactor) && isFinite(analytics.profitFactor), 'Profit factor must not be NaN or Infinity');
});

// TEST H: Maximum Drawdown Calculation
runTest('TEST H: Maximum Drawdown Calculation', () => {
  const trades = [
    { pnl: 10, exitTime: 'T1' },   // Equity: $1010 (Peak: 1010)
    { pnl: -20, exitTime: 'T2' },  // Equity: $990  (Drawdown: $20 / 1.98%)
    { pnl: -10, exitTime: 'T3' },  // Equity: $980  (Drawdown: $30 / 2.97%)
    { pnl: 50, exitTime: 'T4' }    // Equity: $1030 (New Peak)
  ];
  const analytics = calculatePerformanceAnalytics(trades, 1000);
  assert.strictEqual(analytics.maxDrawdownUsd, 30);
  assert.strictEqual(analytics.maxDrawdownPercent, 2.97);
  assert.strictEqual(analytics.equityCurve.length, 5);
  assert.strictEqual(analytics.equityCurve[analytics.equityCurve.length - 1].equity, 1030);
});

// TEST I: Win Rate & Loss Rate Calculation
runTest('TEST I: Win Rate & Loss Rate Calculation', () => {
  const trades = [
    { pnl: 0.5 },
    { pnl: -0.3 },
    { pnl: 0.5 },
    { pnl: -0.3 }
  ];
  const analytics = calculatePerformanceAnalytics(trades);
  assert.strictEqual(analytics.totalTrades, 4);
  assert.strictEqual(analytics.winningTrades, 2);
  assert.strictEqual(analytics.losingTrades, 2);
  assert.strictEqual(analytics.winRatePercent, 50);
  assert.strictEqual(analytics.lossRatePercent, 50);
  assert.strictEqual(analytics.averageWinUsd, 0.5);
  assert.strictEqual(analytics.averageLossUsd, -0.3);
  assert.strictEqual(analytics.winLossRatio, 1.67);
});

// TEST J: P&L & Equity Progression Calculation
runTest('TEST J: P&L & Equity Progression Calculation', () => {
  const trades = [
    { pnl: 0.50, exitTime: 'E1' },
    { pnl: -0.30, exitTime: 'E2' },
    { pnl: 0.20, exitTime: 'E3' }
  ];
  const analytics = calculatePerformanceAnalytics(trades, 1000);
  assert.strictEqual(analytics.netPnlUsd, 0.40);
  assert.strictEqual(analytics.endingCapital, 1000.40);
  assert.strictEqual(analytics.equityCurve[1].equity, 1000.50);
  assert.strictEqual(analytics.equityCurve[2].equity, 1000.20);
  assert.strictEqual(analytics.equityCurve[3].equity, 1000.40);
});

console.log('\n====================================================');
console.log(` TEST SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
console.log('====================================================\n');

if (passedTests !== totalTests) {
  process.exit(1);
}
