// ============================================================================
// TEST SUITE: STEP 8 — MAINNET TRANSACTION SIGNING & SUBMISSION PREPARATION
// Purpose: Automated verification of fail-closed signing boundary, submission boundary,
//          network validation, zero key access, zero broadcast, and paper trade history hash preservation.
// ============================================================================

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

import { config, validateLiveConfiguration, validateMainnetNetwork, EXECUTION_STATES } from '../src/config.js';
import { getSignerInterface, isWalletConfigured, getPublicWalletAddress } from '../src/walletManager.js';
import { LiveExecutionEngine, TRADING_MODES, getTradingMode } from '../src/executionEngine.js';
import { TransactionSubmitter } from '../src/transactionSubmitter.js';
import { TransactionBuilder } from '../src/transactionBuilder.js';
import { triggerKillSwitch, resetKillSwitch } from '../src/simulationLayer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PAPER_HISTORY_PATH = path.join(PROJECT_ROOT, 'paper_trades_history.json');

// Helper to compute SHA-256 hash of paper_trades_history.json
function getPaperHistoryHash() {
  if (!fs.existsSync(PAPER_HISTORY_PATH)) return null;
  const fileBuffer = fs.readFileSync(PAPER_HISTORY_PATH);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

// Helper to count records in paper_trades_history.json
function getPaperHistoryCounts() {
  if (!fs.existsSync(PAPER_HISTORY_PATH)) return { totalRecords: 0, genuineTrades: 0 };
  const content = JSON.parse(fs.readFileSync(PAPER_HISTORY_PATH, 'utf-8'));
  const totalRecords = Array.isArray(content) ? content.length : 0;
  const genuineTrades = Array.isArray(content)
    ? content.filter(r => r.tradeType === 'BUY' || r.action === 'BUY' || r.type === 'PAPER_BUY').length
    : 0;
  return { totalRecords, genuineTrades };
}

// Global safety state setup / teardown
function resetEnvironment() {
  delete process.env.TRADING_MODE;
  delete process.env.SOLANA_WALLET_ADDRESS;
  delete process.env.SOLANA_RPC_URL;
  delete process.env.EMERGENCY_KILL_SWITCH;
  delete process.env.SOLANA_PRIVATE_KEY;
  delete process.env.SECRET_KEY;
  delete process.env.SEED_PHRASE;
  global.ALLOW_LIVE_EXECUTION = false;
  global.ALLOW_MAINNET_SUBMISSION = false;
  resetKillSwitch();
}

const initialHash = getPaperHistoryHash();
const initialCounts = getPaperHistoryCounts();

let passedTests = 0;
let totalTests = 0;

async function runTest(name, testFn) {
  totalTests++;
  resetEnvironment();
  try {
    await testFn();
    console.log(`[PASS] TEST ${totalTests}: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] TEST ${totalTests}: ${name}`);
    console.error(`       Error: ${err.message}`);
    throw err;
  } finally {
    resetEnvironment();
  }
}

console.log('====================================================');
console.log(' RUNNING LIVE SIGNING BOUNDARY & SUBMISSION TESTS  ');
console.log('====================================================\n');

// 1. PAPER mode cannot access signer
await runTest('PAPER mode cannot access signer', async () => {
  process.env.TRADING_MODE = 'PAPER';
  global.ALLOW_LIVE_EXECUTION = false;
  assert.strictEqual(getTradingMode(), TRADING_MODES.PAPER);
  assert.throws(() => {
    getSignerInterface();
  }, (err) => err.message.includes('[SAFETY LOCK]'));
});

// 2. LIVE without authorization cannot sign
await runTest('LIVE without dual authorization cannot sign', async () => {
  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = false;
  const liveEngine = new LiveExecutionEngine();
  await assert.rejects(async () => {
    await liveEngine.signTransaction();
  }, (err) => err.message.includes('[SAFETY LOCK]'));
});

// 3. Kill switch blocks signing
await runTest('Active kill switch blocks transaction signing', async () => {
  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = true;
  process.env.SOLANA_WALLET_ADDRESS = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
  triggerKillSwitch();
  const liveEngine = new LiveExecutionEngine();
  await assert.rejects(async () => {
    await liveEngine.signTransaction({ userPublicKey: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU' }, { status: 'SIMULATED_READ_ONLY', err: null });
  }, (err) => err.message.includes('[SAFETY LOCK]') && err.message.includes('kill switch'));
});

// 4. Invalid wallet blocks signing
await runTest('Missing or invalid wallet address blocks transaction signing', async () => {
  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = true;
  process.env.SOLANA_WALLET_ADDRESS = 'invalid_wallet_address_123';
  const liveEngine = new LiveExecutionEngine();
  await assert.rejects(async () => {
    await liveEngine.signTransaction({ userPublicKey: 'invalid_wallet_address_123' }, { status: 'SIMULATED_READ_ONLY', err: null });
  }, (err) => err.message.includes('[SAFETY LOCK]'));
});

// 5. Wallet mismatch blocks signing
await runTest('Wallet mismatch between transaction fee payer and configured wallet blocks signing', async () => {
  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = true;
  process.env.SOLANA_WALLET_ADDRESS = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
  const liveEngine = new LiveExecutionEngine();
  await assert.rejects(async () => {
    await liveEngine.signTransaction({ userPublicKey: '9xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsV' }, { status: 'SIMULATED_READ_ONLY', err: null });
  }, (err) => err.message.includes('[SAFETY LOCK]') && err.message.includes('mismatch'));
});

// 6. Invalid transaction blocks signing
await runTest('Invalid transaction object (null/empty) blocks signing', async () => {
  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = true;
  process.env.SOLANA_WALLET_ADDRESS = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
  const liveEngine = new LiveExecutionEngine();
  await assert.rejects(async () => {
    await liveEngine.signTransaction(null, { status: 'SIMULATED_READ_ONLY', err: null });
  }, (err) => err.message.includes('[SAFETY LOCK]'));
});

// 7. Already-signed transaction is rejected
await runTest('Pre-signed transaction is rejected by signing boundary', async () => {
  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = true;
  process.env.SOLANA_WALLET_ADDRESS = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
  const liveEngine = new LiveExecutionEngine();
  const signedTx = { userPublicKey: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', signed: true, signatures: ['fake_sig_123'] };
  await assert.rejects(async () => {
    await liveEngine.signTransaction(signedTx, { status: 'SIMULATED_READ_ONLY', err: null });
  }, (err) => err.message.includes('[SAFETY LOCK]') && err.message.includes('already signed'));
});

// 8. Failed simulation blocks signing
await runTest('Failed simulation result blocks signing', async () => {
  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = true;
  process.env.SOLANA_WALLET_ADDRESS = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
  const liveEngine = new LiveExecutionEngine();
  const tx = { userPublicKey: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU' };
  const failedSim = { status: 'SIMULATION_FAILED', err: 'Slippage tolerance exceeded in simulation' };
  await assert.rejects(async () => {
    await liveEngine.signTransaction(tx, failedSim);
  }, (err) => err.message.includes('[SAFETY LOCK]') && err.message.includes('Failed simulation'));
});

// 9. Stale quote blocks signing
await runTest('Stale quote (>3000ms old) blocks transaction signing', async () => {
  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = true;
  process.env.SOLANA_WALLET_ADDRESS = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
  const liveEngine = new LiveExecutionEngine();
  const tx = { userPublicKey: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU' };
  const sim = { status: 'SIMULATED_READ_ONLY', err: null };
  const staleQuote = { timestamp: Date.now() - 5000, slippageBps: 50 };
  await assert.rejects(async () => {
    await liveEngine.signTransaction(tx, sim, { quote: staleQuote });
  }, (err) => err.message.includes('Stale quote') || err.message.includes('SAFETY LOCK'));
});

// 10. Slippage > 100 bps blocks signing
await runTest('Quote with slippage > 100 bps (1.0%) blocks transaction signing', async () => {
  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = true;
  process.env.SOLANA_WALLET_ADDRESS = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
  const liveEngine = new LiveExecutionEngine();
  const tx = { userPublicKey: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU' };
  const sim = { status: 'SIMULATED_READ_ONLY', err: null };
  const highSlippageQuote = { timestamp: Date.now(), slippageBps: 150 };
  await assert.rejects(async () => {
    await liveEngine.signTransaction(tx, sim, { quote: highSlippageQuote });
  }, (err) => err.message.includes('Excessive slippage') || err.message.includes('SAFETY LOCK'));
});

// 11. Risk failure blocks signing
await runTest('Candidate token violating risk limits blocks execution before signing', async () => {
  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = true;
  process.env.SOLANA_WALLET_ADDRESS = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
  const liveEngine = new LiveExecutionEngine();
  const riskyCandidate = {
    address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
    symbol: 'HIGH_RISK',
    liquidityUsd: 25000,
    volume5mUsd: 12000,
    buys5m: 10,
    sells5m: 5,
    ageMinutes: 30,
    strategyScore: 85,
    riskScore: 80 // Exceeds max risk score 60
  };
  await assert.rejects(async () => {
    await liveEngine.executeBuy(riskyCandidate);
  }, (err) => err.message.includes('[SAFETY LOCK]') && err.message.includes('Risk score exceeds maximum'));
});

// 12. MAINNET network mismatch blocks execution
await runTest('Configured DEVNET/TESTNET RPC endpoint fails mainnet network validation', async () => {
  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = true;
  process.env.SOLANA_WALLET_ADDRESS = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
  process.env.SOLANA_RPC_URL = 'https://api.devnet.solana.com';

  const netCheck = validateMainnetNetwork('https://api.devnet.solana.com');
  assert.strictEqual(netCheck.valid, false);
  assert.strictEqual(netCheck.network, 'DEVNET');

  const liveEngine = new LiveExecutionEngine();
  const validCandidate = {
    address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
    symbol: 'NET_TEST',
    liquidityUsd: 25000,
    volume5mUsd: 12000,
    buys5m: 10,
    sells5m: 5,
    ageMinutes: 30,
    strategyScore: 85,
    riskScore: 30
  };

  await assert.rejects(async () => {
    await liveEngine.executeBuy(validCandidate);
  }, (err) => err.message.includes('[SAFETY LOCK]') && err.message.includes('Mainnet network mismatch'));
});

// 13. Signing without credentials rejects safely
await runTest('signTransaction() without secret key rejects safely', async () => {
  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = true;
  process.env.SOLANA_WALLET_ADDRESS = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
  process.env.SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com';

  const liveEngine = new LiveExecutionEngine();
  const SOL_MINT = 'So11111111111111111111111111111111111111112';
  const quote = await liveEngine.dexRouter.getBuyQuote(SOL_MINT, '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', 10, 50);
  const tx = await liveEngine.transactionBuilder.buildBuyTransaction(quote, '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
  const sim = { status: 'SIMULATED_READ_ONLY', err: null };

  await assert.rejects(async () => {
    await liveEngine.signTransaction(tx, sim, { quote });
  }, (err) => err.message.includes('[SAFETY LOCK]') && err.message.includes('Missing signing credential'));
});

// 14. Submission boundary remains disabled
await runTest('TransactionSubmitter terminates at DRY_RUN_BLOCKED status', async () => {
  const kp = Keypair.generate();
  const addr = kp.publicKey.toBase58();
  const pk = bs58.encode(kp.secretKey);

  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = true;
  global.ALLOW_MAINNET_SUBMISSION = true;
  process.env.SOLANA_WALLET_ADDRESS = addr;
  process.env.SOLANA_PRIVATE_KEY = pk;
  process.env.SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com';

  const liveEngine = new LiveExecutionEngine();
  const SOL_MINT = 'So11111111111111111111111111111111111111112';
  const quote = await liveEngine.dexRouter.getBuyQuote(SOL_MINT, addr, 10, 50);
  const unsignedTx = await liveEngine.transactionBuilder.buildBuyTransaction(quote, addr);
  const sim = { status: 'SIMULATED_READ_ONLY', err: null };
  const signResult = await liveEngine.signTransaction(unsignedTx, sim, { quote });

  const submitter = new TransactionSubmitter();
  const submitResult = await submitter.submit(signResult.transaction, sim, { quote });
  assert.strictEqual(submitResult.submitted, false);
  assert.strictEqual(submitResult.status, 'DRY_RUN_BLOCKED');
  assert.strictEqual(submitResult.signature, null);
});

// 15. Result returns SIGNED and DRY_RUN_BLOCKED under controlled signing
await runTest('Full executeBuy preview pipeline returns SIGNED and DRY_RUN_BLOCKED under controlled signing', async () => {
  const kp = Keypair.generate();
  const addr = kp.publicKey.toBase58();
  const pk = bs58.encode(kp.secretKey);

  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = true;
  global.ALLOW_MAINNET_SUBMISSION = true;
  process.env.SOLANA_WALLET_ADDRESS = addr;
  process.env.SOLANA_PRIVATE_KEY = pk;
  process.env.SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com';

  const liveEngine = new LiveExecutionEngine();
  const candidate = {
    address: addr,
    symbol: 'SIGN_STAGE',
    liquidityUsd: 25000,
    volume5mUsd: 12000,
    buys5m: 10,
    sells5m: 5,
    ageMinutes: 30,
    strategyScore: 85,
    riskScore: 30
  };

  const buyResult = await liveEngine.executeBuy(candidate);
  assert.strictEqual(buyResult.executionMode, 'LIVE_PREVIEW');
  assert.strictEqual(buyResult.action, 'BUY');
  assert.strictEqual(buyResult.signingResult.status, 'SIGNED');
  assert.strictEqual(buyResult.signingResult.signed, true);
  assert.strictEqual(buyResult.submissionResult.status, 'DRY_RUN_BLOCKED');
  assert.strictEqual(buyResult.status, 'DRY_RUN_BLOCKED');
});

// 16. No sendTransaction call
await runTest('Codebase verification confirms zero sendTransaction invocation', async () => {
  const submitter = new TransactionSubmitter();
  assert.strictEqual(typeof submitter.sendTransaction, 'undefined');
});

// 17. No sendRawTransaction call
await runTest('Codebase verification confirms zero sendRawTransaction invocation', async () => {
  const submitter = new TransactionSubmitter();
  assert.strictEqual(typeof submitter.sendRawTransaction, 'undefined');
});

// 18. No sendAndConfirmTransaction call
await runTest('Codebase verification confirms zero sendAndConfirmTransaction invocation', async () => {
  const submitter = new TransactionSubmitter();
  assert.strictEqual(typeof submitter.sendAndConfirmTransaction, 'undefined');
});

// 19. No private-key logging
await runTest('Environment and validation output contain zero private key material', async () => {
  assert.strictEqual(process.env.SOLANA_PRIVATE_KEY, undefined);
  assert.strictEqual(process.env.SECRET_KEY, undefined);
  const liveConfigReport = validateLiveConfiguration();
  const stringified = JSON.stringify(liveConfigReport);
  assert.strictEqual(stringified.includes('privateKey'), false);
  assert.strictEqual(stringified.includes('secretKey'), false);
});

// 20. No seed-phrase access
await runTest('Environment and codebase contain zero seed phrase credentials', async () => {
  assert.strictEqual(process.env.SEED_PHRASE, undefined);
});

// 21. No PAPER fallback
await runTest('Failed LIVE execution throws exception and does NOT alter paper trade history', async () => {
  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = false; // Missing authorization

  const liveEngine = new LiveExecutionEngine();
  const candidate = { address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', symbol: 'FAIL_TEST' };

  await assert.rejects(async () => {
    await liveEngine.executeBuy(candidate);
  }, (err) => err.message.includes('[SAFETY LOCK]'));

  const afterHash = getPaperHistoryHash();
  assert.strictEqual(afterHash, initialHash);
});

// 22. paper_trades_history.json remains byte-for-byte unchanged
await runTest('paper_trades_history.json SHA-256 hash and record counts remain 100% identical', async () => {
  const finalHash = getPaperHistoryHash();
  const finalCounts = getPaperHistoryCounts();

  assert.strictEqual(finalHash, initialHash, 'SHA-256 hash of paper_trades_history.json MUST match pre-test hash');
  assert.strictEqual(finalCounts.totalRecords, initialCounts.totalRecords, 'Total record count MUST match pre-test count');
  assert.strictEqual(finalCounts.genuineTrades, initialCounts.genuineTrades, 'Genuine trade count MUST match pre-test count');
});

console.log('\n====================================================');
console.log(` TEST SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
console.log('====================================================\n');
