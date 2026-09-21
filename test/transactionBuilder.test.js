process.env.NODE_ENV = 'test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TransactionBuilder } from '../src/transactionBuilder.js';
import { DEXRouter, isValidPublicKey } from '../src/dexRouter.js';
import { getTradeHistory, isGenuineMarketTrade } from '../src/paperTrader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HISTORY_FILE_PATH = path.join(__dirname, '..', 'paper_trades_history.json');

console.log('====================================================');
console.log('    RUNNING TRANSACTION BUILDER AUTOMATED TESTS     ');
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
  const initialRawHistory = fs.readFileSync(HISTORY_FILE_PATH, 'utf-8');
  const initialParsedHistory = JSON.parse(initialRawHistory);
  const initialGenuineCount = initialParsedHistory.filter(isGenuineMarketTrade).length;

  // 1. PAPER mode isolation
  await runAsyncTest('PAPER mode strictly blocks transaction building with SAFETY LOCK', async () => {
    process.env.TRADING_MODE = 'PAPER';
    global.ALLOW_LIVE_EXECUTION = false;
    const dexRouter = new DEXRouter();
    const builder = new TransactionBuilder({ dexRouter });
    const quote = await dexRouter.getBuyQuote(SOL_MINT, USDC_MINT, 10, 50);

    await assert.rejects(async () => {
      await builder.buildBuyTransaction(quote, VALID_WALLET);
    }, /SAFETY LOCK: Live transaction building prohibited/);
  });

  // 2. Missing LIVE authorization blocked
  await runAsyncTest('LIVE mode without global.ALLOW_LIVE_EXECUTION blocks transaction building', async () => {
    process.env.TRADING_MODE = 'LIVE';
    global.ALLOW_LIVE_EXECUTION = false;
    const dexRouter = new DEXRouter();
    const builder = new TransactionBuilder({ dexRouter });
    const quote = await dexRouter.getBuyQuote(SOL_MINT, USDC_MINT, 10, 50);

    await assert.rejects(async () => {
      await builder.buildBuyTransaction(quote, VALID_WALLET);
    }, /SAFETY LOCK: Live transaction building prohibited/);
  });

  // 3. Valid transaction input & unsigned transaction structure
  await runAsyncTest('Valid input generates unsigned transaction preview object', async () => {
    process.env.TRADING_MODE = 'LIVE';
    global.ALLOW_LIVE_EXECUTION = true;
    const dexRouter = new DEXRouter();
    const builder = new TransactionBuilder({ dexRouter });
    const quote = await dexRouter.getBuyQuote(SOL_MINT, USDC_MINT, 10, 50);

    const txObject = await builder.buildBuyTransaction(quote, VALID_WALLET);
    assert.strictEqual(txObject.action, 'BUY');
    assert.strictEqual(txObject.userPublicKey, VALID_WALLET);
    assert.strictEqual(txObject.inputMint, SOL_MINT);
    assert.strictEqual(txObject.outputMint, USDC_MINT);
    assert.strictEqual(txObject.isSigned, false);
    assert.strictEqual(Array.isArray(txObject.signatures), true);
    assert.strictEqual(txObject.signatures.length, 0);
    assert.strictEqual(txObject.status, 'UNSIGNED_PREVIEW');
    assert.ok(txObject.rawTransaction);
  });

  // 4. Invalid mint rejection
  runTest('Invalid token mint address is rejected by validation', () => {
    const builder = new TransactionBuilder();
    const invalidTx = {
      userPublicKey: VALID_WALLET,
      inputMint: 'invalid-mint',
      outputMint: USDC_MINT,
      inAmount: '10',
      slippageBps: 50,
      isSigned: false,
      signatures: []
    };
    assert.throws(() => builder.validateTransaction(invalidTx), /Missing or malformed input token mint/);
  });

  // 5. Invalid amount rejection
  runTest('Zero or negative inAmount is rejected by validation', () => {
    const builder = new TransactionBuilder();
    const zeroTx = {
      userPublicKey: VALID_WALLET,
      inputMint: SOL_MINT,
      outputMint: USDC_MINT,
      inAmount: '0',
      slippageBps: 50,
      isSigned: false,
      signatures: []
    };
    assert.throws(() => builder.validateTransaction(zeroTx), /In amount must be a positive number/);
  });

  // 6. Invalid wallet public key rejection
  runTest('Invalid or missing wallet public key is rejected', () => {
    const builder = new TransactionBuilder();
    const badWalletTx = {
      userPublicKey: 'invalid-key',
      inputMint: SOL_MINT,
      outputMint: USDC_MINT,
      inAmount: '10',
      slippageBps: 50,
      isSigned: false,
      signatures: []
    };
    assert.throws(() => builder.validateTransaction(badWalletTx), /Missing or malformed wallet public key/);
  });

  // 7. Invalid slippage rejection
  runTest('Slippage exceeding maximum limit (>100 bps) is rejected', () => {
    const builder = new TransactionBuilder();
    const highSlippageTx = {
      userPublicKey: VALID_WALLET,
      inputMint: SOL_MINT,
      outputMint: USDC_MINT,
      inAmount: '10',
      slippageBps: 150,
      isSigned: false,
      signatures: []
    };
    assert.throws(() => builder.validateTransaction(highSlippageTx), /Slippage 150 exceeds maximum allowed limit/);
  });

  // 8. Stale quote rejection
  runTest('Stale transaction preview timestamp is rejected', () => {
    const builder = new TransactionBuilder();
    const staleTx = {
      userPublicKey: VALID_WALLET,
      inputMint: SOL_MINT,
      outputMint: USDC_MINT,
      inAmount: '10',
      slippageBps: 50,
      timestamp: Date.now() - 5000,
      isSigned: false,
      signatures: []
    };
    assert.throws(() => builder.validateTransaction(staleTx), /Stale quote rejection/);
  });

  // 9. Unsigned transaction validation
  runTest('Pre-signed transaction is rejected with SAFETY LOCK', () => {
    const builder = new TransactionBuilder();
    const signedTx = {
      userPublicKey: VALID_WALLET,
      inputMint: SOL_MINT,
      outputMint: USDC_MINT,
      inAmount: '10',
      slippageBps: 50,
      timestamp: Date.now(),
      isSigned: true,
      signatures: ['mock_signature_bytes']
    };
    assert.throws(() => builder.validateTransaction(signedTx), /SAFETY LOCK: Signed transactions are strictly prohibited/);
  });

  // 10. Simulation remains read-only
  await runAsyncTest('simulateTransaction executes read-only simulation without broadcasting', async () => {
    process.env.TRADING_MODE = 'LIVE';
    global.ALLOW_LIVE_EXECUTION = true;
    const dexRouter = new DEXRouter();
    const builder = new TransactionBuilder({ dexRouter });
    const quote = await dexRouter.getBuyQuote(SOL_MINT, USDC_MINT, 10, 50);
    const txObject = await builder.buildBuyTransaction(quote, VALID_WALLET);

    const simResult = await builder.simulateTransaction(txObject);
    assert.strictEqual(simResult.status, 'SIMULATED_READ_ONLY');
    assert.strictEqual(simResult.isExecutable, false);
    assert.strictEqual(simResult.err, null);
    assert.ok(Array.isArray(simResult.logs));
  });

  // 11. Zero private key access
  runTest('Zero private keys or seed phrases accessed or stored in TransactionBuilder', () => {
    assert.strictEqual(process.env.SOLANA_PRIVATE_KEY, undefined);
    assert.strictEqual(process.env.PRIVATE_KEY, undefined);
    assert.strictEqual(process.env.SEED_PHRASE, undefined);
    const builder = new TransactionBuilder();
    assert.strictEqual(Object.keys(builder).includes('privateKey'), false);
    assert.strictEqual(Object.keys(builder).includes('secretKey'), false);
  });

  // 12. No signing, sendTransaction, or sendAndConfirmTransaction
  runTest('TransactionBuilder exposes no transaction signing or RPC send methods', () => {
    const builder = new TransactionBuilder();
    assert.strictEqual(typeof builder.signTransaction, 'undefined');
    assert.strictEqual(typeof builder.sendTransaction, 'undefined');
    assert.strictEqual(typeof builder.sendAndConfirmTransaction, 'undefined');
  });

  // 13. Verify paper_trades_history.json untouched
  runTest('paper_trades_history.json remains completely untouched and intact', () => {
    const currentRawHistory = fs.readFileSync(HISTORY_FILE_PATH, 'utf-8');
    const currentParsedHistory = JSON.parse(currentRawHistory);
    const currentGenuineCount = currentParsedHistory.filter(isGenuineMarketTrade).length;

    assert.strictEqual(currentRawHistory, initialRawHistory, 'File content must match initial content byte-for-byte');
    assert.strictEqual(currentParsedHistory.length, initialParsedHistory.length, 'Total trade records count must be unchanged');
    assert.strictEqual(currentGenuineCount, initialGenuineCount, 'Genuine trades count must remain exact');
  });

} finally {
  if (origTradingMode !== undefined) {
    process.env.TRADING_MODE = origTradingMode;
  } else {
    delete process.env.TRADING_MODE;
  }
  global.ALLOW_LIVE_EXECUTION = origAllowLive;
}

console.log('\n====================================================');
console.log(` TEST SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
console.log('====================================================\n');

if (passedTests !== totalTests) {
  process.exit(1);
}
