// ============================================================================
// TRADING STRATEGY MODULE (src/strategy.js)
// Purpose: Scores PASS tokens from Phase 3 and selects the best candidate
// ============================================================================

import { config } from './config.js';

// Holds the current highest-scoring candidate token evaluated during the session
let currentBestCandidate = null;

/**
 * Evaluates a trading score (0-100) for a token that PASSED Phase 3 risk filters.
 * 
 * DISCLAIMER:
 * A high strategy score does NOT predict profit or guarantee trading success.
 * It is a simple heuristic score ranking liquidity, volume, transaction density,
 * buy/sell balance, and token age to pick a candidate for paper trading simulation.
 * 
 * @param {Object} token - Token market data object from Phase 2
 * @param {Object} riskResult - Risk evaluation result object from Phase 3
 * @returns {Object|null} Strategy evaluation object or null if token was REJECTED
 */
export function evaluateStrategy(token, riskResult) {
  // Rule: Only tokens that PASS Phase 3 can receive a strategy score
  if (!riskResult || !riskResult.isCandidate || riskResult.result !== 'PASS') {
    return null;
  }

  // 1. LIQUIDITY SCORE (Max 20 Points)
  // Higher pool liquidity reduces price slippage risk
  const liquidityUsd = token.liquidityUsd ?? 0;
  let liquidityScore = 4;
  if (liquidityUsd >= 20000) liquidityScore = 20;
  else if (liquidityUsd >= 10000) liquidityScore = 16;
  else if (liquidityUsd >= 5000) liquidityScore = 12;
  else if (liquidityUsd >= 2500) liquidityScore = 8;
  else if (liquidityUsd >= 1000) liquidityScore = 4;

  // 2. 5-MINUTE VOLUME SCORE (Max 25 Points)
  // Higher recent trading volume indicates strong market interest
  const volume5mUsd = token.volume5mUsd ?? 0;
  let volumeScore = 5;
  if (volume5mUsd >= 20000) volumeScore = 25;
  else if (volume5mUsd >= 10000) volumeScore = 20;
  else if (volume5mUsd >= 5000) volumeScore = 15;
  else if (volume5mUsd >= 2500) volumeScore = 10;
  else if (volume5mUsd >= 500) volumeScore = 5;

  // 3. ACTIVITY DENSITY SCORE (Max 20 Points)
  // Rewards tokens with active transaction frequency (buys + sells)
  const buys5m = token.buys5m ?? 0;
  const sells5m = token.sells5m ?? 0;
  const totalTxns = buys5m + sells5m;
  let activityScore = 5;
  if (totalTxns >= 100) activityScore = 20;
  else if (totalTxns >= 50) activityScore = 15;
  else if (totalTxns >= 25) activityScore = 10;
  else if (totalTxns >= 10) activityScore = 5;

  // 4. BUY/SELL BALANCE SCORE (Max 20 Points)
  // Healthy markets have balanced buy & sell activity (ratio ~0.8 to 2.5)
  const buySellRatio = sells5m > 0 ? buys5m / sells5m : 0;
  let balanceScore = 5;
  if (buySellRatio >= 0.8 && buySellRatio <= 2.5) {
    balanceScore = 20; // Ideal healthy balance
  } else if (buySellRatio > 2.5 && buySellRatio <= 5.0) {
    balanceScore = 14; // High buy momentum
  } else if (buySellRatio >= 0.4 && buySellRatio < 0.8) {
    balanceScore = 12; // Moderate sell pressure
  } else {
    balanceScore = 5; // Unbalanced ratio
  }

  // 5. TOKEN AGE SCORE (Max 15 Points)
  // Rewards fresh/newer tokens (under 30-60 mins)
  const ageMinutes = token.ageMinutes ?? 999;
  let ageScore = 5;
  if (ageMinutes <= 30) ageScore = 15;
  else if (ageMinutes <= 60) ageScore = 12;
  else if (ageMinutes <= 120) ageScore = 8;
  else if (ageMinutes <= 180) ageScore = 5;

  // Calculate Total Score (0 - 100)
  const totalScore = liquidityScore + volumeScore + activityScore + balanceScore + ageScore;
  const isCandidate = totalScore >= config.strategyMinScore;
  const status = isCandidate ? 'CANDIDATE' : 'REJECTED (LOW SCORE)';

  const result = {
    token,
    totalScore,
    maxScore: 100,
    scores: {
      liquidityScore,
      volumeScore,
      activityScore,
      balanceScore,
      ageScore
    },
    status
  };

  // Log detailed strategy breakdown
  logStrategyReport(token, result);

  // Compare and track Best Candidate
  if (isCandidate) {
    updateBestCandidate(token, totalScore);
  }

  return result;
}

/**
 * Logs the strategy breakdown score table.
 * 
 * @param {Object} token - Token object
 * @param {Object} res - Strategy evaluation result
 */
function logStrategyReport(token, res) {
  const ageDisplay = token.ageMinutes !== null ? `${token.ageMinutes} min` : 'N/A';

  console.log('\n========================================');
  console.log('TRADING STRATEGY');
  console.log('========================================');
  console.log(`Token      : ${token.symbol} (${token.name})`);
  console.log(`Liquidity  : ${token.liquidity}`);
  console.log(`5m Volume  : ${token.volume5m}`);
  console.log(`5m Buys    : ${token.buys5m ?? 'N/A'}`);
  console.log(`5m Sells   : ${token.sells5m ?? 'N/A'}`);
  console.log(`Age        : ${ageDisplay}`);
  console.log('');
  console.log('Risk       : PASS');
  console.log(`Liquidity Score : ${res.scores.liquidityScore}/20`);
  console.log(`Volume Score    : ${res.scores.volumeScore}/25`);
  console.log(`Activity Score  : ${res.scores.activityScore}/20`);
  console.log(`Balance Score   : ${res.scores.balanceScore}/20`);
  console.log(`Age Score       : ${res.scores.ageScore}/15`);
  console.log('');
  console.log(`TOTAL SCORE: ${res.totalScore}/100`);
  console.log(`STATUS: ${res.status}`);
  console.log('========================================');
}

/**
 * Updates and logs the highest scoring candidate evaluated so far.
 * 
 * @param {Object} token - Candidate token object
 * @param {number} score - Total strategy score
 */
function updateBestCandidate(token, score) {
  if (!currentBestCandidate || score > currentBestCandidate.score) {
    currentBestCandidate = {
      token,
      score,
      reason: 'Highest strategy score among current PASS tokens'
    };

    console.log('\n========================================');
    console.log('BEST CANDIDATE SELECTED');
    console.log('========================================');
    console.log(`Token  : ${token.symbol} (${token.name})`);
    console.log(`Address: ${token.address}`);
    console.log(`Score  : ${score}/100`);
    console.log(`Reason : ${currentBestCandidate.reason}`);
    console.log('========================================');
  }
}

/**
 * Helper to retrieve the current best candidate.
 * 
 * @returns {Object|null} Best candidate object
 */
export function getBestCandidate() {
  return currentBestCandidate;
}
