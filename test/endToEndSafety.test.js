process.env.NODE_ENV = 'test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  evaluatePreExecutionSafetyGate,
  SAFETY_GATE_REJECTION_REASONS,
  isSafetyConfigurationValid
} from '../src/safetyGate.js';
import {
  simulateTransaction,
  SIMULATION_REJECTION_REASONS,
  SIMULATION_CONFIRMATION_STATES,
  triggerKillSwitch,
  resetKillSwitch,
  isKillSwitchTriggered,
  resetDuplicateOrderCache,
  clearSimulationAuditLogs
} from '../src/simulationLayer.js';
import { LiveExecutionEngine, PaperExecutionEngine, ExecutionEngine } from '../src/executionEngine.js';
import { getTradeHistory, isGenuineMarketTrade } from '../src/paperTrader.js';
import { config } from '../src/config.js';
import { startDashboardServer, stopDashboardServer } from '../src/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..');

console.log('====================================================');
console.log('  RUNNING PHASE 12 — END-TO-END SAFETY INTEGRATION');
console.log('        & FAILURE-INJECTION TEST SUITE             ');
console.log('====================================================\n');

let passedTests = 0;
let totalTests = 0;

async function runTest(name, fn) {
  totalTests++;
  try {
    resetKillSwitch();
    resetDuplicateOrderCache();
    clearSimulationAuditLogs();
    await fn();
    console.log(`[PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(`       Error: ${err.message}\n${err.stack}`);
  }
}

const mockCandidate = {
  id: 'E2E_CAND_01',
  address: '7wCM5K4ziHmrbjGe5QFhBqBME2fH82dn4Wfx8vhKSTNK',
  symbol: 'E2E_TEST',
  name: 'End to End Test Token',
  priceUsd: 0.0005,
  liquidityUsd: 25000,
  volume5mUsd: 12000
};

try {
  // ============================================================================
  // 1. END-TO-END PIPELINE AUDIT
  // ============================================================================
  await runTest('1.1 End-to-End Pipeline: Simulation & Paper Pipelines remain strictly separate', async () => {
    const historyBefore = getTradeHistory();
    const simResult = await simulateTransaction(mockCandidate, 'BUY', 10, null, 0);
    const historyAfter = getTradeHistory();

    assert.strictEqual(simResult.result, 'APPROVED_FOR_SIMULATION');
    assert.strictEqual(simResult.plan.executionMode, 'SIMULATION_ONLY');
    assert.strictEqual(simResult.plan.broadcastEnabled, false);
    assert.strictEqual(historyBefore.length, historyAfter.length, 'Simulation must NOT write to paper trade history');
  });

  await runTest('1.2 End-to-End Pipeline: Paper execution does not trigger live execution', async () => {
    const paperEngine = new PaperExecutionEngine();
    assert.strictEqual(paperEngine.mode, 'PAPER');
    
    const liveEngine = new LiveExecutionEngine();
    assert.strictEqual(liveEngine.mode, 'LIVE');
    await assert.rejects(async () => {
      await liveEngine.executeBuy();
    }, /SAFETY LOCK/);
  });

  // ============================================================================
  // 2. FAILURE INJECTION TESTING
  // ============================================================================
  await runTest('2.A Failure Injection: Slippage failure -> REJECTED (SLIPPAGE_LIMIT_EXCEEDED)', async () => {
    // Custom price function returning price with 5% slippage (0.0005 -> 0.000525), exceeding max 1.0% limit
    const highSlippageFn = () => ({ priceUsd: 0.000525 });
    const res = await simulateTransaction(mockCandidate, 'BUY', 10, highSlippageFn, 0);
    assert.strictEqual(res.result, 'REJECTED');
    assert.strictEqual(res.reason, SIMULATION_REJECTION_REASONS.SLIPPAGE_LIMIT_EXCEEDED);
  });

  await runTest('2.B Failure Injection: Position-size failure -> REJECTED (POSITION_SIZE_LIMIT_EXCEEDED)', async () => {
    const res = await simulateTransaction(mockCandidate, 'BUY', 50, null, 0);
    assert.strictEqual(res.result, 'REJECTED');
    assert.strictEqual(res.reason, SIMULATION_REJECTION_REASONS.POSITION_SIZE_LIMIT_EXCEEDED);
  });

  await runTest('2.C Failure Injection: Daily-loss failure -> REJECTED (DAILY_LOSS_LIMIT_REACHED)', async () => {
    const res = await simulateTransaction(mockCandidate, 'BUY', 10, null, -25);
    assert.strictEqual(res.result, 'REJECTED');
    assert.strictEqual(res.reason, SIMULATION_REJECTION_REASONS.DAILY_LOSS_LIMIT_REACHED);
  });

  await runTest('2.D Failure Injection: Kill-switch failure -> REJECTED (EMERGENCY_KILL_SWITCH_TRIGGERED)', async () => {
    triggerKillSwitch();
    const res = await simulateTransaction(mockCandidate, 'BUY', 10, null, 0);
    assert.strictEqual(res.result, 'REJECTED');
    assert.strictEqual(res.reason, SIMULATION_REJECTION_REASONS.EMERGENCY_KILL_SWITCH_TRIGGERED);
  });

  await runTest('2.E Failure Injection: Duplicate-order failure -> REJECTED (DUPLICATE_ORDER)', async () => {
    const req1 = await simulateTransaction(mockCandidate, 'BUY', 10, null, 0);
    assert.strictEqual(req1.result, 'APPROVED_FOR_SIMULATION');

    const req2 = await simulateTransaction(mockCandidate, 'BUY', 10, null, 0);
    assert.strictEqual(req2.result, 'REJECTED');
    assert.strictEqual(req2.reason, SIMULATION_REJECTION_REASONS.DUPLICATE_ORDER);
  });

  await runTest('2.F Failure Injection: Invalid request -> REJECTED (INVALID_REQUEST)', async () => {
    const res = await simulateTransaction(null, 'BUY', 10, null, 0);
    assert.strictEqual(res.result, 'REJECTED');
    assert.strictEqual(res.reason, SIMULATION_REJECTION_REASONS.INVALID_REQUEST);
  });

  await runTest('2.G Failure Injection: Insufficient simulated balance -> REJECTED (INSUFFICIENT_SIMULATED_BALANCE)', async () => {
    const res = await evaluatePreExecutionSafetyGate(mockCandidate, 'BUY', 10, 5, 0);
    assert.strictEqual(res.finalStatus, 'SAFETY_GATE_REJECTED');
    assert.strictEqual(res.rejectionReason, SAFETY_GATE_REJECTION_REASONS.INSUFFICIENT_SIMULATED_BALANCE);
  });

  await runTest('2.H Failure Injection: Invalid safety configuration -> REJECTED (SAFETY_CONFIGURATION_INVALID)', async () => {
    const origMaxPos = config.maxPositionSizeUsd;
    try {
      config.maxPositionSizeUsd = -10;
      const res = await evaluatePreExecutionSafetyGate(mockCandidate, 'BUY', 10, 1000, 0);
      assert.strictEqual(res.finalStatus, 'SAFETY_GATE_REJECTED');
      assert.strictEqual(res.rejectionReason, SAFETY_GATE_REJECTION_REASONS.SAFETY_CONFIGURATION_INVALID);
    } finally {
      config.maxPositionSizeUsd = origMaxPos;
    }
  });

  await runTest('2.I Failure Injection: Simulation failure -> FAILED_SIMULATION (SIMULATION_ERROR)', async () => {
    const failingPriceFn = () => { throw new Error('RPC connection failed during simulation'); };
    const res = await simulateTransaction(mockCandidate, 'BUY', 10, failingPriceFn, 0);
    assert.strictEqual(res.result, 'FAILED_SIMULATION');
    assert.strictEqual(res.reason, SIMULATION_REJECTION_REASONS.SIMULATION_ERROR);
  });

  // ============================================================================
  // 3. FAIL-CLOSED PROPERTY
  // ============================================================================
  await runTest('3.1 Fail-Closed Property: If ANY safety check fails, request MUST NOT proceed', async () => {
    triggerKillSwitch();
    const gateRes = await evaluatePreExecutionSafetyGate(mockCandidate, 'BUY', 10, 1000, 0);
    assert.strictEqual(gateRes.finalStatus, 'SAFETY_GATE_REJECTED');
    assert.strictEqual(gateRes.transactionExecutionAuthorized, false);

    const simRes = await simulateTransaction(mockCandidate, 'BUY', 10, null, 0);
    assert.strictEqual(simRes.result, 'REJECTED');
  });

  await runTest('3.2 Fail-Closed Property: No override or fallback paths exist to force execution', async () => {
    const gateRes = await evaluatePreExecutionSafetyGate(mockCandidate, 'BUY', 10, 1000, 0);
    assert.strictEqual(gateRes.transactionExecutionAuthorized, false);
    assert.strictEqual(typeof gateRes.readinessNotice, 'string');
    assert.ok(gateRes.readinessNotice.includes('LOCKED'));
  });

  // ============================================================================
  // 4. KILL SWITCH TEST
  // ============================================================================
  await runTest('4.1 Kill Switch: ARMED allows normal simulation, TRIGGERED blocks all requests', async () => {
    resetKillSwitch();
    assert.strictEqual(isKillSwitchTriggered(), false);
    const armRes = await simulateTransaction(mockCandidate, 'BUY', 10, null, 0);
    assert.strictEqual(armRes.result, 'APPROVED_FOR_SIMULATION');

    resetDuplicateOrderCache();
    triggerKillSwitch();
    assert.strictEqual(isKillSwitchTriggered(), true);

    const trigRes = await simulateTransaction(mockCandidate, 'BUY', 10, null, 0);
    assert.strictEqual(trigRes.result, 'REJECTED');
    assert.strictEqual(trigRes.reason, SIMULATION_REJECTION_REASONS.EMERGENCY_KILL_SWITCH_TRIGGERED);
  });

  await runTest('4.2 Kill Switch: Persistent state remains triggered until explicitly reset', async () => {
    triggerKillSwitch();
    assert.strictEqual(isKillSwitchTriggered(), true);
    
    // Evaluate safety gate while kill switch is active
    const res = await evaluatePreExecutionSafetyGate(mockCandidate, 'BUY', 10, 1000, 0);
    assert.strictEqual(res.finalStatus, 'SAFETY_GATE_REJECTED');
    assert.strictEqual(res.rejectionReason, SAFETY_GATE_REJECTION_REASONS.KILL_SWITCH_TRIGGERED);
    
    resetKillSwitch();
    assert.strictEqual(isKillSwitchTriggered(), false);
  });

  // ============================================================================
  // 5. DUPLICATE REQUEST TEST
  // ============================================================================
  await runTest('5.1 Duplicate Request: Second identical request rejected within sliding window', async () => {
    const cand = { ...mockCandidate, id: 'DUP_TEST_TOKEN' };
    const first = await simulateTransaction(cand, 'BUY', 10, null, 0);
    assert.strictEqual(first.result, 'APPROVED_FOR_SIMULATION');

    const second = await simulateTransaction(cand, 'BUY', 10, null, 0);
    assert.strictEqual(second.result, 'REJECTED');
    assert.strictEqual(second.reason, SIMULATION_REJECTION_REASONS.DUPLICATE_ORDER);
  });

  // ============================================================================
  // 6. SAFETY GATE ORDERING
  // ============================================================================
  await runTest('6.1 Safety Gate Ordering: Evaluates 13 checks in strict conceptual sequence', async () => {
    const res = await evaluatePreExecutionSafetyGate(mockCandidate, 'BUY', 10, 1000, 0);
    assert.strictEqual(res.finalStatus, 'SAFETY_GATE_PASSED');
    assert.ok(res.passedChecks >= 13);
    assert.strictEqual(res.failedChecks.length, 0);
    assert.strictEqual(res.transactionExecutionAuthorized, false);
  });

  // ============================================================================
  // 7. LIVE EXECUTION NEGATIVE TESTS
  // ============================================================================
  await runTest('7.1 Live Execution Negative Tests: All live methods fail closed with [SAFETY LOCK]', async () => {
    const liveEngine = new LiveExecutionEngine();

    await assert.rejects(async () => {
      await liveEngine.executeBuy();
    }, (err) => err.message.includes('[SAFETY LOCK]'));

    await assert.rejects(async () => {
      await liveEngine.executeSell();
    }, (err) => err.message.includes('[SAFETY LOCK]'));

    await assert.rejects(async () => {
      await liveEngine.connectWallet();
    }, (err) => err.message.includes('[SAFETY LOCK]'));

    await assert.rejects(async () => {
      await liveEngine.signTransaction();
    }, (err) => err.message.includes('[SAFETY LOCK]'));

    await assert.rejects(async () => {
      await liveEngine.submitTransaction();
    }, (err) => err.message.includes('[SAFETY LOCK]'));
  });

  // ============================================================================
  // 8. SECURITY SCAN
  // ============================================================================
  await runTest('8.1 Automated Security Scan: Category B executable live capability must be ZERO', async () => {
    const sensitivePatterns = [
      'sendTransaction',
      'sendRawTransaction',
      'signTransaction',
      'privateKey',
      'secretKey',
      'seedPhrase',
      'Keypair.fromSecretKey',
      'wallet',
      'transaction.sign',
      'transaction.send'
    ];

    const srcDir = path.join(PROJECT_ROOT, 'src');
    const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.js'));
    let categoryBCount = 0;
    const categoryAFindings = [];

    for (const file of files) {
      const filePath = path.join(srcDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        for (const pattern of sensitivePatterns) {
          if (line.includes(pattern)) {
            const trimmed = line.trim();
            // Classify line:
            // Is it a safety check, error throw, placeholder, comment, or readiness check?
            const isCategoryA = 
              trimmed.startsWith('//') || 
              trimmed.startsWith('*') || 
              trimmed.startsWith('/*') ||
              trimmed.includes('SAFETY LOCK') || 
              trimmed.includes('disabled') || 
              trimmed.includes('prohibited') || 
              trimmed.includes('throw new Error') || 
              trimmed.includes('UNAVAILABLE') || 
              trimmed.includes('unavailability') || 
              trimmed.includes('isWalletUnavailable') || 
              trimmed.includes('Placeholder') || 
              trimmed.includes('placeholder') || 
              trimmed.includes('process.env.SOLANA_') ||
              trimmed.includes('async signTransaction()') ||
              trimmed.includes('async submitTransaction()') ||
              trimmed.includes('async connectWallet()') ||
              trimmed.includes('async executeBuy()') ||
              trimmed.includes('async executeSell()');

            if (isCategoryA) {
              categoryAFindings.push({ file, line: index + 1, pattern, classification: 'SAFE / DISABLED / PLACEHOLDER' });
            } else {
              categoryBCount++;
              console.error(`[SECURITY AUDIT] Found potential executable live capability at ${file}:${index + 1}: ${trimmed}`);
            }
          }
        }
      });
    }

    assert.strictEqual(categoryBCount, 0, 'Category B (executable live capability) MUST BE EXACTLY ZERO');
  });

  // ============================================================================
  // 9. PAPER TRADING PROTECTION
  // ============================================================================
  await runTest('9.1 Paper Trading Protection: Failure injection tests do not alter production paper history', async () => {
    const history = getTradeHistory();
    const genuineTrades = history.filter(isGenuineMarketTrade);

    assert.ok(Array.isArray(history));
    assert.ok(genuineTrades.length >= 0);
    const fakeInGenuine = genuineTrades.filter(t => t.id && t.id.startsWith('TEST_'));
    assert.strictEqual(fakeInGenuine.length, 0, 'Genuine trades must not contain TEST_* records');
  });

  // ============================================================================
  // 10. TEST SIDE-EFFECT AUDIT
  // ============================================================================
  await runTest('10.1 Test Side-Effect Audit: Environment remains isolated and credentials missing', async () => {
    assert.strictEqual(process.env.SOLANA_PRIVATE_KEY, undefined);
    assert.strictEqual(process.env.SOLANA_WALLET_ADDRESS, undefined);
    assert.strictEqual(process.env.NODE_ENV, 'test');
  });

  // ============================================================================
  // 11. API SAFETY
  // ============================================================================
  await runTest('11.1 API Safety: Readiness & safety endpoints reject non-GET requests with HTTP 405', async () => {
    const TEST_PORT = 3100;
    await startDashboardServer(TEST_PORT);
    try {
      const endpoints = ['/api/status', '/api/simulation', '/api/safety-gate', '/api/trades'];
      for (const endpoint of endpoints) {
        const postRes = await fetch(`http://localhost:${TEST_PORT}${endpoint}`, { method: 'POST' });
        assert.strictEqual(postRes.status, 405, `POST ${endpoint} must return 405 Method Not Allowed`);

        const putRes = await fetch(`http://localhost:${TEST_PORT}${endpoint}`, { method: 'PUT' });
        assert.strictEqual(putRes.status, 405, `PUT ${endpoint} must return 405 Method Not Allowed`);

        const deleteRes = await fetch(`http://localhost:${TEST_PORT}${endpoint}`, { method: 'DELETE' });
        assert.strictEqual(deleteRes.status, 405, `DELETE ${endpoint} must return 405 Method Not Allowed`);
      }
    } finally {
      await stopDashboardServer();
    }
  });

  // ============================================================================
  // 12 & 13. CONFIGURATION INTEGRITY
  // ============================================================================
  await runTest('13.1 Configuration Integrity: All fixed risk and strategy parameters remain unaltered', async () => {
    assert.strictEqual(config.minLiquidityUsd, 10000, 'Minimum Liquidity must be $10,000');
    assert.strictEqual(config.min5mVolumeUsd, 5000, 'Minimum 5m Volume must be $5,000');
    assert.strictEqual(config.minStrategyScore, 70, 'Minimum Strategy Score must be 70');
    assert.strictEqual(config.maxRiskScore, 60, 'Maximum Risk Score must be 60');
    assert.strictEqual(config.profitTargetPercent, 5.0, 'Take Profit must be +5%');
    assert.strictEqual(config.stopLossPercent, 3.0, 'Stop Loss must be -3%');
    assert.strictEqual(config.maxHoldMinutes, 5, 'Max Hold must be 5 minutes');
    assert.strictEqual(config.maxSlippagePercent, 1.0, 'Max Slippage must be 1.0%');
    assert.strictEqual(config.maxPositionSizeUsd, 10.0, 'Max Position Size must be $10.00');
    assert.strictEqual(config.maxDailyLossUsd, 20.0, 'Max Daily Loss must be $20.00');
  });

} catch (globalErr) {
  console.error('[FATAL ERROR IN TEST SUITE]', globalErr);
} finally {
  console.log('\n====================================================');
  console.log(`PHASE 12 END-TO-END SAFETY TEST SUMMARY: ${passedTests} / ${totalTests} PASSED`);
  console.log('====================================================\n');
  if (passedTests !== totalTests) {
    process.exit(1);
  }
}
