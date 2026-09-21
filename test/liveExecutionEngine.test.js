process.env.NODE_ENV = 'test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

import {
  LiveExecutionEngine,
  PaperExecutionEngine,
  getExecutionEngine
} from '../src/executionEngine.js';
import { triggerKillSwitch, resetKillSwitch, resetDuplicateOrderCache } from '../src/simulationLayer.js';
import { getTradeHistory, isGenuineMarketTrade, resetTradeState } from '../src/paperTrader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HISTORY_FILE_PATH = path.join(__dirname, '..', 'paper_trades_history.json');

console.log('====================================================');
console.log('   RUNNING LIVE EXECUTION ENGINE AUTOMATED TESTS    ');
console.log('====================================================\n');

let totalTests = 0;
let passedTests = 0;

const VALID_KEYPAIR = Keypair.generate();
const VALID_WALLET = VALID_KEYPAIR.publicKey.toBase58();
const VALID_PRIVATE_KEY = bs58.encode(VALID_KEYPAIR.secretKey);

function runTest(name, fn) {
  totalTests++;
  try {
    resetKillSwitch();
    resetDuplicateOrderCache();
    resetTradeState();
    fn();
    console.log(`[PASS] TEST ${totalTests}: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] TEST ${totalTests}: ${name}`);
    console.error(`       Error: ${err.message}\n${err.stack}`);
  }
}

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    resetKillSwitch();
    resetDuplicateOrderCache();
    resetTradeState();
    await fn();
    console.log(`[PASS] TEST ${totalTests}: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] TEST ${totalTests}: ${name}`);
    console.error(`       Error: ${err.message}\n${err.stack}`);
  }
}

function makeCandidate(id, address, overrides = {}) {
  return {
    id,
    address,
    symbol: 'LIVE_TEST',
    name: 'Live Test Token',
    priceUsd: 0.0005,
    liquidityUsd: 25000,
    volume5mUsd: 12000,
    buys5m: 10,
    sells5m: 5,
    strategyScore: 85,
    riskScore: 20,
    ...overrides
  };
}

const origTradingMode = process.env.TRADING_MODE;
const origAllowLive = global.ALLOW_LIVE_EXECUTION;
const origSolanaWalletAddr = process.env.SOLANA_WALLET_ADDRESS;

try {
  const initialRawHistory = fs.readFileSync(HISTORY_FILE_PATH, 'utf-8');
  const initialParsedHistory = JSON.parse(initialRawHistory);
  const initialGenuineCount = initialParsedHistory.filter(isGenuineMarketTrade).length;

  // 1. PAPER factory returns PaperExecutionEngine
  runTest('getExecutionEngine() returns PaperExecutionEngine when TRADING_MODE is PAPER', () => {
    process.env.TRADING_MODE = 'PAPER';
    global.ALLOW_LIVE_EXECUTION = false;
    const engine = getExecutionEngine();
    assert.strictEqual(engine instanceof PaperExecutionEngine, true);
    assert.strictEqual(engine.mode, 'PAPER');
  });

  // 2. LIVE authorization missing -> fail closed
  await runAsyncTest('LIVE mode without global.ALLOW_LIVE_EXECUTION fails closed with SAFETY LOCK', async () => {
    process.env.TRADING_MODE = 'LIVE';
    global.ALLOW_LIVE_EXECUTION = false;
    const liveEngine = new LiveExecutionEngine();
    const cand = makeCandidate('CAND_02', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

    await assert.rejects(async () => {
      await liveEngine.executeBuy(cand);
    }, (err) => err.message.includes('SAFETY LOCK'));

    await assert.rejects(async () => {
      await liveEngine.executeSell({ tokenAddress: cand.address, quantity: 100 }, 0.001, 1000, 'TP');
    }, (err) => err.message.includes('SAFETY LOCK'));
  });

  // 3. Global authorization missing -> fail closed
  await runAsyncTest('Missing global.ALLOW_LIVE_EXECUTION fails closed during connectWallet/signTransaction', async () => {
    process.env.TRADING_MODE = 'LIVE';
    global.ALLOW_LIVE_EXECUTION = false;
    const liveEngine = new LiveExecutionEngine();

    await assert.rejects(async () => {
      await liveEngine.connectWallet();
    }, (err) => err.message.includes('SAFETY LOCK'));

    await assert.rejects(async () => {
      await liveEngine.signTransaction();
    }, (err) => err.message.includes('SAFETY LOCK'));
  });

  // 4. Kill switch -> fail closed
  await runAsyncTest('Active emergency kill switch blocks LiveExecutionEngine BUY/SELL execution', async () => {
    process.env.TRADING_MODE = 'LIVE';
    global.ALLOW_LIVE_EXECUTION = true;
    process.env.SOLANA_WALLET_ADDRESS = VALID_WALLET;
    const liveEngine = new LiveExecutionEngine();
    const cand = makeCandidate('CAND_04', 'So11111111111111111111111111111111111111112');

    triggerKillSwitch();
    await assert.rejects(async () => {
      await liveEngine.executeBuy(cand);
    }, (err) => err.message.includes('Emergency kill switch is active'));
  });

  // 5. Risk failure -> fail closed
  await runAsyncTest('Risk check failure (liquidity < $10k) fails closed in LiveExecutionEngine', async () => {
    process.env.TRADING_MODE = 'LIVE';
    global.ALLOW_LIVE_EXECUTION = true;
    process.env.SOLANA_WALLET_ADDRESS = VALID_WALLET;
    const liveEngine = new LiveExecutionEngine();

    const lowLiquidityToken = makeCandidate('CAND_05', '7wCM5K4ziHmrbjGe5QFhBqBME2fH82dn4Wfx8vhKSTNK', { liquidityUsd: 4000 });
    await assert.rejects(async () => {
      await liveEngine.executeBuy(lowLiquidityToken);
    }, (err) => err.message.includes('Pre-execution Risk Management rejected BUY'));
  });

  // 6. Strategy score failure -> fail closed
  await runAsyncTest('Strategy score failure (<70) fails closed in LiveExecutionEngine', async () => {
    process.env.TRADING_MODE = 'LIVE';
    global.ALLOW_LIVE_EXECUTION = true;
    process.env.SOLANA_WALLET_ADDRESS = VALID_WALLET;
    const liveEngine = new LiveExecutionEngine();

    const lowStrategyToken = makeCandidate('CAND_06', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', { strategyScore: 45 });
    await assert.rejects(async () => {
      await liveEngine.executeBuy(lowStrategyToken);
    }, (err) => err.message.includes('Pre-execution Risk Management rejected BUY'));
  });

  // 7. Invalid wallet -> fail closed
  await runAsyncTest('Missing or invalid SOLANA_WALLET_ADDRESS fails closed during executeBuy', async () => {
    process.env.TRADING_MODE = 'LIVE';
    global.ALLOW_LIVE_EXECUTION = true;
    delete process.env.SOLANA_WALLET_ADDRESS;
    const liveEngine = new LiveExecutionEngine();
    const cand = makeCandidate('CAND_07', 'So11111111111111111111111111111111111111112');

    await assert.rejects(async () => {
      await liveEngine.executeBuy(cand);
    }, (err) => err.message.includes('Valid wallet public key is required'));
  });

  // 8. SELL without valid position -> fail closed
  await runAsyncTest('executeSell without active position/quantity fails closed', async () => {
    process.env.TRADING_MODE = 'LIVE';
    global.ALLOW_LIVE_EXECUTION = true;
    process.env.SOLANA_WALLET_ADDRESS = VALID_WALLET;
    const liveEngine = new LiveExecutionEngine();

    await assert.rejects(async () => {
      await liveEngine.executeSell(null, 0.001, 1000, 'TP');
    }, (err) => err.message.includes('Invalid position or token balance'));

    await assert.rejects(async () => {
      await liveEngine.executeSell({ tokenAddress: VALID_WALLET, quantity: 0 }, 0.001, 1000, 'TP');
    }, (err) => err.message.includes('Invalid position or token balance'));
  });

  // 9. Full orchestration preview stops at DRY_RUN_BLOCKED
  await runAsyncTest('Valid candidate orchestration reaches Submitter and returns DRY_RUN_BLOCKED status', async () => {
    process.env.TRADING_MODE = 'LIVE';
    global.ALLOW_LIVE_EXECUTION = true;
    global.LIVE_EXECUTION_ARMED = true;
    global.ALLOW_MAINNET_SUBMISSION = true;
    process.env.SOLANA_WALLET_ADDRESS = VALID_WALLET;
    process.env.SOLANA_PRIVATE_KEY = VALID_PRIVATE_KEY;
    const liveEngine = new LiveExecutionEngine();
    const cand = makeCandidate('CAND_09', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

    const result = await liveEngine.executeBuy(cand, null, 10);
    assert.strictEqual(result.executionMode, 'LIVE_PREVIEW');
    assert.strictEqual(result.action, 'BUY');
    assert.strictEqual(result.walletAddress, VALID_WALLET);
    assert.strictEqual(result.status, 'DRY_RUN_BLOCKED');
    assert.strictEqual(result.submissionResult.submitted, false);
    assert.strictEqual(result.submissionResult.signature, null);
    assert.ok(result.quote);
    assert.ok(result.txObject);
    assert.strictEqual(result.signingResult.signed, true);
    assert.strictEqual(result.simulationResult.status, 'SIMULATED_READ_ONLY');
  });

  // 10. Dedicated integration test: Compare PAPER execution vs LIVE preview
  await runAsyncTest('Integration Flow Test: PAPER execution creates paper trade, LIVE preview stops at DRY_RUN_BLOCKED', async () => {
    // A) PAPER execution flow
    process.env.TRADING_MODE = 'PAPER';
    global.ALLOW_LIVE_EXECUTION = false;
    const paperEng = getExecutionEngine();
    assert.strictEqual(paperEng instanceof PaperExecutionEngine, true);
    const paperHistoryBefore = getTradeHistory().length;
    const candPaper = makeCandidate('INT_PAPER_10', 'So11111111111111111111111111111111111111112');

    const paperTradeRes = await paperEng.executeBuy(candPaper, null, 10);
    assert.ok(paperTradeRes);
    assert.strictEqual(paperTradeRes.address, candPaper.address);
    assert.strictEqual(paperTradeRes.execution, 'paper');

    // B) LIVE preview orchestration flow
    process.env.TRADING_MODE = 'LIVE';
    global.ALLOW_LIVE_EXECUTION = true;
    global.LIVE_EXECUTION_ARMED = true;
    global.ALLOW_MAINNET_SUBMISSION = true;
    process.env.SOLANA_WALLET_ADDRESS = VALID_WALLET;
    process.env.SOLANA_PRIVATE_KEY = VALID_PRIVATE_KEY;
    const liveEng = new LiveExecutionEngine();
    const candLive = makeCandidate('INT_LIVE_10', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

    const livePreviewRes = await liveEng.executeBuy(candLive, null, 10);
    assert.strictEqual(livePreviewRes.status, 'DRY_RUN_BLOCKED');
    assert.strictEqual(livePreviewRes.submissionResult.submitted, false);
    assert.strictEqual(livePreviewRes.submissionResult.signature, null);
  });

  // 11. Zero transaction signing or broadcast
  runTest('LiveExecutionEngine signTransaction and submitTransaction expose zero live capability', async () => {
    const liveEngine = new LiveExecutionEngine();
    await assert.rejects(async () => {
      await liveEngine.signTransaction();
    }, (err) => err.message.includes('SAFETY LOCK'));
  });

  // 12. No fallback from failed LIVE execution into PAPER execution
  await runAsyncTest('Failed LIVE execution throws exception instead of silently falling back to PAPER trade', async () => {
    process.env.TRADING_MODE = 'LIVE';
    global.ALLOW_LIVE_EXECUTION = true;
    delete process.env.SOLANA_WALLET_ADDRESS;
    const liveEngine = new LiveExecutionEngine();
    const cand = makeCandidate('CAND_12', '7wCM5K4ziHmrbjGe5QFhBqBME2fH82dn4Wfx8vhKSTNK');

    const paperCountBefore = getTradeHistory().length;
    await assert.rejects(async () => {
      await liveEngine.executeBuy(cand);
    });
    const paperCountAfter = getTradeHistory().length;
    assert.strictEqual(paperCountAfter, paperCountBefore, 'Failed LIVE execution must NOT fallback or create paper trade');
  });

  // 13. Verify paper_trades_history.json untouched (genuine trade count preserved)
  runTest('paper_trades_history.json file structure remains untouched and preserved', () => {
    const currentRawHistory = fs.readFileSync(HISTORY_FILE_PATH, 'utf-8');
    const currentParsedHistory = JSON.parse(currentRawHistory);
    const currentGenuineCount = currentParsedHistory.filter(isGenuineMarketTrade).length;

    assert.strictEqual(currentRawHistory, initialRawHistory, 'File content must match initial content byte-for-byte');
    assert.strictEqual(currentParsedHistory.length, initialParsedHistory.length, 'Total trade records count must be unchanged');
    assert.strictEqual(currentGenuineCount, initialGenuineCount, 'Genuine trades count must remain exact');
  });

} finally {
  resetKillSwitch();
  resetDuplicateOrderCache();
  resetTradeState();
  if (origTradingMode !== undefined) {
    process.env.TRADING_MODE = origTradingMode;
  } else {
    delete process.env.TRADING_MODE;
  }
  global.ALLOW_LIVE_EXECUTION = origAllowLive;
  if (origSolanaWalletAddr !== undefined) {
    process.env.SOLANA_WALLET_ADDRESS = origSolanaWalletAddr;
  } else {
    delete process.env.SOLANA_WALLET_ADDRESS;
  }
}

console.log('\n====================================================');
console.log(` TEST SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
console.log('====================================================\n');

if (passedTests !== totalTests) {
  process.exit(1);
}
