import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  executePaperTrade,
  processMonitoringCycle,
  getTradeState,
  resetTradeState,
  getTradeHistory,
  calculateTradeMetrics
} from '../src/paperTrader.js';
import { config } from '../src/config.js';

console.log('====================================================');
console.log('       RUNNING PAPER TRADER AUTOMATED TESTS         ');
console.log('====================================================\n');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    resetTradeState();
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
    await fn();
    console.log(`[PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(`       Error: ${err.message}\n${err.stack}`);
  }
}

// Ensure clean start
resetTradeState();

// TEST 1: P&L Math Calculation
runTest('P&L Calculation Math', () => {
  const metrics = calculateTradeMetrics(100, 105, 10);
  assert.strictEqual(metrics.quantity, 0.1);
  assert.strictEqual(metrics.grossValue, 10.5);
  assert.strictEqual(metrics.pnlUsd, 0.5);
  assert.strictEqual(metrics.pnlPercent, 5);
});

// TEST A: Take Profit (+5%) Trigger
await runAsyncTest('TEST A: Take Profit (+5%) Trigger', async () => {
  const mockToken = { address: 'TEST_TOKEN_TP', symbol: 'TEST_TP', name: 'Test TP Token', priceUsd: 100 };
  const tradeRecord = await executePaperTrade(mockToken, async () => ({ priceUsd: 105 }));

  assert.strictEqual(getTradeState(), 'ACTIVE');

  // Trigger monitoring cycle tick with $105 price
  await processMonitoringCycle(tradeRecord, async () => ({ priceUsd: 105 }));

  assert.strictEqual(getTradeState(), 'IDLE', 'State must return to IDLE after sell');
  const history = getTradeHistory();
  const lastTrade = history[history.length - 1];
  assert.strictEqual(lastTrade.exitReason, 'TAKE_PROFIT');
  assert.strictEqual(lastTrade.pnlPercent, 5);
  assert.strictEqual(lastTrade.pnl, 0.5);
});

// TEST B: Stop Loss (-3%) Trigger
await runAsyncTest('TEST B: Stop Loss (-3%) Trigger', async () => {
  const mockToken = { address: 'TEST_TOKEN_SL', symbol: 'TEST_SL', name: 'Test SL Token', priceUsd: 100 };
  const tradeRecord = await executePaperTrade(mockToken, async () => ({ priceUsd: 97 }));

  assert.strictEqual(getTradeState(), 'ACTIVE');

  // Trigger monitoring cycle tick with $97 price
  await processMonitoringCycle(tradeRecord, async () => ({ priceUsd: 97 }));

  assert.strictEqual(getTradeState(), 'IDLE', 'State must return to IDLE after sell');
  const history = getTradeHistory();
  const lastTrade = history[history.length - 1];
  assert.strictEqual(lastTrade.exitReason, 'STOP_LOSS');
  assert.strictEqual(lastTrade.pnlPercent, -3);
  assert.ok(Math.abs(lastTrade.pnl - (-0.3)) < 1e-5, `Expected pnl ~ -0.3, got ${lastTrade.pnl}`);
});

// TEST C: Maximum Hold Time (5 minutes) Trigger
await runAsyncTest('TEST C: Maximum Hold Time (5 Minutes) Trigger', async () => {
  const mockToken = { address: 'TEST_TOKEN_MH', symbol: 'TEST_MH', name: 'Test MH Token', priceUsd: 100 };
  const tradeRecord = await executePaperTrade(mockToken, async () => ({ priceUsd: 101 }));

  // Simulate 5 minutes passing by adjusting entryTimeMs into the past
  tradeRecord.entryTimeMs = Date.now() - (config.maxHoldTimeMs + 1000);

  // Trigger monitoring cycle tick where price is unchanged (+1%) but time >= 5m
  await processMonitoringCycle(tradeRecord, async () => ({ priceUsd: 101 }));

  assert.strictEqual(getTradeState(), 'IDLE', 'State must return to IDLE after max hold exit');
  const history = getTradeHistory();
  const lastTrade = history[history.length - 1];
  assert.strictEqual(lastTrade.exitReason, 'MAX_HOLD_TIME');
  assert.strictEqual(lastTrade.pnlPercent, 1);
});

// TEST D: API Failure Handling During Monitoring
await runAsyncTest('TEST D: API Failure Handling During Monitoring', async () => {
  const mockToken = { address: 'TEST_TOKEN_API_FAIL', symbol: 'TEST_FAIL', name: 'Test Fail Token', priceUsd: 100 };
  const tradeRecord = await executePaperTrade(mockToken, async () => null);

  assert.strictEqual(getTradeState(), 'ACTIVE');

  // Trigger monitoring cycle tick returning null (API error)
  await processMonitoringCycle(tradeRecord, async () => null);

  // Trade should REMAIN ACTIVE, not crash or trigger TP/SL
  assert.strictEqual(getTradeState(), 'ACTIVE', 'Trade state must remain ACTIVE during transient API failure');
});

// TEST E: Duplicate Buy Prevention
await runAsyncTest('TEST E: Duplicate Buy Prevention', async () => {
  const mockToken1 = { address: 'TOKEN_1', symbol: 'T1', priceUsd: 10 };
  const mockToken2 = { address: 'TOKEN_2', symbol: 'T2', priceUsd: 20 };

  const firstTrade = await executePaperTrade(mockToken1, async () => ({ priceUsd: 10 }));
  assert.ok(firstTrade, 'First trade should succeed');
  assert.strictEqual(getTradeState(), 'ACTIVE');

  const secondTrade = await executePaperTrade(mockToken2, async () => ({ priceUsd: 20 }));
  assert.strictEqual(secondTrade, null, 'Second trade must be rejected while another trade is ACTIVE');
});

// TEST F: Trade History File Saving
runTest('TEST F: Persistent History File Validation', () => {
  const historyFile = path.resolve(process.cwd(), 'paper_trades_history.json');
  assert.ok(fs.existsSync(historyFile), 'paper_trades_history.json file must exist');
  const fileData = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
  assert.ok(Array.isArray(fileData), 'History file must contain JSON array');
  assert.ok(fileData.length > 0, 'History file must contain completed test trades');

  const sample = fileData[fileData.length - 1];
  assert.ok(sample.tradeId, 'Trade record must have tradeId');
  assert.ok(sample.symbol, 'Trade record must have symbol');
  assert.ok(sample.entryPrice, 'Trade record must have entryPrice');
  assert.ok(sample.exitPrice, 'Trade record must have exitPrice');
  assert.ok(sample.investment, 'Trade record must have investment');
  assert.ok(sample.pnl !== undefined, 'Trade record must have pnl');
  assert.ok(sample.pnlPercent !== undefined, 'Trade record must have pnlPercent');
  assert.ok(sample.exitReason, 'Trade record must have exitReason');
});

console.log('\n====================================================');
console.log(` TEST SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
console.log('====================================================\n');

if (passedTests !== totalTests) {
  process.exit(1);
}
