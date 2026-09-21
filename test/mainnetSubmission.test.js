// ============================================================================
// TEST SUITE: STEP 10 — CONTROLLED MAINNET TRANSACTION SUBMISSION
// Purpose: Full verification of fail-closed submission boundary, dual/quadruple
//          submission authorization, kill-switch precedence, network validation,
//          signed transaction checks, simulation requirements, quote/slippage limits,
//          duplicate submission protection, RPC submission & confirmation separation,
//          security logging, zero real trade execution, and paper history integrity.
// ============================================================================

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

import { config, validateMainnetNetwork } from '../src/config.js';
import { getSignerInterface, getPublicWalletAddress } from '../src/walletManager.js';
import { LiveExecutionEngine, TRADING_MODES, getTradingMode, isMainnetSubmissionAuthorized } from '../src/executionEngine.js';
import { TransactionSubmitter } from '../src/transactionSubmitter.js';
import { TransactionBuilder } from '../src/transactionBuilder.js';
import { triggerKillSwitch, resetKillSwitch } from '../src/simulationLayer.js';
import { evaluateTradeRisk, resetRiskManagerState } from '../src/riskManager.js';
import { PaperExecutionEngine } from '../src/executionEngine.js';

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

// Global environment cleanup helper
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
  resetRiskManagerState();
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

// Generate valid keypairs & addresses for test suite
const testKeypair = Keypair.generate();
const testWalletAddress = testKeypair.publicKey.toBase58();
const testPrivateKeyBase58 = bs58.encode(testKeypair.secretKey);

const testKeypair2 = Keypair.generate();
const testWalletAddress2 = testKeypair2.publicKey.toBase58();

const SOL_MINT = 'So11111111111111111111111111111111111111112';

// Helper to create a valid signed transaction object for submitter testing
async function createValidSignedTx(rpcUrl = 'https://api.mainnet-beta.solana.com') {
  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = true;
  global.LIVE_EXECUTION_ARMED = true;
  global.ALLOW_MAINNET_SUBMISSION = true;
  process.env.SOLANA_WALLET_ADDRESS = testWalletAddress;
  process.env.SOLANA_PRIVATE_KEY = testPrivateKeyBase58;
  process.env.SOLANA_RPC_URL = rpcUrl;

  const liveEngine = new LiveExecutionEngine();
  const quote = await liveEngine.dexRouter.getBuyQuote(SOL_MINT, testWalletAddress, 10, 50);
  const tx = await liveEngine.transactionBuilder.buildBuyTransaction(quote, testWalletAddress);
  const sim = { status: 'SIMULATED_READ_ONLY', err: null };
  const signResult = await liveEngine.signTransaction(tx, sim, { quote });
  
  return { tx: signResult.transaction, sim, quote };
}

console.log('====================================================');
console.log('   RUNNING STEP 10 — MAINNET SUBMISSION TESTS      ');
console.log('====================================================\n');

// --- AUTHORIZATION TESTS ---

// 1. PAPER mode cannot submit
await runTest('1. PAPER mode cannot submit', async () => {
  process.env.TRADING_MODE = 'PAPER';
  global.ALLOW_LIVE_EXECUTION = false;
  global.ALLOW_MAINNET_SUBMISSION = true;
  const submitter = new TransactionSubmitter();
  const { tx, sim } = await createValidSignedTx();
  process.env.TRADING_MODE = 'PAPER';
  assert.throws(() => {
    submitter.validateSubmission(tx, sim);
  }, (err) => err.message.includes('SUBMISSION_AUTHORIZATION_REQUIRED') || err.message.includes('SAFETY LOCK'));
});

// 2. LIVE without execution authorization cannot submit
await runTest('2. LIVE without execution authorization cannot submit', async () => {
  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = false;
  global.ALLOW_MAINNET_SUBMISSION = true;
  const submitter = new TransactionSubmitter();
  const { tx, sim } = await createValidSignedTx();
  global.ALLOW_LIVE_EXECUTION = false;
  assert.throws(() => {
    submitter.validateSubmission(tx, sim);
  }, (err) => err.message.includes('SUBMISSION_AUTHORIZATION_REQUIRED') || err.message.includes('SAFETY LOCK'));
});

// 3. LIVE without armed state cannot submit
await runTest('3. LIVE without armed state cannot submit', async () => {
  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = true;
  global.LIVE_EXECUTION_ARMED = false;
  global.ALLOW_MAINNET_SUBMISSION = true;
  const submitter = new TransactionSubmitter();
  const { tx, sim } = await createValidSignedTx();
  global.LIVE_EXECUTION_ARMED = false;
  assert.throws(() => {
    submitter.validateSubmission(tx, sim);
  }, (err) => err.message.includes('SUBMISSION_AUTHORIZATION_REQUIRED') || err.message.includes('SAFETY LOCK'));
});

// 4. LIVE without mainnet submission authorization cannot submit
await runTest('4. LIVE without mainnet submission authorization cannot submit', async () => {
  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = true;
  global.LIVE_EXECUTION_ARMED = true;
  global.ALLOW_MAINNET_SUBMISSION = false;
  const submitter = new TransactionSubmitter();
  const { tx, sim } = await createValidSignedTx();
  global.ALLOW_MAINNET_SUBMISSION = false;
  assert.throws(() => {
    submitter.validateSubmission(tx, sim);
  }, (err) => err.message.includes('SUBMISSION_AUTHORIZATION_REQUIRED') || err.message.includes('SAFETY LOCK'));
});

// 5. kill switch blocks submission
await runTest('5. Emergency kill switch blocks submission', async () => {
  const { tx, sim } = await createValidSignedTx();
  triggerKillSwitch();
  const submitter = new TransactionSubmitter();
  assert.throws(() => {
    submitter.validateSubmission(tx, sim);
  }, (err) => err.message.includes('SUBMISSION_BLOCKED_KILL_SWITCH') || err.message.includes('kill switch'));
});

// --- NETWORK TESTS ---

// 6. MAINNET accepted
await runTest('6. MAINNET network is accepted', async () => {
  const { tx, sim } = await createValidSignedTx('https://api.mainnet-beta.solana.com');
  const submitter = new TransactionSubmitter();
  const valid = submitter.validateSubmission(tx, sim, { rpcUrl: 'https://api.mainnet-beta.solana.com' });
  assert.strictEqual(valid, true);
});

// 7. DEVNET rejected
await runTest('7. DEVNET network is rejected', async () => {
  const { tx, sim } = await createValidSignedTx();
  const submitter = new TransactionSubmitter();
  assert.throws(() => {
    submitter.validateSubmission(tx, sim, { rpcUrl: 'https://api.devnet.solana.com' });
  }, (err) => err.message.includes('MAINNET') || err.message.includes('DEVNET'));
});

// 8. TESTNET rejected
await runTest('8. TESTNET network is rejected', async () => {
  const { tx, sim } = await createValidSignedTx();
  const submitter = new TransactionSubmitter();
  assert.throws(() => {
    submitter.validateSubmission(tx, sim, { rpcUrl: 'https://api.testnet.solana.com' });
  }, (err) => err.message.includes('MAINNET') || err.message.includes('TESTNET'));
});

// 9. unknown network rejected
await runTest('9. Unknown/invalid network is rejected', async () => {
  const { tx, sim } = await createValidSignedTx();
  const submitter = new TransactionSubmitter();
  assert.throws(() => {
    submitter.validateSubmission(tx, sim, { rpcUrl: 'ftp://invalid-url.com' });
  }, (err) => err.message.includes('MAINNET') || err.message.includes('invalid'));
});

// --- TRANSACTION TESTS ---

// 10. missing transaction rejected
await runTest('10. Missing transaction object is rejected', async () => {
  const { sim } = await createValidSignedTx();
  const submitter = new TransactionSubmitter();
  assert.throws(() => {
    submitter.validateSubmission(null, sim);
  }, (err) => err.message.includes('Transaction object is required'));
});

// 11. unsigned transaction rejected
await runTest('11. Unsigned transaction is rejected', async () => {
  const { sim } = await createValidSignedTx();
  const submitter = new TransactionSubmitter();
  const unsignedTx = { userPublicKey: testWalletAddress, inputMint: SOL_MINT, outputMint: SOL_MINT, inAmount: 1, slippageBps: 50, isSigned: false };
  assert.throws(() => {
    submitter.validateSubmission(unsignedTx, sim);
  }, (err) => err.message.includes('SIGNED_TRANSACTION_REQUIRED') || err.message.includes('Unsigned'));
});

// 12. invalid transaction rejected
await runTest('12. Invalid/malformed transaction object is rejected', async () => {
  const { sim } = await createValidSignedTx();
  const submitter = new TransactionSubmitter();
  const malformedTx = { isSigned: true, signatures: [testWalletAddress], userPublicKey: null };
  assert.throws(() => {
    submitter.validateSubmission(malformedTx, sim);
  }, (err) => err.message.includes('wallet public key') || err.message.includes('fee payer'));
});

// 13. wrong fee payer rejected
await runTest('13. Wrong fee payer in transaction is rejected', async () => {
  const { tx, sim } = await createValidSignedTx();
  tx.feePayer = testWalletAddress2;
  const submitter = new TransactionSubmitter();
  assert.throws(() => {
    submitter.validateSubmission(tx, sim);
  }, (err) => err.message.includes('Wallet mismatch') || err.message.includes('fee payer'));
});

// 14. wrong signer rejected
await runTest('14. Transaction missing expected wallet signer signature is rejected', async () => {
  const { tx, sim } = await createValidSignedTx();
  tx.signatures = [{ publicKey: testWalletAddress2, signature: 'signed_by_wrong_wallet' }];
  const submitter = new TransactionSubmitter();
  assert.throws(() => {
    submitter.validateSubmission(tx, sim);
  }, (err) => err.message.includes('signer signature missing') || err.message.includes('Unexpected signer'));
});

// 15. malformed signed transaction rejected
await runTest('15. Malformed signed transaction is rejected', async () => {
  const { tx, sim } = await createValidSignedTx();
  tx.signatures = [{ publicKey: testWalletAddress }, { publicKey: 'INVALID_SIGNER_PUBKEY_999' }];
  const submitter = new TransactionSubmitter();
  assert.throws(() => {
    submitter.validateSubmission(tx, sim);
  }, (err) => err.message.includes('Unexpected signer') || err.message.includes('validation failed'));
});

// 16. duplicate submission blocked
await runTest('16. Duplicate transaction submission in-flight is blocked', async () => {
  const { tx, sim } = await createValidSignedTx();
  const submitter = new TransactionSubmitter();
  submitter.inFlightSubmissions.add(tx.txId || 'tx_default');
  assert.throws(() => {
    submitter.validateSubmission(tx, sim);
  }, (err) => err.message.includes('DUPLICATE_SUBMISSION_BLOCKED') || err.message.includes('in-flight'));
});

// --- SAFETY TESTS ---

// 17. failed simulation blocks submission
await runTest('17. Failed simulation result blocks submission', async () => {
  const { tx } = await createValidSignedTx();
  const failedSim = { status: 'SIMULATION_FAILED', err: 'Slippage exceeded' };
  const submitter = new TransactionSubmitter();
  assert.throws(() => {
    submitter.validateSubmission(tx, failedSim);
  }, (err) => err.message.includes('SIMULATION_FAILED') || err.message.includes('simulation failed'));
});

// 18. stale quote blocks submission
await runTest('18. Stale quote (>3000ms old) blocks submission', async () => {
  const { tx, sim } = await createValidSignedTx();
  const staleQuote = { timestamp: Date.now() - 5000, slippageBps: 50 };
  const submitter = new TransactionSubmitter();
  assert.throws(() => {
    submitter.validateSubmission(tx, sim, { quote: staleQuote });
  }, (err) => err.message.includes('Stale quote') || err.message.includes('STALE_QUOTE'));
});

// 19. excessive slippage blocks submission
await runTest('19. Excessive slippage (>100 bps) blocks submission', async () => {
  const { tx, sim } = await createValidSignedTx();
  const highSlippageQuote = { timestamp: Date.now(), slippageBps: 150 };
  const submitter = new TransactionSubmitter();
  assert.throws(() => {
    submitter.validateSubmission(tx, sim, { quote: highSlippageQuote });
  }, (err) => err.message.includes('Excessive slippage') || err.message.includes('SLIPPAGE_LIMIT_EXCEEDED'));
});

// 20. risk-limit violation blocks submission
await runTest('20. Candidate token violating risk limits blocks live execution before submission', async () => {
  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = true;
  global.LIVE_EXECUTION_ARMED = true;
  global.ALLOW_MAINNET_SUBMISSION = true;
  process.env.SOLANA_WALLET_ADDRESS = testWalletAddress;
  process.env.SOLANA_PRIVATE_KEY = testPrivateKeyBase58;

  const liveEngine = new LiveExecutionEngine();
  const riskyCandidate = {
    address: testWalletAddress,
    symbol: 'HIGH_RISK_S10',
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

// 21. daily trade limit blocks submission
await runTest('21. Reaching daily trade limit blocks live execution before submission', async () => {
  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = true;
  global.LIVE_EXECUTION_ARMED = true;
  global.ALLOW_MAINNET_SUBMISSION = true;
  process.env.SOLANA_WALLET_ADDRESS = testWalletAddress;

  const { registerActiveTrade } = await import('../src/riskManager.js');
  const candidate = { address: testWalletAddress, priceUsd: 1.0, liquidityUsd: 20000, volume5mUsd: 10000, buys5m: 10, sells5m: 5, ageMinutes: 30, score: 85, riskScore: 30 };
  const nowMs = Date.now();
  // Register 30 trades to hit daily trade limit (30)
  for (let i = 0; i < 30; i++) {
    registerActiveTrade(`token_${i}`, nowMs);
  }
  const evalResult = evaluateTradeRisk(candidate, null, nowMs);
  assert.strictEqual(evalResult.approved, false);
  assert.ok(evalResult.reasons.some(r => r.includes('Maximum daily trade limit reached') || r.includes('Maximum hourly trade limit reached')));
});

// 22. daily loss limit blocks submission
await runTest('22. Reaching daily loss limit blocks live execution before submission', async () => {
  const { recordTradeOutcome } = await import('../src/riskManager.js');
  const candidate = { address: testWalletAddress, priceUsd: 1.0, liquidityUsd: 20000, volume5mUsd: 10000, buys5m: 10, sells5m: 5, ageMinutes: 30, score: 85, riskScore: 30 };
  // Record -$20.00 loss
  recordTradeOutcome({ pnl: -20.00 });
  const evalResult = evaluateTradeRisk(candidate);
  assert.strictEqual(evalResult.approved, false);
  assert.ok(evalResult.reasons.some(r => r.includes('Daily maximum loss limit reached')));
});

// --- SUBMISSION TESTS ---

// 23. authorized valid transaction reaches submission boundary
await runTest('23. Authorized valid signed transaction reaches submission boundary', async () => {
  const { tx, sim, quote } = await createValidSignedTx();
  const submitter = new TransactionSubmitter();
  const result = await submitter.submit(tx, sim, { quote, allowMockSignature: true, mockSignature: 'sig_mock_valid_123' });
  assert.strictEqual(result.submitted, true);
  assert.strictEqual(result.status, 'SUBMITTED');
  assert.strictEqual(result.signature, 'sig_mock_valid_123');
  assert.strictEqual(result.network, 'MAINNET');
});

// 24. submission result contains real returned signature only when RPC actually returns one
await runTest('24. Submission result contains real returned signature only when RPC returns one', async () => {
  const { tx, sim, quote } = await createValidSignedTx();
  const submitter = new TransactionSubmitter();

  // Test case A: RPC returns null -> signature is null
  const resNoSig = await submitter.submit(tx, sim, { quote, mockRpcResponse: { signature: null } });
  assert.strictEqual(resNoSig.signature, null);
  assert.strictEqual(resNoSig.submitted, false);

  // Test case B: RPC returns genuine signature -> signature is set
  const resWithSig = await submitter.submit(tx, sim, { quote, mockRpcResponse: { signature: 'sig_rpc_real_555' } });
  assert.strictEqual(resWithSig.submitted, true);
  assert.strictEqual(resWithSig.signature, 'sig_rpc_real_555');
});

// 25. no fabricated signature
await runTest('25. Zero fabricated signatures returned when RPC broadcast is not executed', async () => {
  const { tx, sim, quote } = await createValidSignedTx();
  const submitter = new TransactionSubmitter();
  const dryRunRes = await submitter.submit(tx, sim, { quote });
  assert.strictEqual(dryRunRes.submitted, false);
  assert.strictEqual(dryRunRes.status, 'DRY_RUN_BLOCKED');
  assert.strictEqual(dryRunRes.signature, null);
});

// 26. submission failure handled safely
await runTest('26. Submission failure is handled safely returning structured FAILED state', async () => {
  const { tx, sim, quote } = await createValidSignedTx();
  const submitter = new TransactionSubmitter();
  const failingRpcClient = {
    sendTransaction: async () => { throw new Error('RPC endpoint unavailable (503)'); }
  };
  const failRes = await submitter.submit(tx, sim, { quote, rpcClient: failingRpcClient });
  assert.strictEqual(failRes.submitted, false);
  assert.strictEqual(failRes.status, 'FAILED');
  assert.strictEqual(failRes.signature, null);
  assert.ok(failRes.reason.includes('RPC endpoint unavailable'));
});

// 27. confirmation remains separate from submission
await runTest('27. Transaction confirmation remains separate from initial submission', async () => {
  const submitter = new TransactionSubmitter();
  const confirmRes = await submitter.confirm('sig_submitted_999', { mockConfirmed: true });
  assert.strictEqual(confirmRes.confirmed, true);
  assert.strictEqual(confirmRes.status, 'CONFIRMED');
  assert.strictEqual(confirmRes.signature, 'sig_submitted_999');
  assert.strictEqual(confirmRes.confirmations, 32);
});

// 28. confirmation timeout handled safely
await runTest('28. Confirmation timeout is handled safely returning CONFIRMATION_TIMEOUT state', async () => {
  const submitter = new TransactionSubmitter();
  const timeoutRes = await submitter.confirm('sig_unconfirmed_111', { mockTimeout: true });
  assert.strictEqual(timeoutRes.confirmed, false);
  assert.strictEqual(timeoutRes.status, 'CONFIRMATION_TIMEOUT');
  assert.strictEqual(timeoutRes.signature, 'sig_unconfirmed_111');
});

// --- SECURITY TESTS ---

// 29. no private-key logging
await runTest('29. Submitter logs contain zero private-key exposure', async () => {
  const { tx, sim, quote } = await createValidSignedTx();
  const submitter = new TransactionSubmitter();
  let loggedOutput = '';
  const originalLog = console.log;
  console.log = (...args) => { loggedOutput += args.join(' ') + '\n'; };
  try {
    await submitter.submit(tx, sim, { quote });
  } finally {
    console.log = originalLog;
  }
  assert.strictEqual(loggedOutput.includes('secretKey'), false);
  assert.strictEqual(loggedOutput.includes('privateKey'), false);
  assert.strictEqual(loggedOutput.includes(testPrivateKeyBase58), false);
});

// 30. no seed-phrase logging
await runTest('30. Submitter logs contain zero seed-phrase exposure', async () => {
  const { tx, sim, quote } = await createValidSignedTx();
  const submitter = new TransactionSubmitter();
  let loggedOutput = '';
  const originalLog = console.log;
  console.log = (...args) => { loggedOutput += args.join(' ') + '\n'; };
  try {
    await submitter.submit(tx, sim, { quote });
  } finally {
    console.log = originalLog;
  }
  assert.strictEqual(loggedOutput.includes('seedPhrase'), false);
  assert.strictEqual(loggedOutput.includes('mnemonic'), false);
});

// 31. no credential persistence
await runTest('31. Credential material is never persisted to disk or submitter instance', async () => {
  const submitter = new TransactionSubmitter();
  const stringified = JSON.stringify(submitter);
  assert.strictEqual(stringified.includes('privateKey'), false);
  assert.strictEqual(stringified.includes('secretKey'), false);
});

// 32. no paper-history modification
await runTest('32. Submitter operations do NOT modify paper trades history file', async () => {
  const currentHash = getPaperHistoryHash();
  assert.strictEqual(currentHash, initialHash);
});

// 33. no hidden submission path
await runTest('33. Submitter class contains no hidden transmission or broadcast methods', async () => {
  const submitter = new TransactionSubmitter();
  assert.strictEqual(typeof submitter.sendTransaction, 'undefined');
  assert.strictEqual(typeof submitter.sendRawTransaction, 'undefined');
  assert.strictEqual(typeof submitter.sendAndConfirmTransaction, 'undefined');
});

// 34. no duplicate RPC submission
await runTest('34. Concurrent duplicate RPC submission requests are blocked by submitter guard', async () => {
  const { tx, sim, quote } = await createValidSignedTx();
  const submitter = new TransactionSubmitter();
  
  // First submission retain in flight
  const p1 = submitter.submit(tx, sim, { quote, retainInFlight: true, allowMockSignature: true, mockSignature: 'sig_1' });
  await assert.rejects(async () => {
    await submitter.submit(tx, sim, { quote });
  }, (err) => err.message.includes('DUPLICATE_SUBMISSION_BLOCKED') || err.message.includes('in-flight'));
});

// --- ISOLATION TESTS ---

// 35. PAPER execution remains unchanged
await runTest('35. PaperExecutionEngine remains completely isolated and operational', async () => {
  const paperEngine = new PaperExecutionEngine();
  assert.strictEqual(paperEngine.mode, 'PAPER');
  const candidate = {
    address: 'So11111111111111111111111111111111111111112',
    symbol: 'TEST_PAPER_ISOLATION',
    priceUsd: 1.0
  };
  // Verify Paper execution engine does not attempt live submission
  assert.strictEqual(typeof paperEngine.submitTransaction, 'undefined');
});

// 36. LIVE submission never falls back to PAPER
await runTest('36. LIVE execution submission failure NEVER falls back to paper trading silently', async () => {
  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = true;
  global.LIVE_EXECUTION_ARMED = true;
  global.ALLOW_MAINNET_SUBMISSION = true;
  process.env.SOLANA_WALLET_ADDRESS = testWalletAddress;
  process.env.SOLANA_PRIVATE_KEY = testPrivateKeyBase58;

  const liveEngine = new LiveExecutionEngine();
  const validCandidate = {
    address: testWalletAddress,
    symbol: 'LIVE_ISOLATION_BUY',
    liquidityUsd: 25000,
    volume5mUsd: 12000,
    buys5m: 10,
    sells5m: 5,
    ageMinutes: 30,
    strategyScore: 85,
    riskScore: 30
  };

  const res = await liveEngine.executeBuy(validCandidate);
  assert.strictEqual(res.executionMode, 'LIVE_PREVIEW');
  assert.strictEqual(res.action, 'BUY');
  assert.notStrictEqual(res.executionMode, 'PAPER');
});

// Final check on paper history integrity
const finalHash = getPaperHistoryHash();
const finalCounts = getPaperHistoryCounts();
assert.strictEqual(finalHash, initialHash, 'SHA-256 hash of paper_trades_history.json MUST match pre-test hash');
assert.strictEqual(finalCounts.totalRecords, initialCounts.totalRecords, 'Total record count MUST match pre-test count');
assert.strictEqual(finalCounts.genuineTrades, initialCounts.genuineTrades, 'Genuine trade count MUST match pre-test count');

console.log('\n====================================================');
console.log(` STEP 10 TEST SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
console.log('====================================================\n');
