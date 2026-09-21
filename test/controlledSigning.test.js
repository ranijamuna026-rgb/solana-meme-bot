// ============================================================================
// TEST SUITE: STEP 9 — CONTROLLED MAINNET TRANSACTION SIGNING
// Purpose: Verification of fail-closed signing boundary, credential security,
//          mainnet transaction signing, submission barrier (DRY_RUN_BLOCKED),
//          zero key exposure, zero transaction broadcast, and paper history integrity.
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
  delete process.env.LIVE_EXECUTION_ARMED;
  delete process.env.ALLOW_MAINNET_SUBMISSION;
  delete process.env.SOLANA_PRIVATE_KEY;
  delete process.env.SECRET_KEY;
  delete process.env.SEED_PHRASE;
  global.ALLOW_LIVE_EXECUTION = false;
  global.LIVE_EXECUTION_ARMED = true;
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

// Generate valid keypairs for testing
const testKeypair1 = Keypair.generate();
const testWalletAddress1 = testKeypair1.publicKey.toBase58();
const testPrivateKey1Base58 = bs58.encode(testKeypair1.secretKey);

const testKeypair2 = Keypair.generate();
const testWalletAddress2 = testKeypair2.publicKey.toBase58();

console.log('====================================================');
console.log('   RUNNING STEP 9 — CONTROLLED SIGNING TESTS       ');
console.log('====================================================\n');

// 1. PAPER mode cannot sign
await runTest('PAPER mode cannot sign', async () => {
  process.env.TRADING_MODE = 'PAPER';
  global.ALLOW_LIVE_EXECUTION = false;
  assert.strictEqual(getTradingMode(), TRADING_MODES.PAPER);
  assert.throws(() => {
    getSignerInterface();
  }, (err) => err.message.includes('[SAFETY LOCK]'));
});

// 2. LIVE without authorization cannot sign
await runTest('LIVE without authorization cannot sign', async () => {
  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = false;
  const liveEngine = new LiveExecutionEngine();
  await assert.rejects(async () => {
    await liveEngine.signTransaction({ userPublicKey: testWalletAddress1 }, { status: 'SIMULATED_READ_ONLY', err: null });
  }, (err) => err.message.includes('[SAFETY LOCK]'));
});

// 3. LIVE without armed state cannot sign
await runTest('LIVE without armed state cannot sign', async () => {
  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = true;
  global.LIVE_EXECUTION_ARMED = false;
  const liveEngine = new LiveExecutionEngine();
  await assert.rejects(async () => {
    await liveEngine.signTransaction({ userPublicKey: testWalletAddress1 }, { status: 'SIMULATED_READ_ONLY', err: null });
  }, (err) => err.message.includes('[SAFETY LOCK]'));
});

// 4. kill switch blocks signing
await runTest('Emergency kill switch blocks transaction signing', async () => {
  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = true;
  global.LIVE_EXECUTION_ARMED = true;
  process.env.SOLANA_WALLET_ADDRESS = testWalletAddress1;
  triggerKillSwitch();
  const liveEngine = new LiveExecutionEngine();
  await assert.rejects(async () => {
    await liveEngine.signTransaction({ userPublicKey: testWalletAddress1 }, { status: 'SIMULATED_READ_ONLY', err: null });
  }, (err) => err.message.includes('[SAFETY LOCK]') && err.message.includes('kill switch'));
});

const SOL_MINT = 'So11111111111111111111111111111111111111112';

// 5. missing credential blocks signing
await runTest('Missing signing credential blocks signing', async () => {
  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = true;
  global.LIVE_EXECUTION_ARMED = true;
  process.env.SOLANA_WALLET_ADDRESS = testWalletAddress1;
  const liveEngine = new LiveExecutionEngine();
  const tx = { userPublicKey: testWalletAddress1, inputMint: SOL_MINT, outputMint: SOL_MINT, inAmount: 1, slippageBps: 50 };
  const sim = { status: 'SIMULATED_READ_ONLY', err: null };
  await assert.rejects(async () => {
    await liveEngine.signTransaction(tx, sim);
  }, (err) => err.message.includes('[SAFETY LOCK]') && err.message.includes('Missing signing credential'));
});

// 6. invalid credential blocks signing
await runTest('Invalid signing credential format blocks signing', async () => {
  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = true;
  global.LIVE_EXECUTION_ARMED = true;
  process.env.SOLANA_WALLET_ADDRESS = testWalletAddress1;
  process.env.SOLANA_PRIVATE_KEY = 'invalid_secret_key_format_123';
  const liveEngine = new LiveExecutionEngine();
  const tx = { userPublicKey: testWalletAddress1 };
  const sim = { status: 'SIMULATED_READ_ONLY', err: null };
  await assert.rejects(async () => {
    await liveEngine.signTransaction(tx, sim);
  }, (err) => err.message.includes('[SAFETY LOCK]') && (err.message.includes('Invalid signing credential') || err.message.includes('malformed')));
});

// 7. invalid transaction rejected
await runTest('Invalid transaction object is rejected', async () => {
  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = true;
  global.LIVE_EXECUTION_ARMED = true;
  process.env.SOLANA_WALLET_ADDRESS = testWalletAddress1;
  process.env.SOLANA_PRIVATE_KEY = testPrivateKey1Base58;
  const liveEngine = new LiveExecutionEngine();
  await assert.rejects(async () => {
    await liveEngine.signTransaction(null, { status: 'SIMULATED_READ_ONLY', err: null });
  }, (err) => err.message.includes('[SAFETY LOCK]') && err.message.includes('Invalid signing request'));
});

// 8. already-signed transaction rejected
await runTest('Pre-signed transaction is rejected', async () => {
  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = true;
  global.LIVE_EXECUTION_ARMED = true;
  process.env.SOLANA_WALLET_ADDRESS = testWalletAddress1;
  process.env.SOLANA_PRIVATE_KEY = testPrivateKey1Base58;
  const liveEngine = new LiveExecutionEngine();
  const signedTx = { userPublicKey: testWalletAddress1, isSigned: true, signatures: ['pre_existing_sig'] };
  await assert.rejects(async () => {
    await liveEngine.signTransaction(signedTx, { status: 'SIMULATED_READ_ONLY', err: null });
  }, (err) => err.message.includes('[SAFETY LOCK]') && err.message.includes('already signed'));
});

// 9. missing fee payer rejected
await runTest('Missing fee payer in transaction is rejected', async () => {
  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = true;
  global.LIVE_EXECUTION_ARMED = true;
  process.env.SOLANA_WALLET_ADDRESS = testWalletAddress1;
  process.env.SOLANA_PRIVATE_KEY = testPrivateKey1Base58;
  const liveEngine = new LiveExecutionEngine();
  const txNoFeePayer = { userPublicKey: null, feePayer: null };
  await assert.rejects(async () => {
    await liveEngine.signTransaction(txNoFeePayer, { status: 'SIMULATED_READ_ONLY', err: null });
  }, (err) => err.message.includes('[SAFETY LOCK]') && err.message.includes('mismatch'));
});

// 10. wrong fee payer rejected
await runTest('Transaction fee payer mismatching configured wallet address is rejected', async () => {
  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = true;
  global.LIVE_EXECUTION_ARMED = true;
  process.env.SOLANA_WALLET_ADDRESS = testWalletAddress1;
  process.env.SOLANA_PRIVATE_KEY = testPrivateKey1Base58;
  const liveEngine = new LiveExecutionEngine();
  const txWrongFeePayer = { userPublicKey: testWalletAddress2, feePayer: testWalletAddress2 };
  await assert.rejects(async () => {
    await liveEngine.signTransaction(txWrongFeePayer, { status: 'SIMULATED_READ_ONLY', err: null });
  }, (err) => err.message.includes('[SAFETY LOCK]') && err.message.includes('mismatch'));
});

// 11. wallet mismatch rejected
await runTest('Signing credential public key mismatching configured wallet is rejected', async () => {
  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = true;
  global.LIVE_EXECUTION_ARMED = true;
  process.env.SOLANA_WALLET_ADDRESS = testWalletAddress2; // Configured for Wallet 2
  process.env.SOLANA_PRIVATE_KEY = testPrivateKey1Base58; // Credential for Wallet 1
  const liveEngine = new LiveExecutionEngine();
  const tx = { userPublicKey: testWalletAddress2, feePayer: testWalletAddress2 };
  await assert.rejects(async () => {
    await liveEngine.signTransaction(tx, { status: 'SIMULATED_READ_ONLY', err: null });
  }, (err) => err.message.includes('[SAFETY LOCK]') && err.message.includes('mismatch'));
});

// 12. invalid network rejected
await runTest('Configured DEVNET RPC endpoint fails mainnet network validation before signing', async () => {
  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = true;
  global.LIVE_EXECUTION_ARMED = true;
  process.env.SOLANA_WALLET_ADDRESS = testWalletAddress1;
  process.env.SOLANA_PRIVATE_KEY = testPrivateKey1Base58;
  process.env.SOLANA_RPC_URL = 'https://api.devnet.solana.com';
  const liveEngine = new LiveExecutionEngine();
  const tx = { userPublicKey: testWalletAddress1 };
  await assert.rejects(async () => {
    await liveEngine.signTransaction(tx, { status: 'SIMULATED_READ_ONLY', err: null }, { rpcUrl: 'https://api.devnet.solana.com' });
  }, (err) => err.message.includes('[SAFETY LOCK]') && err.message.includes('Mainnet network mismatch'));
});

// 13. failed simulation rejected
await runTest('Failed simulation result is rejected before signing', async () => {
  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = true;
  global.LIVE_EXECUTION_ARMED = true;
  process.env.SOLANA_WALLET_ADDRESS = testWalletAddress1;
  process.env.SOLANA_PRIVATE_KEY = testPrivateKey1Base58;
  const liveEngine = new LiveExecutionEngine();
  const tx = { userPublicKey: testWalletAddress1 };
  const failedSim = { status: 'SIMULATION_FAILED', err: 'Slippage limit exceeded' };
  await assert.rejects(async () => {
    await liveEngine.signTransaction(tx, failedSim);
  }, (err) => err.message.includes('[SAFETY LOCK]') && err.message.includes('Failed simulation'));
});

// 14. valid LIVE transaction signs successfully
await runTest('Valid LIVE transaction signs successfully under controlled boundary', async () => {
  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = true;
  global.LIVE_EXECUTION_ARMED = true;
  process.env.SOLANA_WALLET_ADDRESS = testWalletAddress1;
  process.env.SOLANA_PRIVATE_KEY = testPrivateKey1Base58;
  process.env.SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com';

  const liveEngine = new LiveExecutionEngine();
  const quote = await liveEngine.dexRouter.getBuyQuote(SOL_MINT, testWalletAddress1, 10, 50);
  const tx = await liveEngine.transactionBuilder.buildBuyTransaction(quote, testWalletAddress1);
  const sim = { status: 'SIMULATED_READ_ONLY', err: null };

  const signResult = await liveEngine.signTransaction(tx, sim, { quote });
  assert.strictEqual(signResult.signed, true);
  assert.strictEqual(signResult.status, 'SIGNED');
  assert.strictEqual(signResult.signerPublicKey, testWalletAddress1);
  assert.ok(Array.isArray(signResult.signatures));
  assert.ok(signResult.signatures.includes(testWalletAddress1));
});

// 15. signed transaction contains expected signer
await runTest('Signed transaction contains expected signer public key', async () => {
  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = true;
  global.LIVE_EXECUTION_ARMED = true;
  process.env.SOLANA_WALLET_ADDRESS = testWalletAddress1;
  process.env.SOLANA_PRIVATE_KEY = testPrivateKey1Base58;

  const liveEngine = new LiveExecutionEngine();
  const quote = await liveEngine.dexRouter.getBuyQuote(SOL_MINT, testWalletAddress1, 10, 50);
  const tx = await liveEngine.transactionBuilder.buildBuyTransaction(quote, testWalletAddress1);
  const sim = { status: 'SIMULATED_READ_ONLY', err: null };

  const signResult = await liveEngine.signTransaction(tx, sim, { quote });
  assert.strictEqual(signResult.signerPublicKey, testWalletAddress1);
  assert.strictEqual(signResult.transaction.isSigned, true);
});

// 16. signed transaction remains valid
await runTest('Signed transaction remains structurally valid', async () => {
  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = true;
  global.LIVE_EXECUTION_ARMED = true;
  process.env.SOLANA_WALLET_ADDRESS = testWalletAddress1;
  process.env.SOLANA_PRIVATE_KEY = testPrivateKey1Base58;

  const liveEngine = new LiveExecutionEngine();
  const quote = await liveEngine.dexRouter.getBuyQuote(SOL_MINT, testWalletAddress1, 10, 50);
  const tx = await liveEngine.transactionBuilder.buildBuyTransaction(quote, testWalletAddress1);
  const sim = { status: 'SIMULATED_READ_ONLY', err: null };

  const signResult = await liveEngine.signTransaction(tx, sim, { quote });
  assert.strictEqual(signResult.transaction.userPublicKey, testWalletAddress1);
  assert.strictEqual(signResult.transaction.action, 'BUY');
  assert.ok(signResult.transaction.rawTransaction);
});

// 17. secret material is never exposed
await runTest('Signing result and metadata contain zero secret key or credential material', async () => {
  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = true;
  global.LIVE_EXECUTION_ARMED = true;
  process.env.SOLANA_WALLET_ADDRESS = testWalletAddress1;
  process.env.SOLANA_PRIVATE_KEY = testPrivateKey1Base58;

  const liveEngine = new LiveExecutionEngine();
  const quote = await liveEngine.dexRouter.getBuyQuote(SOL_MINT, testWalletAddress1, 10, 50);
  const tx = await liveEngine.transactionBuilder.buildBuyTransaction(quote, testWalletAddress1);
  const sim = { status: 'SIMULATED_READ_ONLY', err: null };

  const signResult = await liveEngine.signTransaction(tx, sim, { quote });
  const stringified = JSON.stringify(signResult);
  assert.strictEqual(stringified.includes('secretKey'), false);
  assert.strictEqual(stringified.includes('privateKey'), false);
  assert.strictEqual(stringified.includes('seedPhrase'), false);
  assert.strictEqual(stringified.includes(testPrivateKey1Base58), false);
});

// 18. signed BUY still ends in DRY_RUN_BLOCKED
await runTest('Full executeBuy pipeline with controlled signing terminates at DRY_RUN_BLOCKED', async () => {
  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = true;
  global.LIVE_EXECUTION_ARMED = true;
  global.ALLOW_MAINNET_SUBMISSION = true;
  process.env.SOLANA_WALLET_ADDRESS = testWalletAddress1;
  process.env.SOLANA_PRIVATE_KEY = testPrivateKey1Base58;
  process.env.SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com';

  const liveEngine = new LiveExecutionEngine();
  const validCandidate = {
    address: testWalletAddress1,
    symbol: 'STEP9_BUY',
    liquidityUsd: 25000,
    volume5mUsd: 12000,
    buys5m: 10,
    sells5m: 5,
    ageMinutes: 30,
    strategyScore: 85,
    riskScore: 30
  };

  const buyResult = await liveEngine.executeBuy(validCandidate);
  assert.strictEqual(buyResult.executionMode, 'LIVE_PREVIEW');
  assert.strictEqual(buyResult.action, 'BUY');
  assert.strictEqual(buyResult.signingResult.signed, true);
  assert.strictEqual(buyResult.signingResult.status, 'SIGNED');
  assert.strictEqual(buyResult.submissionResult.submitted, false);
  assert.strictEqual(buyResult.submissionResult.status, 'DRY_RUN_BLOCKED');
  assert.strictEqual(buyResult.status, 'DRY_RUN_BLOCKED');
});

// 19. signed SELL still ends in DRY_RUN_BLOCKED
await runTest('Full executeSell pipeline with controlled signing terminates at DRY_RUN_BLOCKED', async () => {
  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = true;
  global.LIVE_EXECUTION_ARMED = true;
  global.ALLOW_MAINNET_SUBMISSION = true;
  process.env.SOLANA_WALLET_ADDRESS = testWalletAddress1;
  process.env.SOLANA_PRIVATE_KEY = testPrivateKey1Base58;
  process.env.SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com';

  const liveEngine = new LiveExecutionEngine();
  const validTradeRecord = {
    tokenAddress: testWalletAddress2,
    quantity: 100,
    entryPrice: 0.0001
  };

  const sellResult = await liveEngine.executeSell(validTradeRecord, 0.0002, 1000, 'TAKE_PROFIT');
  assert.strictEqual(sellResult.executionMode, 'LIVE_PREVIEW');
  assert.strictEqual(sellResult.action, 'SELL');
  assert.strictEqual(sellResult.signingResult.signed, true);
  assert.strictEqual(sellResult.signingResult.status, 'SIGNED');
  assert.strictEqual(sellResult.submissionResult.submitted, false);
  assert.strictEqual(sellResult.submissionResult.status, 'DRY_RUN_BLOCKED');
  assert.strictEqual(sellResult.status, 'DRY_RUN_BLOCKED');
});

// 20. no transaction submission APIs are invoked
await runTest('Codebase verification confirms zero transaction submission API availability', async () => {
  const submitter = new TransactionSubmitter();
  assert.strictEqual(typeof submitter.sendTransaction, 'undefined');
  assert.strictEqual(typeof submitter.sendRawTransaction, 'undefined');
  assert.strictEqual(typeof submitter.sendAndConfirmTransaction, 'undefined');
});

// 21. no paper-history modification
await runTest('Failed or signed LIVE execution does NOT alter paper trade history', async () => {
  const currentHash = getPaperHistoryHash();
  assert.strictEqual(currentHash, initialHash);
});

// 22. risk violations never reach signing
await runTest('Candidate token violating risk thresholds blocks execution before signing', async () => {
  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = true;
  global.LIVE_EXECUTION_ARMED = true;
  process.env.SOLANA_WALLET_ADDRESS = testWalletAddress1;
  process.env.SOLANA_PRIVATE_KEY = testPrivateKey1Base58;

  const liveEngine = new LiveExecutionEngine();
  const riskyCandidate = {
    address: testWalletAddress1,
    symbol: 'HIGH_RISK_S9',
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

// 23. stale quote never reaches signing
await runTest('Stale quote (>3000ms old) blocks transaction signing', async () => {
  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = true;
  global.LIVE_EXECUTION_ARMED = true;
  process.env.SOLANA_WALLET_ADDRESS = testWalletAddress1;
  process.env.SOLANA_PRIVATE_KEY = testPrivateKey1Base58;

  const liveEngine = new LiveExecutionEngine();
  const tx = { userPublicKey: testWalletAddress1, feePayer: testWalletAddress1 };
  const sim = { status: 'SIMULATED_READ_ONLY', err: null };
  const staleQuote = { timestamp: Date.now() - 5000, slippageBps: 50 };

  await assert.rejects(async () => {
    await liveEngine.signTransaction(tx, sim, { quote: staleQuote });
  }, (err) => err.message.includes('Stale quote') || err.message.includes('SAFETY LOCK'));
});

// 24. excessive slippage never reaches signing
await runTest('Quote with slippage > 100 bps (1.0%) blocks transaction signing', async () => {
  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = true;
  global.LIVE_EXECUTION_ARMED = true;
  process.env.SOLANA_WALLET_ADDRESS = testWalletAddress1;
  process.env.SOLANA_PRIVATE_KEY = testPrivateKey1Base58;

  const liveEngine = new LiveExecutionEngine();
  const tx = { userPublicKey: testWalletAddress1, feePayer: testWalletAddress1 };
  const sim = { status: 'SIMULATED_READ_ONLY', err: null };
  const highSlippageQuote = { timestamp: Date.now(), slippageBps: 150 };

  await assert.rejects(async () => {
    await liveEngine.signTransaction(tx, sim, { quote: highSlippageQuote });
  }, (err) => err.message.includes('Excessive slippage') || err.message.includes('SAFETY LOCK'));
});

// Final check on paper history integrity
const finalHash = getPaperHistoryHash();
const finalCounts = getPaperHistoryCounts();
assert.strictEqual(finalHash, initialHash, 'SHA-256 hash of paper_trades_history.json MUST match pre-test hash');
assert.strictEqual(finalCounts.totalRecords, initialCounts.totalRecords, 'Total record count MUST match pre-test count');
assert.strictEqual(finalCounts.genuineTrades, initialCounts.genuineTrades, 'Genuine trade count MUST match pre-test count');

console.log('\n====================================================');
console.log(` STEP 9 TEST SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
console.log('====================================================\n');
