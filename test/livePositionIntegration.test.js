// ============================================================================
// TEST SUITE: STEP 11.3 — CONTROLLED LIVE POSITION PIPELINE INTEGRATION
// Purpose: Automated verification of integrated LiveExecutionEngine, Submitter,
//          ConfirmationManager, and LivePositionTracker pipeline.
// Mode: FAIL-CLOSED SAFETY LOCK (Zero real RPC submission/confirmation calls,
//       deterministic mocked providers only, zero paper trade history pollution)
// ============================================================================

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

import { config } from '../src/config.js';
import { LiveExecutionEngine } from '../src/executionEngine.js';
import { CONFIRMATION_STATES } from '../src/transactionConfirmation.js';
import { POSITION_STATES } from '../src/livePositionTracker.js';
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

const initialHash = getPaperHistoryHash();
const initialCounts = getPaperHistoryCounts();

let passedTests = 0;
let totalTests = 0;

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
console.log(' RUNNING STEP 11.3 — PIPELINE INTEGRATION TESTS    ');
console.log('====================================================\n');

const testKeypair = Keypair.generate();
const testWalletAddress = testKeypair.publicKey.toBase58();
const testPrivateKeyBase58 = bs58.encode(testKeypair.secretKey);

function setupLiveEnvironment() {
  process.env.TRADING_MODE = 'LIVE';
  global.ALLOW_LIVE_EXECUTION = true;
  global.LIVE_EXECUTION_ARMED = true;
  global.ALLOW_MAINNET_SUBMISSION = true;
  process.env.SOLANA_WALLET_ADDRESS = testWalletAddress;
  process.env.SOLANA_PRIVATE_KEY = testPrivateKeyBase58;
  process.env.SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com';
}

const validCandidate = {
  address: testWalletAddress,
  symbol: 'INT_TOKEN',
  liquidityUsd: 25000,
  volume5mUsd: 12000,
  buys5m: 10,
  sells5m: 5,
  ageMinutes: 30,
  strategyScore: 85,
  riskScore: 30
};

// 1. BUY pipeline reaches controlled submission boundary
await runTest('BUY pipeline reaches controlled submission boundary safely', async () => {
  setupLiveEnvironment();
  const liveEngine = new LiveExecutionEngine();

  const res = await liveEngine.executeBuy(validCandidate);
  assert.strictEqual(res.executionMode, 'LIVE_PREVIEW');
  assert.strictEqual(res.action, 'BUY');
  assert.strictEqual(res.signingResult.signed, true);
  assert.strictEqual(res.submissionResult.status, 'DRY_RUN_BLOCKED');
  assert.strictEqual(res.status, 'DRY_RUN_BLOCKED');
});

// 2. DRY_RUN_BLOCKED does not create ACTIVE position
await runTest('DRY_RUN_BLOCKED submission result does NOT create an ACTIVE position', async () => {
  setupLiveEnvironment();
  const liveEngine = new LiveExecutionEngine();

  const res = await liveEngine.executeBuy(validCandidate);
  assert.strictEqual(res.submissionResult.submitted, false);
  assert.strictEqual(res.position.status, POSITION_STATES.SUBMISSION_FAILED);
  assert.strictEqual(liveEngine.positionTracker.getActivePositions().length, 0);
});

// 3. No confirmation without valid signature
await runTest('No confirmation polling is executed without a valid submission signature', async () => {
  setupLiveEnvironment();
  const liveEngine = new LiveExecutionEngine();

  const res = await liveEngine.executeBuy(validCandidate);
  assert.strictEqual(res.submissionResult.signature, null);
  assert.strictEqual(res.confirmationResult, null);
});

// 4. Mocked successful submission -> confirmation -> ACTIVE
await runTest('Mocked successful submission signature triggers confirmation transition to ACTIVE', async () => {
  setupLiveEnvironment();
  const liveEngine = new LiveExecutionEngine();

  const mockSignature = 'mock_tx_sig_success_004';
  const mockProvider = async () => ({ confirmed: true, confirmations: 32 });

  // Execute buy with injected mock signature provider options
  const res = await liveEngine.executeBuy(validCandidate, null, 10, {
    mockRpcResponse: { signature: mockSignature },
    providerFn: mockProvider,
    positionId: 'POS_INT_004'
  });

  assert.strictEqual(res.submissionResult.submitted, true);
  assert.strictEqual(res.submissionResult.signature, mockSignature);
  assert.strictEqual(res.confirmationResult.status, CONFIRMATION_STATES.CONFIRMED);
  assert.strictEqual(res.position.status, POSITION_STATES.ACTIVE);
  assert.strictEqual(liveEngine.positionTracker.getActivePositions().length, 1);
});

// 5. Confirmation failure -> never ACTIVE
await runTest('Confirmation failure transitions position to CONFIRMATION_FAILED and never ACTIVE', async () => {
  setupLiveEnvironment();
  const liveEngine = new LiveExecutionEngine();

  const mockSignature = 'mock_tx_sig_failed_005';
  const mockFailedProvider = async () => ({ failed: true, reason: 'Simulation failure on-chain' });

  const res = await liveEngine.executeBuy(validCandidate, null, 10, {
    mockRpcResponse: { signature: mockSignature },
    providerFn: mockFailedProvider,
    positionId: 'POS_INT_005'
  });

  assert.strictEqual(res.position.status, POSITION_STATES.CONFIRMATION_FAILED);
  assert.strictEqual(liveEngine.positionTracker.getActivePositions().length, 0);
});

// 6. Confirmation timeout -> never ACTIVE
await runTest('Confirmation timeout transitions position to CONFIRMATION_TIMEOUT and never ACTIVE', async () => {
  setupLiveEnvironment();
  const liveEngine = new LiveExecutionEngine();

  const mockSignature = 'mock_tx_sig_timeout_006';
  const mockTimeoutProvider = async () => ({ timeout: true, reason: 'Polling timeout' });

  const res = await liveEngine.executeBuy(validCandidate, null, 10, {
    mockRpcResponse: { signature: mockSignature },
    providerFn: mockTimeoutProvider,
    positionId: 'POS_INT_006'
  });

  assert.strictEqual(res.position.status, POSITION_STATES.CONFIRMATION_TIMEOUT);
  assert.strictEqual(liveEngine.positionTracker.getActivePositions().length, 0);
});

// 7. Kill switch blocks lifecycle integration
await runTest('Active emergency kill switch blocks position integration pipeline', async () => {
  setupLiveEnvironment();
  triggerKillSwitch();
  const liveEngine = new LiveExecutionEngine();

  await assert.rejects(async () => {
    await liveEngine.executeBuy(validCandidate);
  }, /kill switch/i);
});

// 8. ACTIVE position can start SELL lifecycle
await runTest('ACTIVE preview position can initiate SELL execution lifecycle', async () => {
  setupLiveEnvironment();
  const liveEngine = new LiveExecutionEngine();

  const mockBuySig = 'mock_buy_sig_008';
  const mockProvider = async () => ({ confirmed: true, confirmations: 32 });

  const buyRes = await liveEngine.executeBuy(validCandidate, null, 10, {
    mockRpcResponse: { signature: mockBuySig },
    providerFn: mockProvider,
    positionId: 'POS_INT_008'
  });

  assert.strictEqual(buyRes.position.status, POSITION_STATES.ACTIVE);

  const sellRes = await liveEngine.executeSell(buyRes.position, 0.002, 1000, 'TAKE_PROFIT');
  assert.strictEqual(sellRes.executionMode, 'LIVE_PREVIEW');
  assert.strictEqual(sellRes.action, 'SELL');
  assert.strictEqual(sellRes.submissionResult.status, 'DRY_RUN_BLOCKED');
});

// 9. Confirmed SELL -> CLOSED
await runTest('Confirmed sell order transitions ACTIVE position to CLOSED', async () => {
  setupLiveEnvironment();
  const liveEngine = new LiveExecutionEngine();

  const mockBuySig = 'mock_buy_sig_009';
  const mockSellSig = 'mock_sell_sig_009';
  const mockProvider = async () => ({ confirmed: true, confirmations: 32 });

  const buyRes = await liveEngine.executeBuy(validCandidate, null, 10, {
    mockRpcResponse: { signature: mockBuySig },
    providerFn: mockProvider,
    positionId: 'POS_INT_009'
  });

  assert.strictEqual(buyRes.position.status, POSITION_STATES.ACTIVE);

  const sellRes = await liveEngine.executeSell(buyRes.position, 0.002, 1000, 'TAKE_PROFIT', {
    mockRpcResponse: { signature: mockSellSig },
    providerFn: mockProvider
  });

  assert.strictEqual(sellRes.position.status, POSITION_STATES.CLOSED);
  assert.strictEqual(liveEngine.positionTracker.getActivePositions().length, 0);
});

// 10. Failed SELL confirmation does not close position
await runTest('Failed SELL confirmation does NOT close the active preview position', async () => {
  setupLiveEnvironment();
  const liveEngine = new LiveExecutionEngine();

  const mockBuySig = 'mock_buy_sig_010';
  const mockSellSig = 'mock_sell_sig_010';
  const mockConfirmProvider = async () => ({ confirmed: true, confirmations: 32 });
  const mockFailedProvider = async () => ({ failed: true, reason: 'Slippage tolerance exceeded on sell' });

  const buyRes = await liveEngine.executeBuy(validCandidate, null, 10, {
    mockRpcResponse: { signature: mockBuySig },
    providerFn: mockConfirmProvider,
    positionId: 'POS_INT_010'
  });

  assert.strictEqual(buyRes.position.status, POSITION_STATES.ACTIVE);

  const sellRes = await liveEngine.executeSell(buyRes.position, 0.002, 1000, 'TAKE_PROFIT', {
    mockRpcResponse: { signature: mockSellSig },
    providerFn: mockFailedProvider
  });

  assert.strictEqual(sellRes.position.status, POSITION_STATES.ACTIVE);
  assert.notStrictEqual(sellRes.position.status, POSITION_STATES.CLOSED);
});

// 11. Invalid state transition blocked
await runTest('Attempting to execute SELL on unconfirmed position is strictly rejected', async () => {
  setupLiveEnvironment();
  const liveEngine = new LiveExecutionEngine();

  const unconfirmedPos = liveEngine.positionTracker.createPosition({
    positionId: 'POS_UNCONFIRMED_011',
    tokenAddress: testWalletAddress,
    quantity: 100
  });

  await assert.rejects(async () => {
    await liveEngine.executeSell(unconfirmedPos, 0.002, 1000, 'TAKE_PROFIT');
  }, /Invalid position state for SELL/);
});

// 12. Duplicate position blocked
await runTest('Duplicate position registration with existing positionId is blocked', async () => {
  setupLiveEnvironment();
  const liveEngine = new LiveExecutionEngine();

  await liveEngine.executeBuy(validCandidate, null, 10, { positionId: 'POS_DUP_012' });
  
  await assert.rejects(async () => {
    await liveEngine.executeBuy(validCandidate, null, 10, { positionId: 'POS_DUP_012' });
  }, /Duplicate position creation blocked/);
});

// 13. Paper history unchanged
await runTest('Live position integration pipeline operations do NOT alter paper_trades_history.json', async () => {
  setupLiveEnvironment();
  const liveEngine = new LiveExecutionEngine();

  const mockBuySig = 'mock_buy_sig_013';
  const mockSellSig = 'mock_sell_sig_013';
  const mockProvider = async () => ({ confirmed: true, confirmations: 32 });

  const buyRes = await liveEngine.executeBuy(validCandidate, null, 10, {
    mockRpcResponse: { signature: mockBuySig },
    providerFn: mockProvider,
    positionId: 'POS_INT_013'
  });

  await liveEngine.executeSell(buyRes.position, 0.002, 1000, 'TAKE_PROFIT', {
    mockRpcResponse: { signature: mockSellSig },
    providerFn: mockProvider
  });

  const currentHash = getPaperHistoryHash();
  const currentCounts = getPaperHistoryCounts();

  assert.strictEqual(currentHash, initialHash, 'SHA-256 hash must match initial hash byte-for-byte');
  assert.strictEqual(currentCounts.totalRecords, initialCounts.totalRecords, 'Total records count must be unchanged');
});

// 14. No private key/seed phrase exposure
await runTest('Integration execution results contain zero private key or seed phrase exposure', async () => {
  setupLiveEnvironment();
  const liveEngine = new LiveExecutionEngine();

  const res = await liveEngine.executeBuy(validCandidate);
  const serialized = JSON.stringify(res);

  assert.strictEqual(serialized.includes('secretKey'), false);
  assert.strictEqual(serialized.includes('privateKey'), false);
  assert.strictEqual(serialized.includes('seedPhrase'), false);
  assert.strictEqual(serialized.includes(testPrivateKeyBase58), false);
});

// 15. No broadcast APIs called
await runTest('Codebase verification confirms zero broadcast API availability across pipeline', async () => {
  setupLiveEnvironment();
  const liveEngine = new LiveExecutionEngine();

  assert.strictEqual(typeof liveEngine.sendTransaction, 'undefined');
  assert.strictEqual(typeof liveEngine.transactionSubmitter.sendTransaction, 'undefined');
  assert.strictEqual(typeof liveEngine.transactionSubmitter.sendRawTransaction, 'undefined');
  assert.strictEqual(typeof liveEngine.transactionSubmitter.sendAndConfirmTransaction, 'undefined');
});

// 16. PAPER/LIVE isolation preserved
await runTest('PAPER mode execution engine remains completely isolated from live position tracker', async () => {
  delete process.env.TRADING_MODE;
  global.ALLOW_LIVE_EXECUTION = false;

  const liveEngine = new LiveExecutionEngine();
  assert.strictEqual(liveEngine.positionTracker.getAllPositions().length, 0);
});

console.log('\n====================================================');
console.log(` TEST SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
console.log('====================================================\n');

if (passedTests !== totalTests) {
  process.exit(1);
}
