process.env.NODE_ENV = 'test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from '../src/config.js';
import { fetchTokenMarketDetails, detectNewSolanaTokens } from '../src/monitor.js';
import { evaluateTokenRisk } from '../src/riskFilter.js';
import { evaluateStrategy } from '../src/strategy.js';
import { evaluateTradeRisk, resetRiskManagerState } from '../src/riskManager.js';
import { validateBacktestData } from '../src/dataValidator.js';
import { evaluatePreExecutionSafetyGate, isSafetyConfigurationValid } from '../src/safetyGate.js';
import {
  simulateTransaction,
  SIMULATION_REJECTION_REASONS,
  resetDuplicateOrderCache,
  resetKillSwitch,
  clearSimulationAuditLogs
} from '../src/simulationLayer.js';
import { LiveExecutionEngine, PaperExecutionEngine } from '../src/executionEngine.js';
import { getTradeHistory, isGenuineMarketTrade } from '../src/paperTrader.js';
import { startDashboardServer, stopDashboardServer } from '../src/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..');

console.log('====================================================');
console.log('  RUNNING PHASE 13 — LIVE MARKET DATA & COIN      ');
console.log('            FILTERING AUDIT TEST SUITE             ');
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
    await fn();
    console.log(`[PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(`       Error: ${err.message}\n${err.stack}`);
  }
}

// Standard Mock Token Baseline Passing All Filters
const validMockToken = {
  id: 'FILTER_TEST_01',
  address: '7wCM5K4ziHmrbjGe5QFhBqBME2fH82dn4Wfx8vhKSTNK',
  pairAddress: 'PAIR_ADDRESS_TEST_123',
  symbol: 'SOLMEME',
  name: 'Solana Meme Token',
  priceUsd: 0.0005,
  liquidityUsd: 25000,
  volume5mUsd: 12000,
  volume24h: '$500,000.00',
  buys5m: 25,
  sells5m: 10,
  ageMinutes: 15,
  pairCreatedAt: Date.now() - (15 * 60 * 1000)
};

try {
  // ============================================================================
  // 1. LIVE MARKET DATA SOURCE VERIFICATION
  // ============================================================================
  await runTest('1.1 Market Data Source: Verify DexScreener API configuration & parameters', async () => {
    assert.strictEqual(config.dexscreenerApiUrl, 'https://api.dexscreener.com');
    assert.strictEqual(config.pollIntervalMs, 10000);
    assert.ok(typeof fetchTokenMarketDetails === 'function');
    assert.ok(typeof detectNewSolanaTokens === 'function');
  });

  // ============================================================================
  // 3. DATA VALIDATION TESTS
  // ============================================================================
  await runTest('3.1 Data Validation: Reject candidate with missing token address', async () => {
    const invalidToken = { ...validMockToken, address: null };
    const riskRes = evaluateTokenRisk(invalidToken);
    assert.strictEqual(riskRes.isCandidate, false);
    assert.strictEqual(riskRes.result, 'REJECT');
    assert.ok(riskRes.reason.includes('Missing or invalid price/market data'));
  });

  await runTest('3.2 Data Validation: Reject candidate with zero or negative price', async () => {
    const zeroPriceToken = { ...validMockToken, priceUsd: 0 };
    const resZero = evaluateTokenRisk(zeroPriceToken);
    assert.strictEqual(resZero.isCandidate, false);
    assert.strictEqual(resZero.result, 'REJECT');

    const negPriceToken = { ...validMockToken, priceUsd: -0.001 };
    const resNeg = evaluateTokenRisk(negPriceToken);
    assert.strictEqual(resNeg.isCandidate, false);
    assert.strictEqual(resNeg.result, 'REJECT');
  });

  await runTest('3.3 Data Validation: Reject malformed backtest dataset records', async () => {
    const rawData = [
      { token: 'VALID1', price: 0.001, timestamp: new Date().toISOString() },
      { token: 'INVALID_NO_PRICE', timestamp: new Date().toISOString() },
      { token: 'INVALID_NEG_PRICE', price: -5, timestamp: new Date().toISOString() },
      { token: 'INVALID_STALE_TIME', price: 0.002, timestamp: 'invalid-date-string' }
    ];
    const validation = validateBacktestData(rawData);
    assert.strictEqual(validation.validRecordsCount, 1);
    assert.strictEqual(validation.rejectedCount, 3);
  });

  // ============================================================================
  // 5 & 6. FILTER PARAMETERS & FILTER TESTING
  // ============================================================================
  await runTest('6.A Filter Testing: Liquidity below $10,000 -> REJECTED', async () => {
    const lowLiqToken = { ...validMockToken, liquidityUsd: 8500 };
    const riskRes = evaluateTokenRisk(lowLiqToken);
    assert.strictEqual(riskRes.isCandidate, false);
    assert.strictEqual(riskRes.result, 'REJECT');
    assert.ok(riskRes.reason.includes('Liquidity below minimum'));
  });

  await runTest('6.B Filter Testing: 5m volume below $5,000 -> REJECTED', async () => {
    const lowVolToken = { ...validMockToken, volume5mUsd: 3200 };
    const riskRes = evaluateTokenRisk(lowVolToken);
    assert.strictEqual(riskRes.isCandidate, false);
    assert.strictEqual(riskRes.result, 'REJECT');
    assert.ok(riskRes.reason.includes('5m Volume below minimum'));
  });

  await runTest('6.C Filter Testing: Strategy score below 70 -> REJECTED', async () => {
    // Create candidate with bare minimum liquidity/vol to pass Phase 3 risk filter, but low activity metrics
    const lowScoreToken = {
      ...validMockToken,
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

  await runTest('6.D Filter Testing: Risk score above 60 -> REJECTED', async () => {
    // Token passing Phase 3 & Strategy threshold, but exhibiting high risk factors (score > 60)
    const highRiskToken = {
      ...validMockToken,
      address: 'HIGH_RISK_ADDR_999',
      liquidityUsd: 10000,
      volume5mUsd: 5000,
      buys5m: 60,
      sells5m: 2,
      ageMinutes: 150
    };
    const riskPass = evaluateTokenRisk(highRiskToken);
    assert.strictEqual(riskPass.isCandidate, true);

    // Provide mock strategy score of 70
    const stratRes = { token: highRiskToken, totalScore: 70, status: 'CANDIDATE' };
    const riskDecision = evaluateTradeRisk(highRiskToken, stratRes);

    assert.strictEqual(riskDecision.approved, false);
    assert.ok(riskDecision.riskScore > config.maxRiskScore);
    assert.ok(riskDecision.reasons.some(r => r.includes('Risk score exceeds maximum threshold')));
  });

  await runTest('6.E Filter Testing: All required filters pass -> candidate may proceed', async () => {
    const freshPassToken = { ...validMockToken, address: 'PROCEED_PASS_ADDR_123' };
    const riskPass = evaluateTokenRisk(freshPassToken);
    assert.strictEqual(riskPass.isCandidate, true);

    const stratRes = evaluateStrategy(freshPassToken, riskPass);
    assert.strictEqual(stratRes.status, 'CANDIDATE');
    assert.ok(stratRes.totalScore >= 70);

    const riskDecision = evaluateTradeRisk(freshPassToken, stratRes);
    assert.strictEqual(riskDecision.approved, true);
    assert.ok(riskDecision.positionSize > 0);
  });

  // ============================================================================
  // 8. PAPER TRADE INTEGRITY
  // ============================================================================
  await runTest('8.1 Paper Trade Integrity: Test runs do not alter production paper history', async () => {
    const history = getTradeHistory();
    const genuine = history.filter(isGenuineMarketTrade);
    assert.ok(Array.isArray(history));
    assert.ok(genuine.length >= 0);
    const testTradesInGenuine = genuine.filter(t => t.id && t.id.startsWith('TEST_'));
    assert.strictEqual(testTradesInGenuine.length, 0);
  });

  // ============================================================================
  // 9. SIMULATION SEPARATION
  // ============================================================================
  await runTest('9.1 Simulation Separation: Market data simulation remains SIMULATION_ONLY', async () => {
    const simRes = await simulateTransaction(validMockToken, 'BUY', 10, null, 0);
    assert.strictEqual(simRes.result, 'APPROVED_FOR_SIMULATION');
    assert.strictEqual(simRes.plan.executionMode, 'SIMULATION_ONLY');
    assert.strictEqual(simRes.plan.broadcastEnabled, false);
  });

  // ============================================================================
  // 10. STALE DATA PROTECTION
  // ============================================================================
  await runTest('10.1 Stale Data Protection: Token age exceeding maximum allowed (180m) is REJECTED', async () => {
    const staleToken = {
      ...validMockToken,
      ageMinutes: 240 // 4 hours > 180 minutes max
    };
    const riskRes = evaluateTokenRisk(staleToken);
    assert.strictEqual(riskRes.isCandidate, false);
    assert.strictEqual(riskRes.result, 'REJECT');
    assert.ok(riskRes.reason.includes('Token age exceeds maximum allowed'));
  });

  // ============================================================================
  // 11. DUPLICATE CANDIDATE PROTECTION
  // ============================================================================
  await runTest('11.1 Duplicate Protection: Duplicate candidate request inside sliding window is REJECTED', async () => {
    const dupToken = { ...validMockToken, address: 'DUP_FILTER_UNIQUE_ADDR_777', id: 'DUP_FILTER_TOKEN_777' };
    const firstSim = await simulateTransaction(dupToken, 'BUY', 10, null, 0);
    assert.strictEqual(firstSim.result, 'APPROVED_FOR_SIMULATION');

    const secondSim = await simulateTransaction(dupToken, 'BUY', 10, null, 0);
    assert.strictEqual(secondSim.result, 'REJECTED');
    assert.strictEqual(secondSim.reason, SIMULATION_REJECTION_REASONS.DUPLICATE_ORDER);
  });

  // ============================================================================
  // 12. LIVE MARKET DATA FAILURE HANDLING
  // ============================================================================
  await runTest('12.1 Market Data Failure: Invalid/null address fetch handles errors gracefully', async () => {
    const result = await fetchTokenMarketDetails('INVALID_MINING_ADDRESS_999999999');
    assert.strictEqual(result, null);
  });

  // ============================================================================
  // 13. SECURITY SCAN
  // ============================================================================
  await runTest('13.1 Security Scan: Category B executable live capability must be ZERO', async () => {
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
  // 14. API / DASHBOARD SAFETY
  // ============================================================================
  await runTest('14.1 Dashboard Safety: All REST endpoints remain strictly READ-ONLY (GET)', async () => {
    const TEST_PORT = 3101;
    await startDashboardServer(TEST_PORT);
    try {
      const resPost = await fetch(`http://localhost:${TEST_PORT}/api/status`, { method: 'POST' });
      assert.strictEqual(resPost.status, 405);

      const resGet = await fetch(`http://localhost:${TEST_PORT}/api/status`);
      assert.strictEqual(resGet.status, 200);
      const data = await resGet.json();
      assert.strictEqual(data.tradingMode, 'PAPER');
      assert.strictEqual(data.liveTradingActive, false);
    } finally {
      await stopDashboardServer();
    }
  });

} catch (globalErr) {
  console.error('[FATAL ERROR IN TEST SUITE]', globalErr);
} finally {
  console.log('\n====================================================');
  console.log(`PHASE 13 FILTERING AUDIT TEST SUMMARY: ${passedTests} / ${totalTests} PASSED`);
  console.log('====================================================\n');
  if (passedTests !== totalTests) {
    process.exit(1);
  }
}
