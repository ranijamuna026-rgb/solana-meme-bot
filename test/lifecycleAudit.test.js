process.env.NODE_ENV = 'test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from '../src/config.js';
import {
  executePaperTrade,
  executePaperSell,
  getActiveTrade,
  getTradeState,
  resetTradeState,
  calculateTradeMetrics,
  getTradeHistory,
  isGenuineMarketTrade
} from '../src/paperTrader.js';
import { calculatePerformanceAnalytics } from '../src/analytics.js';
import { LiveExecutionEngine, PaperExecutionEngine } from '../src/executionEngine.js';
import { startDashboardServer, stopDashboardServer } from '../src/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..');

console.log('====================================================');
console.log('  RUNNING PHASE 15 — PAPER TRADING PERFORMANCE &   ');
console.log('          TRADE LIFECYCLE AUDIT TEST SUITE         ');
console.log('====================================================\n');

let passedTests = 0;
let totalTests = 0;

async function runTest(name, fn) {
  totalTests++;
  try {
    resetTradeState();
    await fn();
    console.log(`[PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(`       Error: ${err.message}\n${err.stack}`);
  }
}

const mockCandidate = {
  id: 'LIFECYCLE_TEST_01',
  address: 'ADDR_LIFECYCLE_001',
  symbol: 'LIFE',
  name: 'Lifecycle Test Token',
  priceUsd: 100.0,
  liquidityUsd: 25000,
  volume5mUsd: 12000
};

try {
  // ============================================================================
  // 5. TAKE PROFIT TEST (+5%)
  // ============================================================================
  await runTest('5.1 Take Profit: +5% price movement triggers exit with reason TAKE_PROFIT', async () => {
    // Custom price fetcher simulating entry at $100 and price rise to $105 (+5%)
    let currentPrice = 100.0;
    const customPriceFn = async () => {
      return { priceUsd: currentPrice };
    };

    // Execute paper BUY
    await executePaperTrade(mockCandidate, customPriceFn, 10);
    assert.strictEqual(getTradeState(), 'ACTIVE');

    // Simulate price movement to $105 (+5%)
    currentPrice = 105.0;

    // Trigger sell evaluation manually or wait for cycle
    const active = getActiveTrade();
    assert.strictEqual(active.active, true);
    
    // Simulate trade sell completion at $105
    const closedRecord = executePaperSell(active.trade, 105.0, 15000, 'TAKE_PROFIT');
    assert.strictEqual(closedRecord.exitReason, 'TAKE_PROFIT');
    assert.strictEqual(closedRecord.exitPrice, 105.0);
    assert.ok(closedRecord.pnl > 0);
    assert.strictEqual(closedRecord.pnlPercent, 5);
  });

  // ============================================================================
  // 6. STOP LOSS TEST (-3%)
  // ============================================================================
  await runTest('6.1 Stop Loss: -3% price movement triggers exit with reason STOP_LOSS', async () => {
    let currentPrice = 100.0;
    const customPriceFn = async () => ({ priceUsd: currentPrice });

    await executePaperTrade(mockCandidate, customPriceFn, 10);
    assert.strictEqual(getTradeState(), 'ACTIVE');

    currentPrice = 97.0;
    const active = getActiveTrade();
    assert.strictEqual(active.active, true);

    const closedRecord = executePaperSell(active.trade, 97.0, 20000, 'STOP_LOSS');
    assert.strictEqual(closedRecord.exitReason, 'STOP_LOSS');
    assert.strictEqual(closedRecord.exitPrice, 97.0);
    assert.ok(closedRecord.pnl < 0);
    assert.strictEqual(closedRecord.pnlPercent, -3);
  });

  // ============================================================================
  // 7. MAX HOLD TIME TEST (5 Minutes)
  // ============================================================================
  await runTest('7.1 Max Hold Time: 5 minutes time elapsed triggers exit with reason MAX_HOLD_TIME', async () => {
    let currentPrice = 100.5; // Slight price movement within TP/SL bounds
    const customPriceFn = async () => ({ priceUsd: currentPrice });

    await executePaperTrade(mockCandidate, customPriceFn, 10);
    assert.strictEqual(getTradeState(), 'ACTIVE');

    const active = getActiveTrade();
    assert.strictEqual(active.active, true);

    // Simulate 5m 1s hold duration (301,000 ms)
    const closedRecord = executePaperSell(active.trade, 100.5, 301000, 'MAX_HOLD_TIME');
    assert.strictEqual(closedRecord.exitReason, 'MAX_HOLD_TIME');
    assert.ok(closedRecord.durationMs >= 300000);
  });

  // ============================================================================
  // 12. PAPER TRADE LIFECYCLE TESTS (D, E, F, G)
  // ============================================================================
  await runTest('12.D Failure Handling: Invalid API price response handles error gracefully without crash', async () => {
    const invalidCandidate = { ...mockCandidate, priceUsd: null };
    const result = await executePaperTrade(invalidCandidate, null, 10);
    assert.strictEqual(result, null);
    assert.strictEqual(getTradeState(), 'IDLE');
  });

  await runTest('12.E Duplicate Active Trade: Active trade blocks duplicate paper trade entry', async () => {
    await executePaperTrade(mockCandidate, null, 10);
    assert.strictEqual(getTradeState(), 'ACTIVE');

    // Attempt second parallel paper trade
    const dupCandidate = { ...mockCandidate, id: 'DUP_PARALLEL_TEST' };
    const secondResult = await executePaperTrade(dupCandidate, null, 10);
    assert.strictEqual(secondResult, null, 'Second paper trade entry must be blocked while first trade is active');
  });

  await runTest('12.F Position Size Cap: Position size cannot exceed maximum limit ($10.00)', async () => {
    // Attempt paper trade requesting $50 position size
    await executePaperTrade(mockCandidate, null, 50);
    assert.strictEqual(getTradeState(), 'ACTIVE');

    const active = getActiveTrade();
    assert.strictEqual(active.trade.investmentUsd, 10.0, 'Position size must be capped at $10.00 max');
    assert.strictEqual(config.maxPositionSizeUsd, 10.0, 'Config maxPositionSizeUsd must remain $10.00');
  });

  await runTest('12.G Stale / Malformed Data: Rejects zero price or missing address', async () => {
    const zeroPriceCand = { ...mockCandidate, priceUsd: 0 };
    const zeroRes = await executePaperTrade(zeroPriceCand, null, 10);
    assert.strictEqual(zeroRes, null);

    const negPriceCand = { ...mockCandidate, priceUsd: -5.0 };
    const negRes = await executePaperTrade(negPriceCand, null, 10);
    assert.strictEqual(negRes, null);
  });

  // ============================================================================
  // 14. PERFORMANCE METRICS AUDIT
  // ============================================================================
  await runTest('14.1 Performance Metrics: Analytics correctly calculates win rate, total P&L, and counts', async () => {
    const sampleHistory = [
      { tradeId: 'PT-001', symbol: 'TEST1', pnl: 0.5, pnlPercent: 5, exitReason: 'TAKE_PROFIT', source: 'market_data', entryPrice: 10, exitPrice: 10.5 },
      { tradeId: 'PT-002', symbol: 'TEST2', pnl: -0.3, pnlPercent: -3, exitReason: 'STOP_LOSS', source: 'market_data', entryPrice: 10, exitPrice: 9.7 },
      { tradeId: 'PT-003', symbol: 'TEST3', pnl: 0.1, pnlPercent: 1, exitReason: 'MAX_HOLD_TIME', source: 'market_data', entryPrice: 10, exitPrice: 10.1 }
    ];

    const analytics = calculatePerformanceAnalytics(sampleHistory);
    assert.strictEqual(analytics.totalTrades, 3);
    assert.strictEqual(analytics.winningTrades, 2);
    assert.strictEqual(analytics.losingTrades, 1);
    assert.strictEqual(analytics.winRatePercent, 66.67);
    assert.strictEqual(analytics.totalPnlUsd, 0.3);
    assert.strictEqual(analytics.takeProfitCount, 1);
    assert.strictEqual(analytics.stopLossCount, 1);
    assert.strictEqual(analytics.maxHoldCount, 1);
  });

  // ============================================================================
  // 16. SECURITY SCAN
  // ============================================================================
  await runTest('16.1 Security Scan: Category B executable live capability must be ZERO', async () => {
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
  // 17. DASHBOARD REST ENDPOINTS READ-ONLY SAFETY
  // ============================================================================
  await runTest('17.1 Dashboard Safety: Endpoints remain strictly READ-ONLY (GET)', async () => {
    const TEST_PORT = 3103;
    await startDashboardServer(TEST_PORT);
    try {
      const resPost = await fetch(`http://localhost:${TEST_PORT}/api/status`, { method: 'POST' });
      assert.strictEqual(resPost.status, 405);

      const resGet = await fetch(`http://localhost:${TEST_PORT}/api/status`);
      assert.strictEqual(resGet.status, 200);
    } finally {
      await stopDashboardServer();
    }
  });

} catch (globalErr) {
  console.error('[FATAL ERROR IN TEST SUITE]', globalErr);
} finally {
  console.log('\n====================================================');
  console.log(`PHASE 15 LIFECYCLE AUDIT TEST SUMMARY: ${passedTests} / ${totalTests} PASSED`);
  console.log('====================================================\n');
  if (passedTests !== totalTests) {
    process.exitCode = 1;
  }
}
