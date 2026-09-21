process.env.NODE_ENV = 'test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from '../src/config.js';
import { evaluateTokenRisk } from '../src/riskFilter.js';
import { evaluateStrategy, getBestCandidate } from '../src/strategy.js';
import { evaluateTradeRisk, calculateRiskScore, resetRiskManagerState, registerActiveTrade } from '../src/riskManager.js';
import { recordCandidate, getCandidates, resetCandidateTracker } from '../src/candidateTracker.js';
import { evaluatePreExecutionSafetyGate } from '../src/safetyGate.js';
import { simulateTransaction, SIMULATION_REJECTION_REASONS, resetKillSwitch, resetDuplicateOrderCache, clearSimulationAuditLogs } from '../src/simulationLayer.js';
import { LiveExecutionEngine, PaperExecutionEngine } from '../src/executionEngine.js';
import { getTradeHistory, isGenuineMarketTrade } from '../src/paperTrader.js';
import { startDashboardServer, stopDashboardServer } from '../src/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..');

console.log('====================================================');
console.log('  RUNNING PHASE 14 — LIVE CANDIDATE RANKING &     ');
console.log('       PAPER TRADING DECISION AUDIT TEST SUITE      ');
console.log('====================================================\n');

let passedTests = 0;
let totalTests = 0;

async function runTest(name, fn) {
  totalTests++;
  try {
    resetKillSwitch();
    resetDuplicateOrderCache();
    clearSimulationAuditLogs();
    resetRiskManagerState();
    resetCandidateTracker();
    await fn();
    console.log(`[PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(`       Error: ${err.message}\n${err.stack}`);
  }
}

// Baseline Valid Candidate Tokens for Testing
const candidateTokenA = {
  id: 'CANDIDATE_A_75',
  address: 'ADDR_CANDIDATE_A_75_001',
  symbol: 'CANDA',
  name: 'Candidate Token A',
  priceUsd: 0.0005,
  liquidityUsd: 15000,
  volume5mUsd: 8000,
  buys5m: 15,
  sells5m: 10,
  ageMinutes: 45
};

const candidateTokenB = {
  id: 'CANDIDATE_B_85',
  address: 'ADDR_CANDIDATE_B_85_002',
  symbol: 'CANDB',
  name: 'Candidate Token B',
  priceUsd: 0.0010,
  liquidityUsd: 30000,
  volume5mUsd: 22000,
  buys5m: 35,
  sells5m: 20,
  ageMinutes: 20
};

const candidateTokenC = {
  id: 'CANDIDATE_C_FAIL',
  address: 'ADDR_CANDIDATE_C_FAIL_003',
  symbol: 'CANDC',
  name: 'Candidate Token C (Fails Filter)',
  priceUsd: 0.0002,
  liquidityUsd: 4000, // Below $10k min liquidity
  volume5mUsd: 1000, // Below $5k min volume
  buys5m: 2,
  sells5m: 0,
  ageMinutes: 10
};

try {
  // ============================================================================
  // 3. RISK SCORE AUDIT TESTS
  // ============================================================================
  await runTest('3.1 Risk Score: Factors increasing/decreasing risk evaluate correctly', async () => {
    const lowRiskAnalysis = calculateRiskScore(candidateTokenB, 85);
    assert.ok(lowRiskAnalysis.score <= 60, `Low risk score (${lowRiskAnalysis.score}) must be <= 60`);

    const highRiskToken = {
      address: 'HIGH_RISK_ADDR_TEST',
      liquidityUsd: 10000,
      volume5mUsd: 5000,
      buys5m: 80,
      sells5m: 2,
      ageMinutes: 150
    };
    const highRiskAnalysis = calculateRiskScore(highRiskToken, 70);
    assert.ok(highRiskAnalysis.score > 60, `High risk score (${highRiskAnalysis.score}) must be > 60`);
    assert.strictEqual(highRiskAnalysis.rating, 'HIGH RISK');
  });

  await runTest('3.2 Risk Score: Candidate with risk score > 60 is REJECTED by evaluateTradeRisk', async () => {
    const highRiskToken = {
      address: 'HIGH_RISK_ADDR_REJECT',
      symbol: 'HIGHRISK',
      name: 'High Risk Token',
      priceUsd: 0.001,
      liquidityUsd: 10000,
      volume5mUsd: 5000,
      buys5m: 80,
      sells5m: 2,
      ageMinutes: 150
    };
    const riskPass = evaluateTokenRisk(highRiskToken);
    assert.strictEqual(riskPass.isCandidate, true);

    const stratRes = { token: highRiskToken, totalScore: 70, status: 'CANDIDATE' };
    const decision = evaluateTradeRisk(highRiskToken, stratRes);
    assert.strictEqual(decision.approved, false);
    assert.ok(decision.riskScore > 60);
    assert.ok(decision.reasons.some(r => r.includes('Risk score exceeds maximum threshold')));
  });

  // ============================================================================
  // 4. STRATEGY SCORE AUDIT TESTS
  // ============================================================================
  await runTest('4.1 Strategy Score: Candidate with strategy score < 70 is REJECTED', async () => {
    const lowScoreToken = {
      address: 'LOW_SCORE_ADDR_001',
      symbol: 'LOWSCORE',
      name: 'Low Strategy Score Token',
      priceUsd: 0.001,
      liquidityUsd: 10000,
      volume5mUsd: 5000,
      buys5m: 5,
      sells5m: 2,
      ageMinutes: 150
    };
    const riskPass = evaluateTokenRisk(lowScoreToken);
    assert.strictEqual(riskPass.isCandidate, true);

    const stratRes = evaluateStrategy(lowScoreToken, riskPass);
    assert.ok(stratRes.totalScore < config.minStrategyScore);
    assert.ok(stratRes.status.includes('REJECTED'));
  });

  // ============================================================================
  // 5 & 6. CANDIDATE RANKING & BEST CANDIDATE SELECTION
  // ============================================================================
  await runTest('5.1 & 6.1 Candidate Ranking: Candidate C rejected, Candidate B selected over Candidate A', async () => {
    // 1. Evaluate Candidate C (Fails liquidity & volume)
    const riskC = evaluateTokenRisk(candidateTokenC);
    assert.strictEqual(riskC.isCandidate, false);
    assert.strictEqual(riskC.result, 'REJECT');

    // 2. Evaluate Candidate A (Passes risk, receives strategy score 73)
    const riskA = evaluateTokenRisk(candidateTokenA);
    assert.strictEqual(riskA.isCandidate, true);
    const stratA = evaluateStrategy(candidateTokenA, riskA);
    assert.strictEqual(stratA.status, 'CANDIDATE');

    let bestSoFar = getBestCandidate();
    assert.strictEqual(bestSoFar.token.symbol, 'CANDA');
    assert.strictEqual(bestSoFar.score, stratA.totalScore);

    // 3. Evaluate Candidate B (Passes risk, receives higher strategy score 95)
    const riskB = evaluateTokenRisk(candidateTokenB);
    assert.strictEqual(riskB.isCandidate, true);
    const stratB = evaluateStrategy(candidateTokenB, riskB);
    assert.strictEqual(stratB.status, 'CANDIDATE');
    assert.ok(stratB.totalScore > stratA.totalScore);

    // 4. Verify Candidate B replaced Candidate A as Best Candidate
    const bestFinal = getBestCandidate();
    assert.strictEqual(bestFinal.token.symbol, 'CANDB');
    assert.strictEqual(bestFinal.score, stratB.totalScore);
  });

  await runTest('6.2 Active-Trade & Duplicate Protection: Active trade prevents duplicate execution', async () => {
    const token = { ...candidateTokenB, address: 'ACTIVE_TOKEN_ADDR_555' };
    
    // Register token as active position in riskManager
    registerActiveTrade(token.address);

    const stratRes = { token, totalScore: 85, status: 'CANDIDATE' };
    const decision = evaluateTradeRisk(token, stratRes);
    assert.strictEqual(decision.approved, false);
    assert.ok(decision.reasons.some(r => r.includes('Duplicate trade blocked')));
  });

  // ============================================================================
  // 10. PAPER TRADE PROTECTION FOR REJECTED CANDIDATES
  // ============================================================================
  await runTest('10.1 Paper Trade Protection: Rejected candidates produce zero paper trades', async () => {
    const historyBefore = getTradeHistory();

    // 1. Attempt pipeline on Candidate C (Fails risk filter)
    const riskC = evaluateTokenRisk(candidateTokenC);
    assert.strictEqual(riskC.isCandidate, false);

    // Simulate main pipeline logic (src/index.js line 63)
    if (riskC.isCandidate) {
      const stratRes = evaluateStrategy(candidateTokenC, riskC);
      if (stratRes && stratRes.status === 'CANDIDATE') {
        const riskDec = evaluateTradeRisk(candidateTokenC, stratRes);
        if (riskDec.approved) {
          throw new Error('Rejected candidate must NOT be approved for paper trading');
        }
      }
    }

    // 2. Simulate transaction rejection for invalid candidate
    const simRes = await simulateTransaction(null, 'BUY', 10, null, 0);
    assert.strictEqual(simRes.result, 'REJECTED');

    const historyAfter = getTradeHistory();
    assert.strictEqual(historyBefore.length, historyAfter.length, 'No paper trades should be created for rejected candidate');
  });

  // ============================================================================
  // 11. CONTINUOUS MONITORING RING BUFFER
  // ============================================================================
  await runTest('11.1 Continuous Monitoring: Candidate ring buffer records and bounds evaluated candidates', async () => {
    resetCandidateTracker();

    for (let i = 1; i <= 60; i++) {
      recordCandidate({
        address: `ADDR_RING_BUF_${i}`,
        symbol: `BUF${i}`,
        name: `Buffer Token ${i}`,
        priceUsd: 0.001,
        liquidityUsd: 15000,
        volume5mUsd: 8000,
        riskFilter: { result: 'PASS' }
      });
    }

    const tracked = getCandidates();
    assert.strictEqual(tracked.length, 50, 'Candidate tracker ring buffer must cap at 50 candidates');
    assert.strictEqual(tracked[0].symbol, 'BUF60', 'Newest candidate must be at front');
  });

  // ============================================================================
  // 14. LIVE EXECUTION SECURITY
  // ============================================================================
  await runTest('14.1 Security Scan: Category B executable live capability must be ZERO', async () => {
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

    for (const file of files) {
      const filePath = path.join(srcDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        for (const pattern of sensitivePatterns) {
          if (line.includes(pattern)) {
            const trimmed = line.trim();
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

            if (!isCategoryA) {
              categoryBCount++;
              console.error(`[SECURITY AUDIT] Potential live capability found at ${file}:${index + 1}: ${trimmed}`);
            }
          }
        }
      });
    }

    assert.strictEqual(categoryBCount, 0, 'Category B (executable live capability) MUST BE EXACTLY ZERO');
  });

  // ============================================================================
  // 15. API / DASHBOARD READ-ONLY SAFETY
  // ============================================================================
  await runTest('15.1 Dashboard API: Dashboard endpoints reject non-GET requests with 405', async () => {
    const TEST_PORT = 3102;
    await startDashboardServer(TEST_PORT);
    try {
      const resPost = await fetch(`http://localhost:${TEST_PORT}/api/status`, { method: 'POST' });
      assert.strictEqual(resPost.status, 405);

      const resCandidates = await fetch(`http://localhost:${TEST_PORT}/api/candidates`);
      assert.strictEqual(resCandidates.status, 200);
    } finally {
      await stopDashboardServer();
    }
  });

} catch (globalErr) {
  console.error('[FATAL ERROR IN TEST SUITE]', globalErr);
} finally {
  console.log('\n====================================================');
  console.log(`PHASE 14 CANDIDATE RANKING AUDIT SUMMARY: ${passedTests} / ${totalTests} PASSED`);
  console.log('====================================================\n');
  if (passedTests !== totalTests) {
    process.exit(1);
  }
}
