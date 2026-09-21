process.env.NODE_ENV = 'test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  standardizePreLaunchCandidate,
  evaluatePreLaunchRisk,
  evaluatePreLaunchStrategy,
  processPreLaunchCandidates,
  verifyLaunchDayCandidate,
  handOffToPaperTrader,
  getTomorrowWatchlist,
  resetTomorrowWatchlist,
  PRE_LAUNCH_STATUS
} from '../src/preLaunchEngine.js';
import { resetTradeState, getTradeState, getTradeHistory } from '../src/paperTrader.js';
import { startDashboardServer, stopDashboardServer } from '../src/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..');

console.log('====================================================');
console.log('  RUNNING PHASE 9 — TOMORROW LAUNCH PRE-FILTER    ');
console.log('               ENGINE TEST SUITE                    ');
console.log('====================================================\n');

let passedTests = 0;
let totalTests = 0;

async function runTest(name, fn) {
  totalTests++;
  try {
    resetTomorrowWatchlist();
    resetTradeState();
    await fn();
    console.log(`[PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(`       Error: ${err.message}\n${err.stack}`);
  }
}

const mockPreLaunchComplete = {
  id: 'PRE_CONFIRMED_01',
  name: 'Tomorrows Gem',
  symbol: 'TGEM',
  chain: 'solana',
  contractAddress: '7wCM5K4ziHmrbjGe5QFhBqBME2fH82dn4Wfx8vhKSTNK',
  expectedLaunchDate: '2026-09-11',
  expectedLaunchTime: '15:00 UTC',
  platform: 'Pump.fun',
  websiteUrl: 'https://tomorrowsgem.io',
  socialLinks: ['https://twitter.com/tomorrowsgem', 'https://t.me/tomorrowsgem'],
  creatorInfo: 'Verified deployer with 2 successful prior launches',
  expectedLiquidityUsd: 25000,
  tokenomics: '1B total supply, 80% pool, 20% locked'
};

const mockPreLaunchIncomplete = {
  id: 'PRE_INCOMPLETE_02',
  name: 'Mystery Coin',
  symbol: 'MYST',
  chain: 'solana'
};

try {
  // ============================================================================
  // 1. INGESTION & DATA HONESTY TESTS
  // ============================================================================
  await runTest('1.1 Pre-Launch Discovery: Missing fields are strictly assigned UNKNOWN or null', async () => {
    const candidate = standardizePreLaunchCandidate(mockPreLaunchIncomplete);
    assert.strictEqual(candidate.name, 'Mystery Coin');
    assert.strictEqual(candidate.symbol, 'MYST');
    assert.strictEqual(candidate.contractAddress, 'UNKNOWN');
    assert.strictEqual(candidate.expectedLaunchDate, 'UNKNOWN');
    assert.strictEqual(candidate.expectedLaunchTime, 'UNKNOWN');
    assert.strictEqual(candidate.platform, 'UNKNOWN');
    assert.strictEqual(candidate.websiteUrl, 'UNKNOWN');
    assert.strictEqual(candidate.expectedLiquidityUsd, null);
    assert.strictEqual(candidate.dataConfidence, 'LOW');

    const emptyCandidate = standardizePreLaunchCandidate({});
    assert.strictEqual(emptyCandidate.name, 'UNKNOWN');
    assert.strictEqual(emptyCandidate.dataConfidence, 'UNKNOWN');
  });

  // ============================================================================
  // 2. PRE-LAUNCH RISK ANALYSIS TESTS
  // ============================================================================
  await runTest('2.1 Pre-Launch Risk: Missing information increases risk score and lists unknown factors', async () => {
    const candidate = standardizePreLaunchCandidate(mockPreLaunchIncomplete);
    const riskEval = evaluatePreLaunchRisk(candidate);

    assert.ok(riskEval.preLaunchRiskScore > 50, 'Missing fields must result in elevated risk score');
    assert.ok(riskEval.unknownFactors.length >= 4, 'Unknown factors must be documented');
    assert.ok(riskEval.unknownFactors.includes('Creator / deployer history unverified'));
  });

  // ============================================================================
  // 3 & 4. PRE-LAUNCH STRATEGY SCORING & FILTER STATUS ASSIGNMENT
  // ============================================================================
  await runTest('3.1 Filter Status: Complete verified candidate assigns READY_FOR_LAUNCH', async () => {
    const candidate = standardizePreLaunchCandidate(mockPreLaunchComplete);
    const riskEval = evaluatePreLaunchRisk(candidate);
    const stratEval = evaluatePreLaunchStrategy(candidate, riskEval);

    assert.ok(stratEval.preLaunchStrategyScore >= 70);
    assert.ok(riskEval.preLaunchRiskScore <= 60);
    assert.strictEqual(stratEval.status, PRE_LAUNCH_STATUS.READY_FOR_LAUNCH);
  });

  await runTest('3.2 Filter Status: Candidate missing exact launch time assigns WATCH', async () => {
    const watchCandidate = standardizePreLaunchCandidate({
      ...mockPreLaunchComplete,
      id: 'PRE_WATCH_01',
      expectedLaunchTime: 'UNKNOWN'
    });
    const riskEval = evaluatePreLaunchRisk(watchCandidate);
    const stratEval = evaluatePreLaunchStrategy(watchCandidate, riskEval);

    assert.strictEqual(stratEval.status, PRE_LAUNCH_STATUS.WATCH);
  });

  await runTest('3.3 Filter Status: High risk or low score candidate assigns REJECTED', async () => {
    const highRiskPreCandidate = standardizePreLaunchCandidate({
      ...mockPreLaunchComplete,
      id: 'PRE_REJECT_01',
      creatorInfo: 'Creator history contains past rug/scam indicators',
      expectedLiquidityUsd: 1000 // Below $10k min
    });
    const riskEval = evaluatePreLaunchRisk(highRiskPreCandidate);
    const stratEval = evaluatePreLaunchStrategy(highRiskPreCandidate, riskEval);

    assert.strictEqual(stratEval.status, PRE_LAUNCH_STATUS.REJECTED);
  });

  await runTest('3.4 Filter Status: Missing launch date assigns UNKNOWN', async () => {
    const unknownCandidate = standardizePreLaunchCandidate(mockPreLaunchIncomplete);
    const riskEval = evaluatePreLaunchRisk(unknownCandidate);
    const stratEval = evaluatePreLaunchStrategy(unknownCandidate, riskEval);

    assert.strictEqual(stratEval.status, PRE_LAUNCH_STATUS.UNKNOWN);
  });

  // ============================================================================
  // 5. TOMORROW WATCHLIST SHORTLIST PERSISTENCE
  // ============================================================================
  await runTest('5.1 Tomorrow Watchlist: Ranks candidates by strategy score descending', async () => {
    const rawCandidates = [
      mockPreLaunchIncomplete,
      mockPreLaunchComplete,
      { ...mockPreLaunchComplete, id: 'PRE_WATCH_02', expectedLaunchTime: 'UNKNOWN', expectedLiquidityUsd: 18000 }
    ];

    const shortlist = processPreLaunchCandidates(rawCandidates);
    assert.ok(Array.isArray(shortlist));
    assert.strictEqual(shortlist.length, 2, 'Should include READY_FOR_LAUNCH and WATCH candidates only');
    assert.strictEqual(shortlist[0].rank, 1);
    assert.strictEqual(shortlist[0].id, 'PRE_CONFIRMED_01');
    assert.strictEqual(shortlist[0].status, PRE_LAUNCH_STATUS.READY_FOR_LAUNCH);
  });

  // ============================================================================
  // 6. LAUNCH-DAY QUICK VERIFICATION & PAPER HANDOFF
  // ============================================================================
  await runTest('6.1 Launch-Day Verification: Valid launch market data returns FINAL_PASS', async () => {
    const preCandidate = standardizePreLaunchCandidate(mockPreLaunchComplete);

    const liveMarketData = {
      address: '7wCM5K4ziHmrbjGe5QFhBqBME2fH82dn4Wfx8vhKSTNK',
      symbol: 'TGEM',
      name: 'Tomorrows Gem',
      priceUsd: 0.0005,
      liquidityUsd: 25000,
      volume5mUsd: 12000,
      buys5m: 25,
      sells5m: 10,
      ageMinutes: 5,
      pairCreatedAt: Date.now() - (5 * 60 * 1000)
    };

    const verification = verifyLaunchDayCandidate(preCandidate, liveMarketData);
    assert.strictEqual(verification.decision, 'FINAL_PASS');
    assert.strictEqual(verification.reasons.length, 0);

    // Test handoff to paper trader
    const paperRes = await handOffToPaperTrader(verification.verifiedToken, 10);
    assert.strictEqual(getTradeState(), 'ACTIVE');
  });

  await runTest('6.2 Launch-Day Verification: Contract mismatch or low liquidity returns FINAL_REJECT', async () => {
    const preCandidate = standardizePreLaunchCandidate(mockPreLaunchComplete);

    const badMarketData = {
      address: 'WRONG_MINT_ADDRESS_999999',
      symbol: 'TGEM',
      priceUsd: 0.0005,
      liquidityUsd: 2000, // Below $10k min
      volume5mUsd: 100
    };

    const verification = verifyLaunchDayCandidate(preCandidate, badMarketData);
    assert.ok(verification.decision !== 'FINAL_PASS');
    assert.ok(verification.reasons.length >= 1);
  });

  // ============================================================================
  // 8. SECURITY SCAN
  // ============================================================================
  await runTest('8.1 Security Scan: Category B executable live capability must be ZERO', async () => {
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
  // 9. API SAFETY & DASHBOARD ENDPOINTS
  // ============================================================================
  await runTest('9.1 Dashboard API: /api/tomorrow-candidates & /api/prelaunch-status remain READ-ONLY', async () => {
    const TEST_PORT = 3104;
    await startDashboardServer(TEST_PORT);
    try {
      const resPost = await fetch(`http://localhost:${TEST_PORT}/api/tomorrow-candidates`, { method: 'POST' });
      assert.strictEqual(resPost.status, 405);

      const resWatchlist = await fetch(`http://localhost:${TEST_PORT}/api/tomorrow-candidates`);
      assert.strictEqual(resWatchlist.status, 200);
      const dataWatchlist = await resWatchlist.json();
      assert.strictEqual(dataWatchlist.mode, 'PRE_LAUNCH_ANALYSIS');

      const resStatus = await fetch(`http://localhost:${TEST_PORT}/api/prelaunch-status`);
      assert.strictEqual(resStatus.status, 200);
      const dataStatus = await resStatus.json();
      assert.strictEqual(dataStatus.mode, 'PRE_LAUNCH_ANALYSIS');
    } finally {
      await stopDashboardServer();
    }
  });

} catch (globalErr) {
  console.error('[FATAL ERROR IN TEST SUITE]', globalErr);
} finally {
  console.log('\n====================================================');
  console.log(`PHASE 9 PRE-LAUNCH ENGINE TEST SUMMARY: ${passedTests} / ${totalTests} PASSED`);
  console.log('====================================================\n');
  if (passedTests !== totalTests) {
    process.exit(1);
  }
}
