process.env.NODE_ENV = 'test';
import assert from 'node:assert';
import {
  evaluatePreExecutionSafetyGate,
  SAFETY_GATE_REJECTION_REASONS,
  isSafetyConfigurationValid
} from '../src/safetyGate.js';
import {
  triggerKillSwitch,
  resetKillSwitch,
  resetDuplicateOrderCache,
  clearSimulationAuditLogs
} from '../src/simulationLayer.js';
import { LiveExecutionEngine, PaperExecutionEngine } from '../src/executionEngine.js';
import { isGenuineMarketTrade, getTradeHistory } from '../src/paperTrader.js';
import { config } from '../src/config.js';

console.log('====================================================');
console.log('    RUNNING PHASE 11 PRE-EXECUTION SAFETY GATE TESTS');
console.log('====================================================\n');

let passedTests = 0;
let totalTests = 0;

async function runTest(name, fn) {
  totalTests++;
  try {
    resetKillSwitch();
    resetDuplicateOrderCache();
    clearSimulationAuditLogs();
    await fn();
    console.log(`[PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(`       Error: ${err.message}\n${err.stack}`);
  }
}

try {
  // TEST 1: Valid Safety-Gate Request -> SAFETY_GATE_PASSED
  await runTest('TEST 1: Valid safety-gate request returns SAFETY_GATE_PASSED', async () => {
    const candidate = {
      id: 'GATE_CAND_01',
      address: '7wCM5K4ziHmrbjGe5QFhBqBME2fH82dn4Wfx8vhKSTNK',
      symbol: 'GATE_TEST',
      priceUsd: 0.0001
    };

    const res = await evaluatePreExecutionSafetyGate(candidate, 'BUY', 10, 1000, 0);
    assert.strictEqual(res.finalStatus, 'SAFETY_GATE_PASSED');
    assert.strictEqual(res.passedChecks, 13);
    assert.strictEqual(res.failedChecks.length, 0);
    assert.strictEqual(res.transactionExecutionAuthorized, false);
  });

  // TEST 2: Invalid Execution Mode -> SAFETY_GATE_REJECTED (INVALID_EXECUTION_MODE)
  await runTest('TEST 2: Invalid or LIVE execution mode returns SAFETY_GATE_REJECTED', async () => {
    const origMode = config.tradingMode;
    try {
      config.tradingMode = 'LIVE';
      const candidate = { id: 'GATE_02', address: 'TEST_MINT', priceUsd: 1.0 };
      const res = await evaluatePreExecutionSafetyGate(candidate, 'BUY', 10);
      assert.strictEqual(res.finalStatus, 'SAFETY_GATE_REJECTED');
      assert.strictEqual(res.rejectionReason, SAFETY_GATE_REJECTION_REASONS.INVALID_EXECUTION_MODE);
    } finally {
      config.tradingMode = origMode;
    }
  });

  // TEST 3: Kill Switch Triggered -> SAFETY_GATE_REJECTED (KILL_SWITCH_TRIGGERED)
  await runTest('TEST 3: Triggered emergency kill switch rejects safety-gate evaluation', async () => {
    triggerKillSwitch();
    const candidate = { id: 'GATE_03', address: 'TEST_MINT', priceUsd: 1.0 };
    const res = await evaluatePreExecutionSafetyGate(candidate, 'BUY', 10);
    assert.strictEqual(res.finalStatus, 'SAFETY_GATE_REJECTED');
    assert.strictEqual(res.rejectionReason, SAFETY_GATE_REJECTION_REASONS.KILL_SWITCH_TRIGGERED);
  });

  // TEST 4: Daily Loss Limit Reached -> SAFETY_GATE_REJECTED (DAILY_LOSS_EXCEEDED)
  await runTest('TEST 4: Daily loss exceeding threshold rejects safety-gate evaluation', async () => {
    const candidate = { id: 'GATE_04', address: 'TEST_MINT', priceUsd: 1.0 };
    const res = await evaluatePreExecutionSafetyGate(candidate, 'BUY', 10, 1000, -25.0); // -$25 daily loss
    assert.strictEqual(res.finalStatus, 'SAFETY_GATE_REJECTED');
    assert.strictEqual(res.rejectionReason, SAFETY_GATE_REJECTION_REASONS.DAILY_LOSS_EXCEEDED);
  });

  // TEST 5: Position Size Exceeded -> SAFETY_GATE_REJECTED (POSITION_SIZE_EXCEEDED)
  await runTest('TEST 5: Position size exceeding $10 rejects safety-gate evaluation', async () => {
    const candidate = { id: 'GATE_05', address: 'TEST_MINT', priceUsd: 1.0 };
    const res = await evaluatePreExecutionSafetyGate(candidate, 'BUY', 50); // $50 > $10
    assert.strictEqual(res.finalStatus, 'SAFETY_GATE_REJECTED');
    assert.strictEqual(res.rejectionReason, SAFETY_GATE_REJECTION_REASONS.POSITION_SIZE_EXCEEDED);
  });

  // TEST 6: Slippage Exceeded -> SAFETY_GATE_REJECTED (SLIPPAGE_EXCEEDED)
  await runTest('TEST 6: Price movement exceeding slippage tolerance rejects safety-gate', async () => {
    const candidate = { id: 'GATE_06', address: 'TEST_MINT', priceUsd: 100.0 };
    const mockPriceFn = async () => ({ priceUsd: 105.0 }); // +5% slippage > 1% limit
    const res = await evaluatePreExecutionSafetyGate(candidate, 'BUY', 10, 1000, 0, mockPriceFn);
    assert.strictEqual(res.finalStatus, 'SAFETY_GATE_REJECTED');
    assert.strictEqual(res.rejectionReason, SAFETY_GATE_REJECTION_REASONS.SLIPPAGE_EXCEEDED);
  });

  // TEST 7: Duplicate Order -> SAFETY_GATE_REJECTED (DUPLICATE_ORDER)
  await runTest('TEST 7: Duplicate candidate request within window rejects safety-gate', async () => {
    const candidate = { id: 'GATE_DUP_07', address: 'DUP_GATE_MINT', priceUsd: 1.0 };
    const res1 = await evaluatePreExecutionSafetyGate(candidate, 'BUY', 10);
    assert.strictEqual(res1.finalStatus, 'SAFETY_GATE_PASSED');

    const res2 = await evaluatePreExecutionSafetyGate(candidate, 'BUY', 10);
    assert.strictEqual(res2.finalStatus, 'SAFETY_GATE_REJECTED');
    assert.strictEqual(res2.rejectionReason, SAFETY_GATE_REJECTION_REASONS.DUPLICATE_ORDER);
  });

  // TEST 8: Invalid Request Data -> SAFETY_GATE_REJECTED (INVALID_REQUEST_DATA)
  await runTest('TEST 8: Invalid candidate token or zero price rejects safety-gate', async () => {
    const candidate = { id: 'GATE_08', address: null, priceUsd: 0 };
    const res = await evaluatePreExecutionSafetyGate(candidate, 'BUY', 10);
    assert.strictEqual(res.finalStatus, 'SAFETY_GATE_REJECTED');
    assert.strictEqual(res.rejectionReason, SAFETY_GATE_REJECTION_REASONS.INVALID_REQUEST_DATA);
  });

  // TEST 9: Missing Configuration -> SAFETY_GATE_REJECTED (SAFETY_CONFIGURATION_INVALID)
  await runTest('TEST 9: Missing or malformed safety configuration rejects safety-gate fail-closed', async () => {
    const origMaxPos = config.maxPositionSizeUsd;
    try {
      config.maxPositionSizeUsd = null; // Invalidate config
      assert.strictEqual(isSafetyConfigurationValid(), false);
      const candidate = { id: 'GATE_09', address: 'TEST_MINT', priceUsd: 1.0 };
      const res = await evaluatePreExecutionSafetyGate(candidate, 'BUY', 10);
      assert.strictEqual(res.finalStatus, 'SAFETY_GATE_REJECTED');
      assert.strictEqual(res.rejectionReason, SAFETY_GATE_REJECTION_REASONS.SAFETY_CONFIGURATION_INVALID);
    } finally {
      config.maxPositionSizeUsd = origMaxPos;
    }
  });

  // TEST 10: Simulation-Only Approval Validation
  await runTest('TEST 10: Passing safety gate NEVER authorizes transaction execution', async () => {
    const candidate = { id: 'GATE_10', address: 'TEST_MINT', priceUsd: 1.0 };
    const res = await evaluatePreExecutionSafetyGate(candidate, 'BUY', 10);
    assert.strictEqual(res.finalStatus, 'SAFETY_GATE_PASSED');
    assert.strictEqual(res.transactionExecutionAuthorized, false);
    assert.ok(res.readinessNotice.includes('LOCKED'));
  });

  // TEST 11: Live Execution Remains Blocked
  await runTest('TEST 11: LiveExecutionEngine remains fail-closed during safety gate checks', async () => {
    const liveEngine = new LiveExecutionEngine();
    await assert.rejects(async () => liveEngine.executeBuy(), /disabled/i);
    await assert.rejects(async () => liveEngine.executeSell(), /disabled/i);
  });

  // TEST 12: Wallet Access Blocked
  await runTest('TEST 12: Wallet access remains fail-closed blocked', async () => {
    const liveEngine = new LiveExecutionEngine();
    await assert.rejects(async () => liveEngine.connectWallet(), /prohibited/i);
  });

  // TEST 13: Signing Capability Blocked
  await runTest('TEST 13: Signing capability remains fail-closed blocked', async () => {
    const liveEngine = new LiveExecutionEngine();
    await assert.rejects(async () => liveEngine.signTransaction(), /prohibited/i);
  });

  // TEST 14: Submission Capability Blocked
  await runTest('TEST 14: Submission capability remains fail-closed blocked', async () => {
    const liveEngine = new LiveExecutionEngine();
    await assert.rejects(async () => liveEngine.submitTransaction(), /prohibited/i);
  });

  // TEST 15: Paper Trading Compatibility
  await runTest('TEST 15: PaperExecutionEngine remains operational for paper trading', async () => {
    const paperEngine = new PaperExecutionEngine();
    assert.strictEqual(paperEngine.mode, 'PAPER');
  });

  // TEST 16: Existing Phase 10 Safety Checks Preserved
  await runTest('TEST 16: Safety configuration parameters remain immutable', async () => {
    assert.strictEqual(config.minLiquidityUsd, 10000);
    assert.strictEqual(config.min5mVolumeUsd, 5000);
    assert.strictEqual(config.minStrategyScore, 70);
    assert.strictEqual(config.maxRiskScore, 60);
    assert.strictEqual(config.profitTargetPercent, 5.0);
    assert.strictEqual(config.stopLossPercent, 3.0);
    assert.strictEqual(config.maxHoldMinutes, 5);
  });

  // TEST 17: 100-Trade Validation Behavior Unchanged (Genuine History Preserved)
  await runTest('TEST 17: Genuine paper trading history remains untouched and preserved', async () => {
    const history = getTradeHistory();
    const genuine = history.filter(isGenuineMarketTrade);
    assert.ok(genuine.length >= 11, `Genuine market paper trades (${genuine.length}) must be at least 11`);
  });

} finally {
  resetKillSwitch();
  resetDuplicateOrderCache();
}

console.log('\n====================================================');
console.log(` TEST SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
console.log('====================================================\n');

if (passedTests !== totalTests) {
  process.exit(1);
}
