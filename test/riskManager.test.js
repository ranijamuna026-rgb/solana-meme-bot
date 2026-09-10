import assert from 'node:assert';
import {
  evaluateTradeRisk,
  calculatePositionSize,
  calculateRiskScore,
  resetRiskManagerState,
  recordTradeOutcome,
  registerActiveTrade,
  resetCircuitBreaker
} from '../src/riskManager.js';
import { config } from '../src/config.js';

console.log('====================================================');
console.log('      RUNNING RISK MANAGER AUTOMATED TESTS          ');
console.log('====================================================\n');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    resetRiskManagerState();
    fn();
    console.log(`[PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(`       Error: ${err.message}\n${err.stack}`);
  }
}

// Valid base token template for testing
function createValidCandidate(overrides = {}) {
  return {
    address: 'VALID_MINT_ADDRESS_123',
    symbol: 'VALID',
    name: 'Valid Token',
    priceUsd: 0.001,
    liquidityUsd: 25000,
    volume5mUsd: 10000,
    buys5m: 50,
    sells5m: 40,
    ageMinutes: 20,
    ...overrides
  };
}

// TEST A: Liquidity below minimum -> rejected
runTest('TEST A: Liquidity below minimum threshold', () => {
  const candidate = createValidCandidate({ liquidityUsd: 4000 }); // Minimum is 10,000
  const result = evaluateTradeRisk(candidate, { totalScore: 85 });
  assert.strictEqual(result.approved, false);
  assert.strictEqual(result.checks.liquidity, false);
  assert.ok(result.reasons.some(r => r.includes('Liquidity below minimum')));
});

// TEST B: Liquidity above minimum -> passes liquidity check
runTest('TEST B: Liquidity above minimum threshold', () => {
  const candidate = createValidCandidate({ liquidityUsd: 15000 });
  const result = evaluateTradeRisk(candidate, { totalScore: 85 });
  assert.strictEqual(result.checks.liquidity, true);
});

// TEST C: Volume below minimum -> rejected
runTest('TEST C: 5m Volume below minimum threshold', () => {
  const candidate = createValidCandidate({ volume5mUsd: 1200 }); // Minimum is 5,000
  const result = evaluateTradeRisk(candidate, { totalScore: 85 });
  assert.strictEqual(result.approved, false);
  assert.strictEqual(result.checks.volume, false);
  assert.ok(result.reasons.some(r => r.includes('5m Volume below minimum')));
});

// TEST D: Strategy score below minimum -> rejected
runTest('TEST D: Strategy score below minimum threshold', () => {
  const candidate = createValidCandidate();
  const result = evaluateTradeRisk(candidate, { totalScore: 62 }); // Minimum is 70
  assert.strictEqual(result.approved, false);
  assert.strictEqual(result.checks.strategyScore, false);
  assert.ok(result.reasons.some(r => r.includes('Strategy score below minimum')));
});

// TEST E: Invalid price -> rejected safely
runTest('TEST E: Invalid price input rejected safely', () => {
  const candidate1 = createValidCandidate({ priceUsd: -0.01 });
  const result1 = evaluateTradeRisk(candidate1, { totalScore: 85 });
  assert.strictEqual(result1.approved, false);

  const candidate2 = createValidCandidate({ priceUsd: NaN });
  const result2 = evaluateTradeRisk(candidate2, { totalScore: 85 });
  assert.strictEqual(result2.approved, false);
});

// TEST F: Duplicate active token -> rejected
runTest('TEST F: Duplicate active token address rejected', () => {
  const candidate = createValidCandidate({ address: 'ACTIVE_TOKEN_MINT_999' });
  registerActiveTrade('ACTIVE_TOKEN_MINT_999');

  const result = evaluateTradeRisk(candidate, { totalScore: 85 });
  assert.strictEqual(result.approved, false);
  assert.strictEqual(result.checks.duplicateTrade, false);
  assert.ok(result.reasons.some(r => r.includes('Duplicate trade blocked')));
});

// TEST G: Loss cooldown active -> rejected
runTest('TEST G: Loss cooldown active blocks new trades', () => {
  const nowMs = Date.now();
  recordTradeOutcome({ tokenAddress: 'LOST_TOKEN', pnl: -0.5, exitTime: new Date(nowMs).toISOString() });

  const candidate = createValidCandidate();
  const result = evaluateTradeRisk(candidate, { totalScore: 85 }, nowMs + 1000); // 1 sec after loss
  assert.strictEqual(result.approved, false);
  assert.strictEqual(result.checks.cooldown, false);
  assert.ok(result.reasons.some(r => r.includes('Loss cooldown active')));
});

// TEST H: Hourly trade limit reached -> rejected
runTest('TEST H: Maximum hourly trade limit reached', () => {
  const nowMs = Date.now();
  // Register 10 trades within the last hour
  for (let i = 0; i < 10; i++) {
    registerActiveTrade(`MINT_${i}`, nowMs - (i * 60 * 1000));
  }

  const candidate = createValidCandidate({ address: 'NEW_MINT_101' });
  const result = evaluateTradeRisk(candidate, { totalScore: 85 }, nowMs);
  assert.strictEqual(result.approved, false);
  assert.strictEqual(result.checks.tradeLimit, false);
  assert.ok(result.reasons.some(r => r.includes('Maximum hourly trade limit reached')));
});

// TEST I: Daily trade limit reached -> rejected
runTest('TEST I: Maximum daily trade limit reached', () => {
  const nowMs = Date.now();
  // Register 30 trades within 24h
  for (let i = 0; i < 30; i++) {
    registerActiveTrade(`DAY_MINT_${i}`, nowMs - (i * 10 * 60 * 1000));
  }

  const candidate = createValidCandidate({ address: 'NEW_DAY_MINT' });
  const result = evaluateTradeRisk(candidate, { totalScore: 85 }, nowMs);
  assert.strictEqual(result.approved, false);
  assert.strictEqual(result.checks.tradeLimit, false);
  assert.ok(result.reasons.some(r => r.includes('Maximum daily trade limit reached')));
});

// TEST J: Daily max loss reached -> rejected
runTest('TEST J: Daily maximum loss limit reached', () => {
  const nowMs = Date.now();
  // Record -$20.50 loss
  recordTradeOutcome({ tokenAddress: 'T1', pnl: -20.50, exitTime: new Date(nowMs).toISOString() });

  const candidate = createValidCandidate();
  const result = evaluateTradeRisk(candidate, { totalScore: 85 }, nowMs + (10 * 60 * 1000)); // after cooldown
  assert.strictEqual(result.approved, false);
  assert.strictEqual(result.checks.dailyLossLimit, false);
  assert.ok(result.reasons.some(r => r.includes('Daily maximum loss limit reached')));
});

// TEST K: Consecutive loss circuit breaker -> rejected
runTest('TEST K: Consecutive loss circuit breaker activation', () => {
  const nowMs = Date.now();
  // Record 3 consecutive losses
  recordTradeOutcome({ tokenAddress: 'T1', pnl: -1.0, exitTime: new Date(nowMs).toISOString() });
  recordTradeOutcome({ tokenAddress: 'T2', pnl: -1.0, exitTime: new Date(nowMs).toISOString() });
  recordTradeOutcome({ tokenAddress: 'T3', pnl: -1.0, exitTime: new Date(nowMs).toISOString() });

  const candidate = createValidCandidate();
  const result = evaluateTradeRisk(candidate, { totalScore: 85 }, nowMs + (10 * 60 * 1000));
  assert.strictEqual(result.approved, false);
  assert.strictEqual(result.checks.circuitBreaker, false);
  assert.ok(result.reasons.some(r => r.includes('Circuit breaker active')));
});

// TEST L: Position sizing respects maximum
runTest('TEST L: Position sizing respects configured maximum', () => {
  const candidate = createValidCandidate({ liquidityUsd: 1000000 });
  const size = calculatePositionSize(candidate, 10000); // 1% of $10,000 = $100
  assert.strictEqual(size, config.maxPositionSizeUsd, `Position size must not exceed max ($${config.maxPositionSizeUsd})`);
});

// TEST M: Position sizing respects minimum
runTest('TEST M: Position sizing respects configured minimum', () => {
  const candidate = createValidCandidate({ liquidityUsd: 15000 });
  const size = calculatePositionSize(candidate, 100); // 1% of $100 = $1
  assert.strictEqual(size, config.minPositionSizeUsd, `Position size must be at least min ($${config.minPositionSizeUsd})`);
});

// TEST N: Liquidity-based position cap
runTest('TEST N: Liquidity-based position cap enforcement', () => {
  const candidate = createValidCandidate({ liquidityUsd: 600 }); // 1% of 600 = $6
  const size = calculatePositionSize(candidate, 1000); // 1% of $1000 = $10
  assert.strictEqual(size, 6, 'Position size should be capped at 1% of token liquidity ($6)');
});

// TEST O: Approved high-quality candidate
runTest('TEST O: Approved high-quality candidate approval', () => {
  const candidate = createValidCandidate({
    liquidityUsd: 50000,
    volume5mUsd: 25000
  });
  const result = evaluateTradeRisk(candidate, { totalScore: 88 });
  assert.strictEqual(result.approved, true);
  assert.strictEqual(result.reasons.length, 0);
  assert.ok(result.positionSize >= config.minPositionSizeUsd);
  assert.ok(result.positionSize <= config.maxPositionSizeUsd);
});

// TEST P: NaN / Infinity inputs do not crash
runTest('TEST P: NaN and Infinity inputs handled safely without crashing', () => {
  const badCandidate = {
    address: 'BAD_MINT',
    priceUsd: Infinity,
    liquidityUsd: NaN,
    volume5mUsd: -Infinity
  };
  const result = evaluateTradeRisk(badCandidate, { totalScore: NaN });
  assert.strictEqual(result.approved, false);
  assert.ok(Array.isArray(result.reasons));
  const size = calculatePositionSize(badCandidate, NaN);
  assert.ok(!isNaN(size) && isFinite(size));
});

console.log('\n====================================================');
console.log(` TEST SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
console.log('====================================================\n');

if (passedTests !== totalTests) {
  process.exit(1);
}
