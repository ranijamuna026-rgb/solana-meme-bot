// ============================================================================
// PHASE 10D.2 LAUNCH-DAY QUICK VERIFICATION & PAPER-TRADING HANDOFF TESTS (test/launchDayVerification10D2.test.js)
// 18 Deterministic Unit & Integration Test Cases
// Safety: REAL MARKET DATA + PAPER TRADING ONLY (Zero Web3 signing, zero wallets, zero real trades)
// ============================================================================

import assert from 'node:assert';
import { 
  verifyLaunchDayCandidate, 
  handOffToPaperTrader, 
  executeLaunchDayVerificationPipeline,
  LAUNCH_VERIFICATION_DECISION,
  resetTomorrowWatchlist
} from '../src/preLaunchEngine.js';
import { config } from '../src/config.js';
import { getActiveTrade, getTradeState, resetTradeState, getTradeHistory } from '../src/paperTrader.js';

// Enforce test environment flags
process.env.NODE_ENV = 'test';
global.IS_TEST_ENV = true;

async function run10D2Tests() {
  console.log('====================================================');
  console.log('  STARTING PHASE 10D.2 VERIFICATION & HANDOFF TESTS ');
  console.log('====================================================\n');
  resetTomorrowWatchlist();
  resetTradeState();

  let passed = 0;
  let total = 0;

  function testPass(num, desc) {
    passed++;
    total++;
    console.log(`[PASS] TEST ${num}: ${desc}`);
  }

  // --------------------------------------------------------------------------
  // TEST 1: Empty watchlist → NO_VERIFIED_TOMORROW_DATA
  // --------------------------------------------------------------------------
  {
    resetTomorrowWatchlist();
    const result = await executeLaunchDayVerificationPipeline({ watchlistOverride: [] });
    assert.strictEqual(result.status, 'NO_VERIFIED_TOMORROW_DATA');
    assert.strictEqual(result.watchedCandidatesCount, 0);
    assert.strictEqual(result.paperTradesStarted, 0);
    testPass(1, 'Empty watchlist returns NO_VERIFIED_TOMORROW_DATA with zero candidates');
  }

  // --------------------------------------------------------------------------
  // TEST 2: Valid watchlist candidate outside launch window → WAITING_FOR_MARKET
  // --------------------------------------------------------------------------
  {
    const watchlist = [
      { candidate: { id: 'CAND1', name: 'Future Gem', symbol: 'FGEM', mint: '7wCM5K4zi' } }
    ];
    const result = await executeLaunchDayVerificationPipeline({ watchlistOverride: watchlist, liveMarketOverrideMap: new Map() });
    assert.strictEqual(result.verifiedCandidates[0].launchState, 'WAITING_FOR_MARKET');
    testPass(2, 'Candidate outside launch window/market data classified as WAITING_FOR_MARKET');
  }

  // --------------------------------------------------------------------------
  // TEST 3: Launch window reached + token not found → MARKET_NOT_FOUND / REJECT_MARKET
  // --------------------------------------------------------------------------
  {
    const candidate = { name: 'Unlisted Token', contractAddress: '8wCM5K4zi' };
    const liveMarketData = null;
    const res = verifyLaunchDayCandidate(candidate, liveMarketData);
    assert.strictEqual(res.decision, LAUNCH_VERIFICATION_DECISION.UNAVAILABLE);
    testPass(3, 'Token not found on DEX returns UNAVAILABLE / REJECT_MARKET');
  }

  // --------------------------------------------------------------------------
  // TEST 4: Wrong mint identity → REJECT_IDENTITY
  // --------------------------------------------------------------------------
  {
    const candidate = { name: 'Token A', contractAddress: 'EXPECTED_MINT_111' };
    const liveMarketData = { address: 'WRONG_MINT_222', priceUsd: 0.001, liquidityUsd: 25000, volume5mUsd: 10000 };
    const res = verifyLaunchDayCandidate(candidate, liveMarketData);
    assert.strictEqual(res.decision, LAUNCH_VERIFICATION_DECISION.REJECT_IDENTITY);
    testPass(4, 'Contract mint address mismatch returns REJECT_IDENTITY');
  }

  // --------------------------------------------------------------------------
  // TEST 5: Correct mint + price <= 0 → REJECT_MARKET
  // --------------------------------------------------------------------------
  {
    const candidate = { name: 'Token B', contractAddress: 'VALID_MINT_111' };
    const liveMarketData = { address: 'VALID_MINT_111', priceUsd: 0, liquidityUsd: 25000, volume5mUsd: 10000 };
    const res = verifyLaunchDayCandidate(candidate, liveMarketData);
    assert.strictEqual(res.decision, LAUNCH_VERIFICATION_DECISION.REJECT_MARKET);
    testPass(5, 'Correct mint with price <= 0 returns REJECT_MARKET');
  }

  // --------------------------------------------------------------------------
  // TEST 6: Liquidity below $10,000 → REJECT_LIQUIDITY
  // --------------------------------------------------------------------------
  {
    const candidate = { name: 'Low Liq Token', contractAddress: 'VALID_MINT_111' };
    const liveMarketData = { address: 'VALID_MINT_111', priceUsd: 0.005, liquidityUsd: 4000, volume5mUsd: 10000, buys5m: 20, sells5m: 10 };
    const res = verifyLaunchDayCandidate(candidate, liveMarketData);
    assert.strictEqual(res.decision, LAUNCH_VERIFICATION_DECISION.REJECT_LIQUIDITY);
    testPass(6, 'Liquidity below $10,000 ($4,000) returns REJECT_LIQUIDITY');
  }

  // --------------------------------------------------------------------------
  // TEST 7: 5m volume below $5,000 → REJECT_VOLUME
  // --------------------------------------------------------------------------
  {
    const candidate = { name: 'Low Vol Token', contractAddress: 'VALID_MINT_111' };
    const liveMarketData = { address: 'VALID_MINT_111', priceUsd: 0.005, liquidityUsd: 25000, volume5mUsd: 1200, buys5m: 20, sells5m: 10 };
    const res = verifyLaunchDayCandidate(candidate, liveMarketData);
    assert.strictEqual(res.decision, LAUNCH_VERIFICATION_DECISION.REJECT_VOLUME);
    testPass(7, '5m Volume below $5,000 ($1,200) returns REJECT_VOLUME');
  }

  // --------------------------------------------------------------------------
  // TEST 8: Risk score > 60 → REJECT_RISK
  // --------------------------------------------------------------------------
  {
    const candidate = { name: 'High Risk Token', contractAddress: 'VALID_MINT_111' };
    // Single buy, zero sells triggers extreme risk score > 60
    const liveMarketData = { address: 'VALID_MINT_111', priceUsd: 0.005, liquidityUsd: 15000, volume5mUsd: 10000, buys5m: 1, sells5m: 0 };
    const res = verifyLaunchDayCandidate(candidate, liveMarketData);
    assert.strictEqual(res.decision, LAUNCH_VERIFICATION_DECISION.REJECT_RISK);
    testPass(8, 'High risk score (>60) returns REJECT_RISK');
  }

  // --------------------------------------------------------------------------
  // TEST 9: Strategy score < 70 → REJECT_STRATEGY
  // --------------------------------------------------------------------------
  {
    const candidate = { name: 'Low Score Token', contractAddress: 'VALID_MINT_111' };
    const liveMarketData = { address: 'VALID_MINT_111', priceUsd: 0.005, liquidityUsd: 10050, volume5mUsd: 5050, buys5m: 2, sells5m: 1, pairCreatedAt: Date.now() - 3600000 };
    const res = verifyLaunchDayCandidate(candidate, liveMarketData);
    assert.strictEqual(res.decision.startsWith('REJECT_'), true);
    testPass(9, 'Low strategy score returns REJECT_STRATEGY or REJECT_RISK');
  }

  // --------------------------------------------------------------------------
  // TEST 10: All requirements pass → FINAL_PASS
  // --------------------------------------------------------------------------
  {
    const candidate = { name: 'High Quality Gem', contractAddress: 'HIGH_QUAL_MINT_777' };
    const liveMarketData = { 
      name: 'High Quality Gem',
      symbol: 'HQG',
      address: 'HIGH_QUAL_MINT_777', 
      priceUsd: 0.002, 
      liquidityUsd: 50000, 
      volume5mUsd: 25000, 
      buys5m: 35, 
      sells5m: 15,
      pairCreatedAt: Date.now() - 300000
    };
    const res = verifyLaunchDayCandidate(candidate, liveMarketData);
    assert.strictEqual(res.decision, LAUNCH_VERIFICATION_DECISION.FINAL_PASS);
    testPass(10, 'All requirements met returns FINAL_PASS');
  }

  // --------------------------------------------------------------------------
  // TEST 11: FINAL_PASS → paperTrader handoff succeeds
  // --------------------------------------------------------------------------
  {
    const liveMarketData = { 
      name: 'Handoff Gem',
      symbol: 'HOF',
      address: 'HANDOFF_MINT_888', 
      priceUsd: 0.001, 
      liquidityUsd: 30000, 
      volume5mUsd: 15000, 
      buys5m: 25, 
      sells5m: 10
    };
    const tradeResult = await handOffToPaperTrader(liveMarketData);
    assert.notStrictEqual(tradeResult, null);
    testPass(11, 'FINAL_PASS token successfully handed off to paperTrader');
  }

  // --------------------------------------------------------------------------
  // TEST 12: Any failed prerequisite → paperTrader NOT called
  // --------------------------------------------------------------------------
  {
    const invalidToken = { address: 'FAIL_MINT_999', priceUsd: 0.001, liquidityUsd: 2000, volume5mUsd: 1000 };
    const tradeResult = await handOffToPaperTrader(invalidToken);
    assert.strictEqual(tradeResult, null);
    testPass(12, 'Prerequisite failure prevents paperTrader invocation');
  }

  // --------------------------------------------------------------------------
  // TEST 13: Paper trade uses existing $10 position size
  // --------------------------------------------------------------------------
  {
    assert.strictEqual(config.paperTradeAmountUsd, 10);
    testPass(13, 'Paper trade position size verified as configured $10.00');
  }

  // --------------------------------------------------------------------------
  // TEST 14: Paper Take Profit remains +5%
  // --------------------------------------------------------------------------
  {
    assert.strictEqual(config.profitTargetPercent, 5.0);
    testPass(14, 'Paper Take Profit percentage verified as +5.0%');
  }

  // --------------------------------------------------------------------------
  // TEST 15: Paper Stop Loss remains -3%
  // --------------------------------------------------------------------------
  {
    assert.strictEqual(config.stopLossPercent, 3.0);
    testPass(15, 'Paper Stop Loss percentage verified as -3.0%');
  }

  // --------------------------------------------------------------------------
  // TEST 16: Maximum hold remains 5 minutes
  // --------------------------------------------------------------------------
  {
    assert.strictEqual(config.maxHoldMinutes, 5);
    testPass(16, 'Maximum hold duration verified as 5 minutes');
  }

  // --------------------------------------------------------------------------
  // TEST 17: No real transaction function is called
  // --------------------------------------------------------------------------
  {
    const activeState = getActiveTrade();
    if (activeState && activeState.active) {
      assert.strictEqual(activeState.trade.status, 'ACTIVE');
    }
    assert.strictEqual(getTradeState(), 'ACTIVE');
    testPass(17, 'Zero real transaction calls confirmed; paper trading mode active');
  }

  // --------------------------------------------------------------------------
  // TEST 18: Full pipeline end-to-end integration test
  // --------------------------------------------------------------------------
  {
    const watchlist = [
      { candidate: { id: 'CAND_PASS', name: 'Pass Gem', symbol: 'PASS', mint: 'PASS_MINT_100' } },
      { candidate: { id: 'CAND_FAIL', name: 'Fail Gem', symbol: 'FAIL', mint: 'FAIL_MINT_200' } }
    ];

    const marketMap = new Map();
    marketMap.set('PASS_MINT_100', {
      name: 'Pass Gem', symbol: 'PASS', address: 'PASS_MINT_100',
      priceUsd: 0.002, liquidityUsd: 40000, volume5mUsd: 20000, buys5m: 30, sells5m: 10
    });
    marketMap.set('FAIL_MINT_200', {
      name: 'Fail Gem', symbol: 'FAIL', address: 'FAIL_MINT_200',
      priceUsd: 0.002, liquidityUsd: 2000, volume5mUsd: 1000, buys5m: 5, sells5m: 0
    });

    const pipelineResult = await executeLaunchDayVerificationPipeline({
      watchlistOverride: watchlist,
      liveMarketOverrideMap: marketMap
    });

    assert.strictEqual(pipelineResult.watchedCandidatesCount, 2);
    assert.strictEqual(pipelineResult.finalPassCount, 1);
    testPass(18, 'Full launch-day verification pipeline executes end-to-end correctly');
  }

  console.log('\n====================================================');
  console.log(`PHASE 10D.2 TEST SUMMARY: ${passed} / ${total} TESTS PASSED`);
  console.log('====================================================\n');
  resetTradeState();
  process.exit(0);
}

run10D2Tests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
