process.env.NODE_ENV = 'test';
import assert from 'node:assert';
import {
  TRADING_MODES,
  getTradingMode,
  ExecutionEngine,
  PaperExecutionEngine,
  LiveExecutionEngine,
  getExecutionEngine
} from '../src/executionEngine.js';
import { config } from '../src/config.js';
import { isGenuineMarketTrade, resetTradeState } from '../src/paperTrader.js';

console.log('====================================================');
console.log('    RUNNING PHASE 9 EXECUTION ENGINE & SAFETY TESTS  ');
console.log('====================================================\n');

let passedTests = 0;
let totalTests = 0;

async function runTest(name, fn) {
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

try {
  // TEST 1: Default Mode is PAPER
  await runTest('TEST 1: Default trading mode is PAPER', async () => {
    const mode = getTradingMode();
    assert.strictEqual(mode, 'PAPER', 'Default mode must be PAPER');
  });

  // TEST 2: Paper Execution Engine Instantiation & Delegation
  await runTest('TEST 2: PaperExecutionEngine instantiates and delegates paper trades', async () => {
    resetTradeState();
    const paperEngine = new PaperExecutionEngine();
    assert.strictEqual(paperEngine.mode, 'PAPER');

    const candidate = {
      address: 'CxisVknoz1FHQ9g9U8nkKx9Lzbjv9jjphgVoeDXxpump',
      symbol: 'TEST_RIKA',
      name: 'Test Rika',
      priceUsd: 0.0002,
      source: 'unit_test'
    };

    const trade = await paperEngine.executeBuy(candidate, async () => ({ priceUsd: 0.00021 }));
    assert.ok(trade, 'Paper execution must return active trade record');
    assert.strictEqual(trade.execution, 'paper');
    resetTradeState();
  });

  // TEST 3: LIVE Mode Engine Selection Fails Closed
  await runTest('TEST 3: LIVE mode engine selection returns fail-closed LiveExecutionEngine', async () => {
    const liveEngine = new LiveExecutionEngine();
    assert.strictEqual(liveEngine.mode, 'LIVE');
  });

  // TEST 4: Attempted Live BUY is Rejected Safely
  await runTest('TEST 4: Attempted live BUY is rejected with SAFETY LOCK error', async () => {
    const liveEngine = new LiveExecutionEngine();
    try {
      await liveEngine.executeBuy();
      assert.fail('Live executeBuy should have thrown an error');
    } catch (err) {
      assert.ok(err.message.includes('LIVE TRADING DISABLED') || err.message.includes('SAFETY LOCK'));
      assert.ok(err.message.includes('BUY'));
    }
  });

  // TEST 5: Attempted Live SELL is Rejected Safely
  await runTest('TEST 5: Attempted live SELL is rejected with SAFETY LOCK error', async () => {
    const liveEngine = new LiveExecutionEngine();
    try {
      await liveEngine.executeSell();
      assert.fail('Live executeSell should have thrown an error');
    } catch (err) {
      assert.ok(err.message.includes('LIVE TRADING DISABLED') || err.message.includes('SAFETY LOCK'));
      assert.ok(err.message.includes('SELL'));
    }
  });

  // TEST 6: Zero Private Key / Secret Loading
  await runTest('TEST 6: Zero private key or seed phrase loading during engine initialization', async () => {
    assert.strictEqual(process.env.SOLANA_PRIVATE_KEY, undefined, 'No private key environment variable must exist');
    assert.strictEqual(process.env.SOLANA_SECRET_KEY, undefined, 'No secret key environment variable must exist');
    assert.strictEqual(process.env.SEED_PHRASE, undefined, 'No seed phrase environment variable must exist');
  });

  // TEST 7: Wallet Connection Rejection
  await runTest('TEST 7: Live wallet connection attempt rejected safely', async () => {
    const liveEngine = new LiveExecutionEngine();
    try {
      await liveEngine.connectWallet();
      assert.fail('connectWallet should have thrown an error');
    } catch (err) {
      assert.ok(err.message.includes('SAFETY LOCK'));
      assert.ok(err.message.includes('Wallet'));
    }
  });

  // TEST 8: Transaction Signing Rejection
  await runTest('TEST 8: Transaction signing attempt rejected safely', async () => {
    const liveEngine = new LiveExecutionEngine();
    try {
      await liveEngine.signTransaction();
      assert.fail('signTransaction should have thrown an error');
    } catch (err) {
      assert.ok(err.message.includes('SAFETY LOCK'));
      assert.ok(err.message.includes('signing'));
    }
  });

  // TEST 9: Transaction Submission Rejection
  await runTest('TEST 9: Solana transaction submission attempt rejected safely', async () => {
    const liveEngine = new LiveExecutionEngine();
    try {
      await liveEngine.submitTransaction();
      assert.fail('submitTransaction should have thrown an error');
    } catch (err) {
      assert.ok(err.message.includes('SAFETY LOCK'));
      assert.ok(err.message.includes('submissions'));
    }
  });

  // TEST 10: Trade Execution Tag Separation (execution: 'paper')
  await runTest('TEST 10: Trade execution tag separation (execution=paper)', async () => {
    const paperEngine = new PaperExecutionEngine();
    const candidate = {
      address: 'CxisVknoz1FHQ9g9U8nkKx9Lzbjv9jjphgVoeDXxpump',
      symbol: 'TEST_TAG',
      name: 'Test Tag',
      priceUsd: 0.0001,
      source: 'unit_test'
    };
    const trade = await paperEngine.executeBuy(candidate, async () => ({ priceUsd: 0.000105 }));
    assert.strictEqual(trade.execution, 'paper');
    resetTradeState();
  });

  // TEST 11: Strategy Immutability
  await runTest('TEST 11: Fixed strategy & risk parameters remain unaltered', async () => {
    assert.strictEqual(config.minLiquidityUsd, 10000);
    assert.strictEqual(config.min5mVolumeUsd, 5000);
    assert.strictEqual(config.minStrategyScore, 70);
    assert.strictEqual(config.maxRiskScore, 60);
    assert.strictEqual(config.profitTargetPercent, 5.0);
    assert.strictEqual(config.stopLossPercent, 3.0);
    assert.strictEqual(config.maxHoldMinutes, 5);
    assert.strictEqual(config.pricePollIntervalMs, 5000);
  });

} finally {
  resetTradeState();
}

console.log('\n====================================================');
console.log(` TEST SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
console.log('====================================================\n');

if (passedTests !== totalTests) {
  process.exit(1);
}
