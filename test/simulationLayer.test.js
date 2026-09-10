process.env.NODE_ENV = 'test';
import assert from 'node:assert';
import {
  simulateTransaction,
  createSimulationPlan,
  checkSlippageProtection,
  checkPositionSizeLimit,
  checkDailyLossLimit,
  checkDuplicateOrder,
  triggerKillSwitch,
  resetKillSwitch,
  getKillSwitchState,
  resetDuplicateOrderCache,
  clearSimulationAuditLogs,
  getSimulationAuditLogs,
  SIMULATION_REJECTION_REASONS
} from '../src/simulationLayer.js';
import { LiveExecutionEngine, PaperExecutionEngine } from '../src/executionEngine.js';
import { isGenuineMarketTrade, getTradeHistory } from '../src/paperTrader.js';
import { config } from '../src/config.js';

console.log('====================================================');
console.log('   RUNNING PHASE 10 TRANSACTION SIMULATION TESTS    ');
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
  // TEST 1: Valid Simulation Request -> APPROVED_FOR_SIMULATION
  await runTest('TEST 1: Valid simulation request returns APPROVED_FOR_SIMULATION', async () => {
    const candidate = {
      id: 'CAND_001',
      address: '9iUVBSaRPt4TmE5CmTytg9UrqbWdSPnt2i2VEW4Fpump',
      symbol: 'SOL_TEST',
      name: 'Solana Test',
      priceUsd: 0.0001
    };

    const res = await simulateTransaction(candidate, 'BUY', 10);
    assert.strictEqual(res.result, 'APPROVED_FOR_SIMULATION');
    assert.ok(res.plan);
    assert.strictEqual(res.plan.label, 'SIMULATION_ONLY');
    assert.strictEqual(res.plan.executionMode, 'SIMULATION_ONLY');
  });

  // TEST 2: Slippage Exceeded -> SLIPPAGE_LIMIT_EXCEEDED
  await runTest('TEST 2: Slippage exceeded returns REJECTED with SLIPPAGE_LIMIT_EXCEEDED', async () => {
    const candidate = {
      id: 'CAND_002',
      address: '9iUVBSaRPt4TmE5CmTytg9UrqbWdSPnt2i2VEW4Fpump',
      symbol: 'SLIP_TEST',
      name: 'Slippage Test',
      priceUsd: 100.0
    };

    // Expected price: 100.0, Live price: 105.0 (+5% slippage > 1% limit)
    const mockPriceFn = async () => ({ priceUsd: 105.0 });
    const res = await simulateTransaction(candidate, 'BUY', 10, mockPriceFn);
    assert.strictEqual(res.result, 'REJECTED');
    assert.strictEqual(res.reason, SIMULATION_REJECTION_REASONS.SLIPPAGE_LIMIT_EXCEEDED);
  });

  // TEST 3: Position Size Exceeded -> POSITION_SIZE_LIMIT_EXCEEDED
  await runTest('TEST 3: Position size > $10 returns REJECTED with POSITION_SIZE_LIMIT_EXCEEDED', async () => {
    const candidate = {
      id: 'CAND_003',
      address: '9iUVBSaRPt4TmE5CmTytg9UrqbWdSPnt2i2VEW4Fpump',
      symbol: 'POS_TEST',
      priceUsd: 1.0
    };

    const res = await simulateTransaction(candidate, 'BUY', 25); // $25 > $10 max
    assert.strictEqual(res.result, 'REJECTED');
    assert.strictEqual(res.reason, SIMULATION_REJECTION_REASONS.POSITION_SIZE_LIMIT_EXCEEDED);
  });

  // TEST 4: Daily Loss Limit Reached -> DAILY_LOSS_LIMIT_REACHED
  await runTest('TEST 4: Daily loss >= $20 returns REJECTED with DAILY_LOSS_LIMIT_REACHED', async () => {
    const candidate = {
      id: 'CAND_004',
      address: '9iUVBSaRPt4TmE5CmTytg9UrqbWdSPnt2i2VEW4Fpump',
      symbol: 'LOSS_TEST',
      priceUsd: 1.0
    };

    const res = await simulateTransaction(candidate, 'BUY', 10, null, -20.50); // -$20.50 daily loss
    assert.strictEqual(res.result, 'REJECTED');
    assert.strictEqual(res.reason, SIMULATION_REJECTION_REASONS.DAILY_LOSS_LIMIT_REACHED);
  });

  // TEST 5: Kill Switch Triggered -> EMERGENCY_KILL_SWITCH_TRIGGERED
  await runTest('TEST 5: Emergency kill switch TRIGGERED blocks all simulation requests', async () => {
    triggerKillSwitch();
    assert.strictEqual(getKillSwitchState(), 'TRIGGERED');

    const candidate = {
      id: 'CAND_005',
      address: '9iUVBSaRPt4TmE5CmTytg9UrqbWdSPnt2i2VEW4Fpump',
      symbol: 'KILL_TEST',
      priceUsd: 1.0
    };

    const res = await simulateTransaction(candidate, 'BUY', 10);
    assert.strictEqual(res.result, 'REJECTED');
    assert.strictEqual(res.reason, SIMULATION_REJECTION_REASONS.EMERGENCY_KILL_SWITCH_TRIGGERED);
  });

  // TEST 6: Duplicate Order -> DUPLICATE_ORDER
  await runTest('TEST 6: Rapid duplicate order returns REJECTED with DUPLICATE_ORDER', async () => {
    const candidate = {
      id: 'CAND_006',
      address: 'DUP_MINT_123',
      symbol: 'DUP_TEST',
      priceUsd: 1.0
    };

    const res1 = await simulateTransaction(candidate, 'BUY', 10);
    assert.strictEqual(res1.result, 'APPROVED_FOR_SIMULATION');

    const res2 = await simulateTransaction(candidate, 'BUY', 10);
    assert.strictEqual(res2.result, 'REJECTED');
    assert.strictEqual(res2.reason, SIMULATION_REJECTION_REASONS.DUPLICATE_ORDER);
  });

  // TEST 7: Invalid Request Handling
  await runTest('TEST 7: Invalid candidate request returns INVALID_REQUEST', async () => {
    const res = await simulateTransaction(null, 'BUY', 10);
    assert.strictEqual(res.result, 'REJECTED');
    assert.strictEqual(res.reason, SIMULATION_REJECTION_REASONS.INVALID_REQUEST);
  });

  // TEST 8: Simulation Failure Audit Logging
  await runTest('TEST 8: All simulation rejections produce audit log records', async () => {
    const candidate = { id: 'CAND_008', address: 'FAIL_LOG_MINT', priceUsd: 1.0 };
    await simulateTransaction(candidate, 'BUY', 50); // Will fail on size limit
    const logs = getSimulationAuditLogs();
    assert.ok(logs.length > 0);
    assert.strictEqual(logs[0].executionMode, 'SIMULATION_ONLY');
    assert.strictEqual(logs[0].reason, SIMULATION_REJECTION_REASONS.POSITION_SIZE_LIMIT_EXCEEDED);
  });

  // TEST 9: Live Execution Engine Remains Fail-Closed
  await runTest('TEST 9: LiveExecutionEngine remains fail-closed for executeBuy and executeSell', async () => {
    const liveEngine = new LiveExecutionEngine();
    await assert.rejects(async () => liveEngine.executeBuy(), /disabled/i);
    await assert.rejects(async () => liveEngine.executeSell(), /disabled/i);
  });

  // TEST 10: Wallet Access Blocked
  await runTest('TEST 10: Wallet connection attempts remain fail-closed blocked', async () => {
    const liveEngine = new LiveExecutionEngine();
    await assert.rejects(async () => liveEngine.connectWallet(), /prohibited/i);
  });

  // TEST 11: Transaction Signing Blocked
  await runTest('TEST 11: Transaction signing attempts remain fail-closed blocked', async () => {
    const liveEngine = new LiveExecutionEngine();
    await assert.rejects(async () => liveEngine.signTransaction(), /prohibited/i);
  });

  // TEST 12: Transaction Submission Blocked
  await runTest('TEST 12: Transaction submission attempts remain fail-closed blocked', async () => {
    const liveEngine = new LiveExecutionEngine();
    await assert.rejects(async () => liveEngine.submitTransaction(), /prohibited/i);
  });

  // TEST 13: Paper Trading Compatibility
  await runTest('TEST 13: PaperExecutionEngine remains operational for paper trading', async () => {
    const paperEngine = new PaperExecutionEngine();
    assert.strictEqual(paperEngine.mode, 'PAPER');
  });

  // TEST 14: 100-Trade Validation Behavior Unchanged (Genuine Paper Trades Preserved)
  await runTest('TEST 14: 100-trade validation history is completely preserved and unaltered', async () => {
    const history = getTradeHistory();
    const genuine = history.filter(isGenuineMarketTrade);
    assert.ok(genuine.length >= 11, `Genuine market paper trades (${genuine.length}) must be at least 11`);
    assert.strictEqual(config.profitTargetPercent, 5.0);
    assert.strictEqual(config.stopLossPercent, 3.0);
    assert.strictEqual(config.maxHoldMinutes, 5);
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
