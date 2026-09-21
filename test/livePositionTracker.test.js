// ============================================================================
// TEST SUITE: STEP 11.2 — CONTROLLED LIVE POSITION LIFECYCLE TRACKER
// Purpose: Automated verification of isolated live position tracker state machine,
//          BUY/SELL lifecycles, kill-switch precedence, duplicate guards, zero key exposure,
//          zero broadcast, and paper trade history byte-for-byte SHA-256 preservation.
// ============================================================================

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

import {
  LivePositionTracker,
  POSITION_STATES
} from '../src/livePositionTracker.js';
import { CONFIRMATION_STATES } from '../src/transactionConfirmation.js';
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
console.log(' RUNNING STEP 11.2 — LIVE POSITION TRACKER TESTS   ');
console.log('====================================================\n');

const MOCK_TOKEN = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// 1. Create preview BUY position
await runTest('Create preview BUY position initializes state to CREATED', async () => {
  const tracker = new LivePositionTracker();
  const pos = tracker.createPosition({
    positionId: 'POS_001',
    tokenAddress: MOCK_TOKEN,
    symbol: 'TEST_BUY',
    side: 'BUY',
    quantity: 100,
    entryPrice: 0.001
  });

  assert.strictEqual(pos.positionId, 'POS_001');
  assert.strictEqual(pos.status, POSITION_STATES.CREATED);
  assert.strictEqual(pos.side, 'BUY');
  assert.strictEqual(pos.entryPrice, 0.001);
  assert.ok(pos.createdAt > 0);
});

// 2. BUY -> SUBMITTED
await runTest('Position state transitions from CREATED to SUBMITTED', async () => {
  const tracker = new LivePositionTracker();
  tracker.createPosition({ positionId: 'POS_002', tokenAddress: MOCK_TOKEN });

  const updated = tracker.transitionState('POS_002', POSITION_STATES.SUBMITTED, {
    signature: 'sig_mock_002'
  });

  assert.strictEqual(updated.status, POSITION_STATES.SUBMITTED);
  assert.strictEqual(updated.signature, 'sig_mock_002');
  assert.ok(updated.submittedAt > 0);
});

// 3. SUBMITTED -> PENDING_CONFIRMATION
await runTest('Position state transitions from SUBMITTED to PENDING_CONFIRMATION', async () => {
  const tracker = new LivePositionTracker();
  tracker.createPosition({ positionId: 'POS_003', tokenAddress: MOCK_TOKEN });
  tracker.transitionState('POS_003', POSITION_STATES.SUBMITTED);

  const updated = tracker.transitionState('POS_003', POSITION_STATES.PENDING_CONFIRMATION);
  assert.strictEqual(updated.status, POSITION_STATES.PENDING_CONFIRMATION);
});

// 4. PENDING_CONFIRMATION -> ACTIVE only after CONFIRMED
await runTest('Position transitions to ACTIVE only when confirmed flag is set', async () => {
  const tracker = new LivePositionTracker();
  tracker.createPosition({ positionId: 'POS_004', tokenAddress: MOCK_TOKEN });
  tracker.transitionState('POS_004', POSITION_STATES.SUBMITTED);
  tracker.transitionState('POS_004', POSITION_STATES.PENDING_CONFIRMATION);

  // Unconfirmed transition to ACTIVE should throw error
  assert.throws(() => {
    tracker.transitionState('POS_004', POSITION_STATES.ACTIVE);
  }, /without confirmed transaction status/);

  // Confirmed transition should succeed
  const activePos = tracker.transitionState('POS_004', POSITION_STATES.ACTIVE, { confirmed: true });
  assert.strictEqual(activePos.status, POSITION_STATES.ACTIVE);
  assert.ok(activePos.confirmedAt > 0);
});

// 5. Confirmation failure prevents ACTIVE
await runTest('Confirmation failure transitions position to CONFIRMATION_FAILED instead of ACTIVE', async () => {
  const tracker = new LivePositionTracker();
  tracker.createPosition({ positionId: 'POS_005', tokenAddress: MOCK_TOKEN });
  tracker.transitionState('POS_005', POSITION_STATES.SUBMITTED);
  tracker.transitionState('POS_005', POSITION_STATES.PENDING_CONFIRMATION);

  const confirmationRecord = { status: CONFIRMATION_STATES.CONFIRMATION_FAILED, reason: 'Simulation failure on chain' };
  const updated = tracker.processConfirmationResult('POS_005', confirmationRecord);

  assert.strictEqual(updated.status, POSITION_STATES.CONFIRMATION_FAILED);
  assert.strictEqual(updated.failureReason, 'Simulation failure on chain');
  assert.strictEqual(tracker.getActivePositions().length, 0);
});

// 6. Confirmation timeout prevents ACTIVE
await runTest('Confirmation timeout transitions position to CONFIRMATION_TIMEOUT instead of ACTIVE', async () => {
  const tracker = new LivePositionTracker();
  tracker.createPosition({ positionId: 'POS_006', tokenAddress: MOCK_TOKEN });
  tracker.transitionState('POS_006', POSITION_STATES.SUBMITTED);
  tracker.transitionState('POS_006', POSITION_STATES.PENDING_CONFIRMATION);

  const confirmationRecord = { status: CONFIRMATION_STATES.CONFIRMATION_TIMEOUT, reason: 'Polling timeout exceeded' };
  const updated = tracker.processConfirmationResult('POS_006', confirmationRecord);

  assert.strictEqual(updated.status, POSITION_STATES.CONFIRMATION_TIMEOUT);
  assert.strictEqual(updated.failureReason, 'Polling timeout exceeded');
  assert.strictEqual(tracker.getActivePositions().length, 0);
});

// 7. ACTIVE -> SELL_SUBMITTED
await runTest('Active position transitions to SELL_SUBMITTED during sell order placement', async () => {
  const tracker = new LivePositionTracker();
  tracker.createPosition({ positionId: 'POS_007', tokenAddress: MOCK_TOKEN });
  tracker.transitionState('POS_007', POSITION_STATES.SUBMITTED);
  tracker.transitionState('POS_007', POSITION_STATES.PENDING_CONFIRMATION);
  tracker.transitionState('POS_007', POSITION_STATES.ACTIVE, { confirmed: true });

  const sellSubmitted = tracker.transitionState('POS_007', POSITION_STATES.SELL_SUBMITTED, { signature: 'sell_sig_007' });
  assert.strictEqual(sellSubmitted.status, POSITION_STATES.SELL_SUBMITTED);
  assert.strictEqual(sellSubmitted.signature, 'sell_sig_007');
});

// 8. SELL_SUBMITTED -> SELL_PENDING_CONFIRMATION
await runTest('Position state transitions from SELL_SUBMITTED to SELL_PENDING_CONFIRMATION', async () => {
  const tracker = new LivePositionTracker();
  tracker.createPosition({ positionId: 'POS_008', tokenAddress: MOCK_TOKEN });
  tracker.transitionState('POS_008', POSITION_STATES.SUBMITTED);
  tracker.transitionState('POS_008', POSITION_STATES.PENDING_CONFIRMATION);
  tracker.transitionState('POS_008', POSITION_STATES.ACTIVE, { confirmed: true });
  tracker.transitionState('POS_008', POSITION_STATES.SELL_SUBMITTED);

  const updated = tracker.transitionState('POS_008', POSITION_STATES.SELL_PENDING_CONFIRMATION);
  assert.strictEqual(updated.status, POSITION_STATES.SELL_PENDING_CONFIRMATION);
});

// 9. Confirmed SELL -> CLOSED
await runTest('Confirmed sell order transitions position state to CLOSED', async () => {
  const tracker = new LivePositionTracker();
  tracker.createPosition({ positionId: 'POS_009', tokenAddress: MOCK_TOKEN, entryPrice: 0.001 });
  tracker.transitionState('POS_009', POSITION_STATES.SUBMITTED);
  tracker.transitionState('POS_009', POSITION_STATES.PENDING_CONFIRMATION);
  tracker.transitionState('POS_009', POSITION_STATES.ACTIVE, { confirmed: true });
  tracker.transitionState('POS_009', POSITION_STATES.SELL_SUBMITTED);
  tracker.transitionState('POS_009', POSITION_STATES.SELL_PENDING_CONFIRMATION);

  const closed = tracker.processConfirmationResult('POS_009', { status: CONFIRMATION_STATES.CONFIRMED, exitPrice: 0.002 });
  assert.strictEqual(closed.status, POSITION_STATES.CLOSED);
  assert.ok(closed.closedAt > 0);
});

// 10. Invalid transition rejected
await runTest('Invalid position state transition is strictly rejected', async () => {
  const tracker = new LivePositionTracker();
  tracker.createPosition({ positionId: 'POS_010', tokenAddress: MOCK_TOKEN });

  assert.throws(() => {
    tracker.transitionState('POS_010', POSITION_STATES.ACTIVE, { confirmed: true });
  }, /Invalid position state transition/);

  assert.throws(() => {
    tracker.transitionState('POS_010', POSITION_STATES.CLOSED);
  }, /Invalid position state transition/);
});

// 11. Duplicate position creation blocked
await runTest('Duplicate position creation for existing position ID is blocked', async () => {
  const tracker = new LivePositionTracker();
  tracker.createPosition({ positionId: 'POS_011', tokenAddress: MOCK_TOKEN });

  assert.throws(() => {
    tracker.createPosition({ positionId: 'POS_011', tokenAddress: MOCK_TOKEN });
  }, /Duplicate position creation blocked/);
});

// 12. Invalid position ID rejected
await runTest('Invalid position ID is rejected during creation and transition', async () => {
  const tracker = new LivePositionTracker();

  assert.throws(() => {
    tracker.createPosition({ positionId: '', tokenAddress: MOCK_TOKEN });
  }, /Invalid position ID/);

  assert.throws(() => {
    tracker.transitionState('non_existent_id', POSITION_STATES.SUBMITTED);
  }, /Invalid or non-existent position ID/);
});

// 13. Kill switch blocks lifecycle mutation
await runTest('Active emergency kill switch blocks position creation and transition', async () => {
  const tracker = new LivePositionTracker();
  tracker.createPosition({ positionId: 'POS_013', tokenAddress: MOCK_TOKEN });

  triggerKillSwitch();

  assert.throws(() => {
    tracker.createPosition({ positionId: 'POS_013_NEW', tokenAddress: MOCK_TOKEN });
  }, /kill switch is active/);

  assert.throws(() => {
    tracker.transitionState('POS_013', POSITION_STATES.SUBMITTED);
  }, /kill switch is active/);
});

// 14. Closed position cannot reactivate
await runTest('Closed position cannot be reactivated to ACTIVE', async () => {
  const tracker = new LivePositionTracker();
  tracker.createPosition({ positionId: 'POS_014', tokenAddress: MOCK_TOKEN });
  tracker.transitionState('POS_014', POSITION_STATES.SUBMITTED);
  tracker.transitionState('POS_014', POSITION_STATES.PENDING_CONFIRMATION);
  tracker.transitionState('POS_014', POSITION_STATES.ACTIVE, { confirmed: true });
  tracker.transitionState('POS_014', POSITION_STATES.CLOSED);

  assert.throws(() => {
    tracker.transitionState('POS_014', POSITION_STATES.ACTIVE, { confirmed: true });
  }, /Invalid position state transition/);
});

// 15. Paper history remains unchanged
await runTest('Position lifecycle operations do NOT alter paper_trades_history.json', async () => {
  const tracker = new LivePositionTracker();
  tracker.createPosition({ positionId: 'POS_015', tokenAddress: MOCK_TOKEN });
  tracker.transitionState('POS_015', POSITION_STATES.SUBMITTED);
  tracker.transitionState('POS_015', POSITION_STATES.PENDING_CONFIRMATION);
  tracker.transitionState('POS_015', POSITION_STATES.ACTIVE, { confirmed: true });
  tracker.transitionState('POS_015', POSITION_STATES.CLOSED);

  const currentHash = getPaperHistoryHash();
  const currentCounts = getPaperHistoryCounts();

  assert.strictEqual(currentHash, initialHash, 'SHA-256 hash must be 100% byte-for-byte identical');
  assert.strictEqual(currentCounts.totalRecords, initialCounts.totalRecords, 'Total record count must be unchanged');
});

// 16. No private key / seed phrase exposure
await runTest('Position tracker contains zero private key or seed phrase exposure', async () => {
  const tracker = new LivePositionTracker();
  tracker.createPosition({ positionId: 'POS_016', tokenAddress: MOCK_TOKEN });
  const serialized = JSON.stringify(tracker);

  assert.strictEqual(serialized.includes('privateKey'), false);
  assert.strictEqual(serialized.includes('secretKey'), false);
  assert.strictEqual(serialized.includes('seedPhrase'), false);
});

// 17. No broadcast APIs called
await runTest('Codebase verification confirms zero broadcast API availability in position tracker', async () => {
  const tracker = new LivePositionTracker();
  assert.strictEqual(typeof tracker.sendTransaction, 'undefined');
  assert.strictEqual(typeof tracker.sendRawTransaction, 'undefined');
  assert.strictEqual(typeof tracker.sendAndConfirmTransaction, 'undefined');
});

// 18. Multiple positions remain isolated
await runTest('Multiple preview positions track states independently without state leakage', async () => {
  const tracker = new LivePositionTracker();
  
  tracker.createPosition({ positionId: 'POS_A', tokenAddress: MOCK_TOKEN });
  tracker.createPosition({ positionId: 'POS_B', tokenAddress: MOCK_TOKEN });

  tracker.transitionState('POS_A', POSITION_STATES.SUBMITTED);
  tracker.transitionState('POS_A', POSITION_STATES.PENDING_CONFIRMATION);
  tracker.transitionState('POS_A', POSITION_STATES.ACTIVE, { confirmed: true });

  const posA = tracker.getPosition('POS_A');
  const posB = tracker.getPosition('POS_B');

  assert.strictEqual(posA.status, POSITION_STATES.ACTIVE);
  assert.strictEqual(posB.status, POSITION_STATES.CREATED);
  assert.strictEqual(tracker.getActivePositions().length, 1);
});

console.log('\n====================================================');
console.log(` TEST SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
console.log('====================================================\n');

if (passedTests !== totalTests) {
  process.exit(1);
}
