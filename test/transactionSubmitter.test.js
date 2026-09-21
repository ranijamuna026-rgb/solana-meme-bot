process.env.NODE_ENV = 'test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TransactionSubmitter, DEFAULT_MAX_RETRIES, DEFAULT_CONFIRMATION_TIMEOUT_MS } from '../src/transactionSubmitter.js';
import { TransactionBuilder } from '../src/transactionBuilder.js';
import { DEXRouter } from '../src/dexRouter.js';
import { triggerKillSwitch, resetKillSwitch } from '../src/simulationLayer.js';
import { getTradeHistory, isGenuineMarketTrade } from '../src/paperTrader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HISTORY_FILE_PATH = path.join(__dirname, '..', 'paper_trades_history.json');

console.log('====================================================');
console.log('   RUNNING TRANSACTION SUBMITTER AUTOMATED TESTS    ');
console.log('====================================================\n');

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
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
    await fn();
    console.log(`[PASS] TEST ${totalTests}: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] TEST ${totalTests}: ${name}`);
    console.error(`       Error: ${err.message}\n${err.stack}`);
  }
}

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const VALID_WALLET = '7wCM5K4ziHmrbjGe5QFhBqBME2fH82dn4Wfx8vhKSTNK';

const origTradingMode = process.env.TRADING_MODE;
const origAllowLive = global.ALLOW_LIVE_EXECUTION;

try {
  resetKillSwitch();
  const initialRawHistory = fs.readFileSync(HISTORY_FILE_PATH, 'utf-8');
  const initialParsedHistory = JSON.parse(initialRawHistory);
  const initialGenuineCount = initialParsedHistory.filter(isGenuineMarketTrade).length;

  // Helper to create valid signed tx & simulation result for Step 10
  async function createValidSetup() {
    process.env.TRADING_MODE = 'LIVE';
    global.ALLOW_LIVE_EXECUTION = true;
    global.LIVE_EXECUTION_ARMED = true;
    global.ALLOW_MAINNET_SUBMISSION = true;
    process.env.SOLANA_WALLET_ADDRESS = VALID_WALLET;
    const dexRouter = new DEXRouter();
    const builder = new TransactionBuilder({ dexRouter });
    const quote = await dexRouter.getBuyQuote(SOL_MINT, USDC_MINT, 10, 50);
    const tx = await builder.buildBuyTransaction(quote, VALID_WALLET);
    tx.isSigned = true;
    tx.signatures = [{ publicKey: VALID_WALLET, signature: 'signed_mock_sig' }];
    const simResult = await builder.simulateTransaction(tx, { allowSigned: true });
    return { dexRouter, builder, tx, simResult };
  }

  // 1. PAPER mode blocks submission
  await runAsyncTest('PAPER mode strictly blocks submission with SAFETY LOCK', async () => {
    const setup = await createValidSetup();
    process.env.TRADING_MODE = 'PAPER';
    global.ALLOW_LIVE_EXECUTION = false;
    const submitter = new TransactionSubmitter({ transactionBuilder: setup.builder });

    await assert.rejects(async () => {
      await submitter.submit(setup.tx, setup.simResult);
    }, /SAFETY LOCK|SUBMISSION_AUTHORIZATION_REQUIRED/);
  });

  // 2. Missing LIVE authorization blocks submission
  await runAsyncTest('LIVE mode without global.ALLOW_LIVE_EXECUTION blocks submission', async () => {
    const setup = await createValidSetup();
    global.ALLOW_LIVE_EXECUTION = false;
    const submitter = new TransactionSubmitter({ transactionBuilder: setup.builder });

    await assert.rejects(async () => {
      await submitter.submit(setup.tx, setup.simResult);
    }, /SAFETY LOCK|SUBMISSION_AUTHORIZATION_REQUIRED/);
  });

  // 3. Unsigned transaction rejected
  await runAsyncTest('Unsigned transaction is rejected before submission', async () => {
    const setup = await createValidSetup();
    const submitter = new TransactionSubmitter({ transactionBuilder: setup.builder });
    const unsignedTx = { ...setup.tx, isSigned: false, signatures: [] };

    await assert.rejects(async () => {
      await submitter.submit(unsignedTx, setup.simResult);
    }, /SIGNED_TRANSACTION_REQUIRED|Unsigned transaction/);
  });

  // 4. Invalid transaction rejected
  await runAsyncTest('Invalid transaction object (missing userPublicKey) is rejected', async () => {
    const setup = await createValidSetup();
    const submitter = new TransactionSubmitter({ transactionBuilder: setup.builder });
    const invalidTx = { ...setup.tx, userPublicKey: 'invalid_key' };

    await assert.rejects(async () => {
      await submitter.submit(invalidTx, setup.simResult);
    }, /Missing or malformed wallet public key|Wallet mismatch/);
  });

  // 5. Simulation required before submission
  await runAsyncTest('Missing simulation result rejects submission', async () => {
    const setup = await createValidSetup();
    const submitter = new TransactionSubmitter({ transactionBuilder: setup.builder });

    await assert.rejects(async () => {
      await submitter.submit(setup.tx, null);
    }, /Simulation result is required|SIMULATION_FAILED/);
  });

  // 6. Failed simulation blocks submission
  await runAsyncTest('Failed or unapproved simulation result rejects submission', async () => {
    const setup = await createValidSetup();
    const submitter = new TransactionSubmitter({ transactionBuilder: setup.builder });
    const failedSimResult = { status: 'FAILED_SIMULATION', err: 'RPC timeout' };

    await assert.rejects(async () => {
      await submitter.submit(setup.tx, failedSimResult);
    }, /Transaction simulation failed or unapproved|SIMULATION_FAILED/);
  });

  // 7. Stale quote blocks submission
  await runAsyncTest('Stale transaction preview (age > 3000ms) blocks submission', async () => {
    const setup = await createValidSetup();
    const submitter = new TransactionSubmitter({ transactionBuilder: setup.builder });
    const staleTx = { ...setup.tx, timestamp: Date.now() - 5000 };

    await assert.rejects(async () => {
      await submitter.submit(staleTx, setup.simResult);
    }, /Stale quote|STALE_QUOTE/);
  });

  // 8. Excessive slippage (>1.0%) blocks submission
  await runAsyncTest('Slippage exceeding 1.0% (100 bps) blocks submission', async () => {
    const setup = await createValidSetup();
    const submitter = new TransactionSubmitter({ transactionBuilder: setup.builder });
    const highSlippageTx = { ...setup.tx, slippageBps: 150 };

    await assert.rejects(async () => {
      await submitter.submit(highSlippageTx, setup.simResult);
    }, /Slippage|SLIPPAGE_LIMIT_EXCEEDED/);
  });

  // 9. Invalid wallet address blocks submission
  await runAsyncTest('Invalid wallet address blocks submission', async () => {
    const setup = await createValidSetup();
    const submitter = new TransactionSubmitter({ transactionBuilder: setup.builder });
    const badAddressTx = { ...setup.tx, userPublicKey: 'invalid_address' };

    await assert.rejects(async () => {
      await submitter.submit(badAddressTx, setup.simResult);
    }, /Missing or malformed wallet public key|Wallet mismatch/);
  });

  // 10. Active kill switch blocks submission
  await runAsyncTest('Triggered emergency kill switch blocks submission', async () => {
    const setup = await createValidSetup();
    const submitter = new TransactionSubmitter({ transactionBuilder: setup.builder });
    triggerKillSwitch();

    try {
      await assert.rejects(async () => {
        await submitter.submit(setup.tx, setup.simResult);
      }, /EMERGENCY KILL SWITCH TRIGGERED|Emergency kill switch is active|SUBMISSION_BLOCKED_KILL_SWITCH/);
    } finally {
      resetKillSwitch();
    }
  });

  // 11. submit() dry-run barrier returns DRY_RUN_BLOCKED and never broadcasts
  await runAsyncTest('submit() returns DRY_RUN_BLOCKED result without broadcasting', async () => {
    const setup = await createValidSetup();
    const submitter = new TransactionSubmitter({ transactionBuilder: setup.builder });

    const result = await submitter.submit(setup.tx, setup.simResult);
    assert.strictEqual(result.submitted, false);
    assert.strictEqual(result.status, 'DRY_RUN_BLOCKED');
    assert.strictEqual(result.signature, null);
    if (result.reason) {
      assert.ok(result.reason.includes('SAFETY LOCK') || result.reason.includes('DRY_RUN_BLOCKED'));
    }
  });

  // 12. No sendTransaction or sendAndConfirmTransaction
  runTest('TransactionSubmitter exposes no sendTransaction or sendAndConfirmTransaction RPC methods', () => {
    const submitter = new TransactionSubmitter();
    assert.strictEqual(typeof submitter.sendTransaction, 'undefined');
    assert.strictEqual(typeof submitter.sendAndConfirmTransaction, 'undefined');
    assert.strictEqual(typeof submitter.sendRawTransaction, 'undefined');
  });

  // 13. confirm() returns SUBMITTED status when unconfirmed
  await runAsyncTest('confirm() returns SUBMITTED status cleanly', async () => {
    const submitter = new TransactionSubmitter();
    const confirmRes = await submitter.confirm('mock_sig_123');
    assert.strictEqual(confirmRes.confirmed, false);
    assert.strictEqual(confirmRes.status, 'SUBMITTED');
    assert.strictEqual(confirmRes.signature, 'mock_sig_123');
    assert.strictEqual(confirmRes.confirmations, 0);
  });

  // 14. Retry configuration defaults verified
  runTest('Retry configuration options default to maxRetries=2 and timeout=30000ms', () => {
    const submitter = new TransactionSubmitter();
    assert.strictEqual(submitter.retryConfig.maxRetries, DEFAULT_MAX_RETRIES);
    assert.strictEqual(submitter.retryConfig.confirmationTimeoutMs, DEFAULT_CONFIRMATION_TIMEOUT_MS);
  });

  // 15. Zero private key access
  runTest('Zero private keys or seed phrases accessed or stored in TransactionSubmitter', () => {
    assert.strictEqual(process.env.SOLANA_PRIVATE_KEY, undefined);
    assert.strictEqual(process.env.PRIVATE_KEY, undefined);
    assert.strictEqual(process.env.SEED_PHRASE, undefined);
    const submitter = new TransactionSubmitter();
    assert.strictEqual(Object.keys(submitter).includes('privateKey'), false);
    assert.strictEqual(Object.keys(submitter).includes('secretKey'), false);
  });

  // 16. Verify paper_trades_history.json untouched
  runTest('paper_trades_history.json remains completely untouched and intact', () => {
    const currentRawHistory = fs.readFileSync(HISTORY_FILE_PATH, 'utf-8');
    const currentParsedHistory = JSON.parse(currentRawHistory);
    const currentGenuineCount = currentParsedHistory.filter(isGenuineMarketTrade).length;

    assert.strictEqual(currentRawHistory, initialRawHistory, 'File content must match initial content byte-for-byte');
    assert.strictEqual(currentParsedHistory.length, initialParsedHistory.length, 'Total trade records count must be unchanged');
    assert.strictEqual(currentGenuineCount, initialGenuineCount, 'Genuine trades count must remain exact');
  });

} finally {
  resetKillSwitch();
  if (origTradingMode !== undefined) {
    process.env.TRADING_MODE = origTradingMode;
  } else {
    delete process.env.TRADING_MODE;
  }
  global.ALLOW_LIVE_EXECUTION = origAllowLive;
  delete global.ALLOW_MAINNET_SUBMISSION;
}

console.log('\n====================================================');
console.log(` TEST SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
console.log('====================================================\n');

if (passedTests !== totalTests) {
  process.exit(1);
}
