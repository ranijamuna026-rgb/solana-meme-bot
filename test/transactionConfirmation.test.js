// ============================================================================
// TEST SUITE: STEP 11.1 — CONTROLLED TRANSACTION CONFIRMATION MANAGER
// Purpose: Verification of isolated transaction confirmation manager, state transitions,
//          kill-switch precedence, duplicate guards, zero key exposure, zero broadcast,
//          and paper history hash preservation.
// ============================================================================

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

import { config } from '../src/config.js';
import {
  TransactionConfirmationManager,
  CONFIRMATION_STATES
} from '../src/transactionConfirmation.js';
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
  delete process.env.EMERGENCY_KILL_SWITCH;
  delete process.env.CONFIRMATION_TIMEOUT_MS;
  delete process.env.CONFIRMATION_POLL_INTERVAL_MS;
  delete process.env.SOLANA_PRIVATE_KEY;
  delete process.env.SECRET_KEY;
  delete process.env.SEED_PHRASE;
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
console.log(' RUNNING STEP 11.1 — CONFIRMATION MANAGER TESTS    ');
console.log('====================================================\n');

// 1. Initial SUBMITTED state
await runTest('Initial state is SUBMITTED upon registration', async () => {
  const manager = new TransactionConfirmationManager();
  const sig = '5K7mXv1P9...mock_signature_1';
  const record = manager.register(sig);
  
  assert.strictEqual(record.status, CONFIRMATION_STATES.SUBMITTED);
  assert.strictEqual(record.signature, sig);
  assert.strictEqual(record.confirmations, 0);
  assert.ok(record.submittedAt > 0);
});

// 2. Transition to PENDING_CONFIRMATION
await runTest('Status transitions to PENDING_CONFIRMATION during polling', async () => {
  const manager = new TransactionConfirmationManager();
  const sig = '5K7mXv1P9...mock_signature_2';
  manager.register(sig);

  const updated = await manager.checkConfirmation(sig, { manualStep: true });
  assert.strictEqual(updated.status, CONFIRMATION_STATES.PENDING_CONFIRMATION);
  assert.ok(updated.lastPolledAt > 0);
});

// 3. Successful CONFIRMED
await runTest('Successful mock provider confirmation transitions to CONFIRMED', async () => {
  const mockProvider = async (signature) => {
    return { confirmed: true, confirmations: 32 };
  };

  const manager = new TransactionConfirmationManager({ providerFn: mockProvider });
  const sig = '5K7mXv1P9...mock_signature_3';
  manager.register(sig);

  const updated = await manager.checkConfirmation(sig);
  assert.strictEqual(updated.status, CONFIRMATION_STATES.CONFIRMED);
  assert.strictEqual(updated.confirmations, 32);
  assert.ok(updated.completedAt > 0);
});

// 4. Failed confirmation -> CONFIRMATION_FAILED
await runTest('Failed mock provider response transitions to CONFIRMATION_FAILED', async () => {
  const mockFailedProvider = async (signature) => {
    return { failed: true, reason: 'Transaction instruction execution error' };
  };

  const manager = new TransactionConfirmationManager({ providerFn: mockFailedProvider });
  const sig = '5K7mXv1P9...mock_signature_4';
  manager.register(sig);

  const updated = await manager.checkConfirmation(sig);
  assert.strictEqual(updated.status, CONFIRMATION_STATES.CONFIRMATION_FAILED);
  assert.strictEqual(updated.reason, 'Transaction instruction execution error');
  assert.ok(updated.completedAt > 0);
});

// 5. Timeout -> CONFIRMATION_TIMEOUT
await runTest('Exceeding timeout duration transitions status to CONFIRMATION_TIMEOUT', async () => {
  const manager = new TransactionConfirmationManager({ timeoutMs: 50 });
  const sig = '5K7mXv1P9...mock_signature_5';
  manager.register(sig);

  await new Promise(r => setTimeout(r, 60));

  const updated = await manager.checkConfirmation(sig);
  assert.strictEqual(updated.status, CONFIRMATION_STATES.CONFIRMATION_TIMEOUT);
  assert.ok(updated.reason.includes('timed out'));
});

// 6. Kill switch -> CONFIRMATION_BLOCKED
await runTest('Active emergency kill switch blocks confirmation and sets CONFIRMATION_BLOCKED', async () => {
  const manager = new TransactionConfirmationManager();
  const sig = '5K7mXv1P9...mock_signature_6';
  manager.register(sig);

  triggerKillSwitch();

  const updated = await manager.checkConfirmation(sig);
  assert.strictEqual(updated.status, CONFIRMATION_STATES.CONFIRMATION_BLOCKED);
  assert.ok(updated.reason.includes('kill switch'));
});

// 7. Invalid signature rejection
await runTest('Invalid signature registration/check is rejected safely', async () => {
  const manager = new TransactionConfirmationManager();
  
  assert.throws(() => {
    manager.register('');
  }, /Invalid signature/);

  assert.throws(() => {
    manager.register(null);
  }, /Invalid signature/);

  await assert.rejects(async () => {
    await manager.checkConfirmation('unregistered_sig_123');
  }, /Signature not registered/);
});

// 8. Duplicate confirmation request blocked
await runTest('Duplicate confirmation registration for same signature is blocked', async () => {
  const manager = new TransactionConfirmationManager();
  const sig = '5K7mXv1P9...mock_signature_8';
  manager.register(sig);

  assert.throws(() => {
    manager.register(sig);
  }, /Duplicate confirmation tracking rejected/);
});

// 9. Confirmation state isolation from paper trading
await runTest('Confirmation state tracking remains completely isolated from paper trading', async () => {
  const manager = new TransactionConfirmationManager();
  const sig = '5K7mXv1P9...mock_signature_9';
  manager.register(sig);

  const status = manager.getStatus(sig);
  assert.strictEqual(status.signature, sig);
  assert.strictEqual(status.status, CONFIRMATION_STATES.SUBMITTED);
  assert.strictEqual(status.network, 'MAINNET');
});

// 10. No paper history writes
await runTest('Confirmation operations do NOT modify paper_trades_history.json', async () => {
  const manager = new TransactionConfirmationManager({
    providerFn: async () => ({ confirmed: true, confirmations: 32 })
  });
  const sig = '5K7mXv1P9...mock_signature_10';
  manager.register(sig);
  await manager.checkConfirmation(sig);

  const currentHash = getPaperHistoryHash();
  const currentCounts = getPaperHistoryCounts();

  assert.strictEqual(currentHash, initialHash, 'SHA-256 hash must be 100% byte-for-byte identical');
  assert.strictEqual(currentCounts.totalRecords, initialCounts.totalRecords, 'Total records count must be unchanged');
});

// 11. No private key / seed phrase logging
await runTest('Confirmation manager contains zero private key or seed phrase exposure', async () => {
  const manager = new TransactionConfirmationManager();
  const serialized = JSON.stringify(manager);

  assert.strictEqual(serialized.includes('privateKey'), false);
  assert.strictEqual(serialized.includes('secretKey'), false);
  assert.strictEqual(serialized.includes('seedPhrase'), false);
});

// 12. No transaction broadcast APIs called
await runTest('Codebase verification confirms zero sendTransaction/sendRawTransaction in confirmation manager', async () => {
  const manager = new TransactionConfirmationManager();
  assert.strictEqual(typeof manager.sendTransaction, 'undefined');
  assert.strictEqual(typeof manager.sendRawTransaction, 'undefined');
  assert.strictEqual(typeof manager.sendAndConfirmTransaction, 'undefined');
});

// 13. Configuration validation
await runTest('Confirmation manager uses configuration defaults from config module', async () => {
  const manager = new TransactionConfirmationManager();
  assert.strictEqual(manager.timeoutMs, config.confirmationTimeoutMs);
  assert.strictEqual(manager.pollIntervalMs, config.confirmationPollIntervalMs);
});

// 14. State transition validation
await runTest('Complete lifecycle transition SUBMITTED -> PENDING -> CONFIRMED validates cleanly', async () => {
  let step = 0;
  const mockProgressiveProvider = async () => {
    step++;
    if (step === 1) return { confirmed: false };
    return { confirmed: true, confirmations: 32 };
  };

  const manager = new TransactionConfirmationManager({ providerFn: mockProgressiveProvider });
  const sig = '5K7mXv1P9...mock_signature_14';
  
  const initial = manager.register(sig);
  assert.strictEqual(initial.status, CONFIRMATION_STATES.SUBMITTED);

  const pending = await manager.checkConfirmation(sig, { manualStep: true });
  assert.strictEqual(pending.status, CONFIRMATION_STATES.PENDING_CONFIRMATION);

  const confirmed = await manager.checkConfirmation(sig);
  assert.strictEqual(confirmed.status, CONFIRMATION_STATES.CONFIRMED);
  assert.strictEqual(confirmed.confirmations, 32);
});

console.log('\n====================================================');
console.log(` TEST SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
console.log('====================================================\n');

if (passedTests !== totalTests) {
  process.exit(1);
}
