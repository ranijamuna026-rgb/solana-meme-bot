// ============================================================================
// ADVANCED RISK MANAGEMENT MODULE (src/riskManager.js)
// Purpose: Evaluates candidate trades against risk limits, position caps, and circuit breakers
// ============================================================================

import { config } from './config.js';

// Structured Portfolio / Session State
let portfolioState = createInitialPortfolioState();

/**
 * Initializes clean portfolio session state.
 */
function createInitialPortfolioState() {
  return {
    initialCapital: config.backtestInitialCapital || 1000,
    currentEquity: config.backtestInitialCapital || 1000,
    dailyPnlUsd: 0,
    totalPnlUsd: 0,
    consecutiveLosses: 0,
    lastLosingTradeTimeMs: 0,
    circuitBreakerActive: false,
    circuitBreakerActivatedTimeMs: 0,
    recentTradeTimes: [], // Timestamps of all executed trades
    recentTradedTokens: new Map(), // Address -> lastTradeTimeMs
    activeTokenAddresses: new Set() // Set of active candidate Addresses
  };
}

/**
 * Returns current portfolio session state.
 */
export function getPortfolioState() {
  return { ...portfolioState };
}

/**
 * Resets risk manager session state (used in testing and session resets).
 */
export function resetRiskManagerState() {
  portfolioState = createInitialPortfolioState();
}

/**
 * Resets circuit breaker state safely.
 */
export function resetCircuitBreaker() {
  portfolioState.circuitBreakerActive = false;
  portfolioState.consecutiveLosses = 0;
  portfolioState.circuitBreakerActivatedTimeMs = 0;
  console.log('[RISK] Circuit breaker reset. Trading can resume.');
}

/**
 * Registers an active paper trade open event.
 * @param {string} tokenAddress 
 * @param {number} [timeMs] 
 */
export function registerActiveTrade(tokenAddress, timeMs = Date.now()) {
  if (tokenAddress) {
    portfolioState.activeTokenAddresses.add(tokenAddress);
    portfolioState.recentTradedTokens.set(tokenAddress, timeMs);
  }
  portfolioState.recentTradeTimes.push(timeMs);
}

/**
 * Records trade exit outcome to update P&L, consecutive losses, and cooldown state.
 * 
 * @param {Object} tradeResult - Trade completion object from paperTrader / backtester
 */
export function recordTradeOutcome(tradeResult) {
  if (!tradeResult) return;

  const tokenAddress = tradeResult.tokenAddress || tradeResult.address;
  if (tokenAddress) {
    portfolioState.activeTokenAddresses.delete(tokenAddress);
  }

  const pnl = Number(tradeResult.pnl || 0);
  const exitTimeMs = tradeResult.exitTime ? new Date(tradeResult.exitTime).getTime() : Date.now();

  portfolioState.dailyPnlUsd = Number((portfolioState.dailyPnlUsd + pnl).toFixed(2));
  portfolioState.totalPnlUsd = Number((portfolioState.totalPnlUsd + pnl).toFixed(2));
  portfolioState.currentEquity = Number((portfolioState.currentEquity + pnl).toFixed(2));

  if (pnl < 0) {
    portfolioState.consecutiveLosses++;
    portfolioState.lastLosingTradeTimeMs = exitTimeMs;

    // Requirement 13: Circuit Breaker Trigger
    if (portfolioState.consecutiveLosses >= config.maxConsecutiveLosses) {
      portfolioState.circuitBreakerActive = true;
      portfolioState.circuitBreakerActivatedTimeMs = exitTimeMs;
      console.log('\n========================================');
      console.log('[RISK] CIRCUIT BREAKER ACTIVATED');
      console.log('========================================');
      console.log(`Consecutive Losses : ${portfolioState.consecutiveLosses}`);
      console.log(`Current Daily P&L  : -$${Math.abs(portfolioState.dailyPnlUsd).toFixed(2)}`);
      console.log(`Time Activated     : ${new Date(exitTimeMs).toISOString()}`);
      console.log('========================================\n');
    }
  } else if (pnl > 0) {
    // Reset consecutive losses counter on win
    portfolioState.consecutiveLosses = 0;
  }
}

/**
 * Calculates controlled position size bounded by risk budget, liquidity cap, and config limits.
 * 
 * @param {Object} candidate - Candidate token market object
 * @param {number} equity - Current account portfolio balance
 * @returns {number} Calculated position size in USD
 */
export function calculatePositionSize(candidate, equity = portfolioState.currentEquity) {
  const safeEquity = (typeof equity === 'number' && !isNaN(equity) && isFinite(equity) && equity > 0)
    ? equity
    : (config.backtestInitialCapital || 1000);

  // 1. Capital Risk Budget
  const capitalRiskBudget = safeEquity * (config.riskPerTradePercent / 100);

  // 2. Requirement 15: Liquidity-Aware Position Cap
  const liquidityUsd = (candidate && typeof candidate.liquidityUsd === 'number' && !isNaN(candidate.liquidityUsd) && candidate.liquidityUsd > 0)
    ? candidate.liquidityUsd
    : 0;

  const liquidityCap = liquidityUsd > 0
    ? liquidityUsd * (config.maxPositionLiquidityPercent / 100)
    : 0;

  if (liquidityCap > 0 && liquidityCap < config.minPositionSizeUsd) {
    return 0;
  }

  const effectiveCap = liquidityCap > 0 ? liquidityCap : config.minPositionSizeUsd;

  // 3. Base Position Size
  const baseSize = Math.min(capitalRiskBudget, effectiveCap);

  // 4. Bound position size between MIN_POSITION_SIZE_USD and MAX_POSITION_SIZE_USD
  let finalSize = Math.min(config.maxPositionSizeUsd, Math.max(config.minPositionSizeUsd, baseSize));

  if (isNaN(finalSize) || !isFinite(finalSize) || finalSize <= 0) {
    finalSize = config.minPositionSizeUsd;
  }

  return Number(finalSize.toFixed(2));
}

/**
 * Calculates quantitative risk score (0-100) and qualitative risk rating.
 * 
 * Formula (Higher = HIGHER RISK):
 * - Liquidity Score (Max 25 pts)
 * - Volume Score (Max 20 pts)
 * - Strategy Score (Max 25 pts)
 * - Buy/Sell Balance (Max 15 pts)
 * - Token Age (Max 15 pts)
 * 
 * @param {Object} candidate - Candidate token data
 * @param {number} strategyScore - Strategy score (0-100)
 * @returns {{ score: number, rating: 'LOW RISK' | 'MEDIUM RISK' | 'HIGH RISK' | 'EXTREME RISK' }}
 */
export function calculateRiskScore(candidate, strategyScore = 70) {
  let riskPts = 0;

  // 1. Liquidity Risk (Max 25 pts)
  const liq = candidate?.liquidityUsd ?? 0;
  if (liq >= 50000) riskPts += 0;
  else if (liq >= 25000) riskPts += 5;
  else if (liq >= 15000) riskPts += 10;
  else if (liq >= 10000) riskPts += 15;
  else riskPts += 25;

  // 2. Volume Risk (Max 20 pts)
  const vol = candidate?.volume5mUsd ?? 0;
  if (vol >= 25000) riskPts += 0;
  else if (vol >= 10000) riskPts += 5;
  else if (vol >= 5000) riskPts += 10;
  else riskPts += 20;

  // 3. Strategy Score Risk (Max 25 pts)
  const score = typeof strategyScore === 'number' && !isNaN(strategyScore) ? strategyScore : 70;
  if (score >= 90) riskPts += 0;
  else if (score >= 80) riskPts += 5;
  else if (score >= 70) riskPts += 10;
  else riskPts += 25;

  // 4. Buy/Sell Imbalance Risk (Max 15 pts)
  const buys = candidate?.buys5m ?? 0;
  const sells = candidate?.sells5m ?? 0;
  const ratio = sells > 0 ? buys / sells : 0;
  if (ratio >= 0.8 && ratio <= 2.5) riskPts += 0;
  else if (ratio > 2.5 && ratio <= 5.0) riskPts += 8;
  else riskPts += 15;

  // 5. Token Age Risk (Max 15 pts)
  const age = candidate?.ageMinutes ?? 999;
  if (age <= 30) riskPts += 0;
  else if (age <= 60) riskPts += 5;
  else if (age <= 120) riskPts += 10;
  else riskPts += 15;

  const finalScore = Math.min(100, Math.max(0, riskPts));

  let rating = 'LOW RISK';
  if (finalScore > 80) rating = 'EXTREME RISK';
  else if (finalScore > 60) rating = 'HIGH RISK';
  else if (finalScore > 30) rating = 'MEDIUM RISK';

  return { score: finalScore, rating };
}

/**
 * Evaluates a candidate token against Phase 8 Advanced Risk Management rules.
 * 
 * @param {Object} candidate - Candidate token object
 * @param {Object} [strategyResult] - Strategy evaluation result object
 * @param {number} [customNowMs] - Custom timestamp for backtest / testing
 * @returns {Object} Structured decision object
 */
export function evaluateTradeRisk(candidate, strategyResult = null, customNowMs = null) {
  const nowMs = customNowMs !== null ? customNowMs : Date.now();
  const reasons = [];

  const checks = {
    liquidity: false,
    volume: false,
    strategyScore: false,
    tokenAge: false,
    duplicateTrade: false,
    cooldown: false,
    dailyLossLimit: false,
    tradeLimit: false,
    circuitBreaker: false
  };

  // Requirement 7: Token Quality & Address Validation
  if (!candidate || typeof candidate !== 'object') {
    return {
      approved: false,
      reasons: ['Invalid or empty candidate token object'],
      riskScore: 100,
      riskRating: 'EXTREME RISK',
      positionSize: 0,
      checks
    };
  }

  const tokenAddress = candidate.address || candidate.tokenAddress;
  if (!tokenAddress || typeof tokenAddress !== 'string' || tokenAddress.trim() === '') {
    reasons.push('Missing or invalid token address');
  }

  const priceUsd = candidate.priceUsd;
  if (priceUsd === undefined || priceUsd === null || typeof priceUsd !== 'number' || isNaN(priceUsd) || !isFinite(priceUsd) || priceUsd <= 0) {
    reasons.push('Invalid price (price must be a positive number)');
  }

  // Requirement 4: Minimum Liquidity Check ($10,000)
  const liquidityUsd = candidate.liquidityUsd ?? 0;
  if (typeof liquidityUsd !== 'number' || isNaN(liquidityUsd) || liquidityUsd < config.minLiquidityUsd) {
    reasons.push(`Liquidity below minimum threshold ($${liquidityUsd.toLocaleString()} < $${config.minLiquidityUsd.toLocaleString()})`);
  } else {
    checks.liquidity = true;
  }

  // Requirement 5: Minimum 5-Minute Volume Check ($5,000)
  const volume5mUsd = candidate.volume5mUsd ?? 0;
  if (typeof volume5mUsd !== 'number' || isNaN(volume5mUsd) || volume5mUsd < config.min5mVolumeUsd) {
    reasons.push(`5m Volume below minimum threshold ($${volume5mUsd.toLocaleString()} < $${config.min5mVolumeUsd.toLocaleString()})`);
  } else {
    checks.volume = true;
  }

  // Requirement 6: Minimum Strategy Score Check (70)
  const strategyScore = strategyResult && typeof strategyResult.totalScore === 'number'
    ? strategyResult.totalScore
    : (candidate.score ?? candidate.strategyScore ?? 70);

  if (isNaN(strategyScore) || strategyScore < config.minStrategyScore) {
    reasons.push(`Strategy score below minimum threshold (${strategyScore} < ${config.minStrategyScore})`);
  } else {
    checks.strategyScore = true;
  }

  // Token Age Check
  if (candidate.ageMinutes !== null && candidate.ageMinutes > config.maxTokenAgeMinutes) {
    reasons.push(`Token age exceeds maximum allowed (${candidate.ageMinutes} min > ${config.maxTokenAgeMinutes} min)`);
  } else {
    checks.tokenAge = true;
  }

  // Requirement 8: Duplicate Token Protection
  if (tokenAddress && portfolioState.activeTokenAddresses.has(tokenAddress)) {
    reasons.push('Duplicate trade blocked: Token is currently active in another position');
  } else {
    checks.duplicateTrade = true;
  }

  // Requirement 9: Loss Cooldown Check (5 minutes)
  const cooldownMs = config.cooldownAfterLossMinutes * 60 * 1000;
  if (portfolioState.lastLosingTradeTimeMs > 0) {
    const elapsedSinceLoss = nowMs - portfolioState.lastLosingTradeTimeMs;
    if (elapsedSinceLoss < cooldownMs) {
      const remainingSec = Math.ceil((cooldownMs - elapsedSinceLoss) / 1000);
      const min = Math.floor(remainingSec / 60);
      const sec = remainingSec % 60;
      reasons.push(`Loss cooldown active (${String(min).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s remaining)`);
    } else {
      checks.cooldown = true;
    }
  } else {
    checks.cooldown = true;
  }

  // Requirement 10 & 11: Trade Limits (Hourly & Daily)
  const oneHourAgoMs = nowMs - (60 * 60 * 1000);
  const tradesLastHour = portfolioState.recentTradeTimes.filter(t => t >= oneHourAgoMs).length;

  const oneDayAgoMs = nowMs - (24 * 60 * 60 * 1000);
  const tradesLastDay = portfolioState.recentTradeTimes.filter(t => t >= oneDayAgoMs).length;

  if (tradesLastHour >= config.maxTradesPerHour) {
    reasons.push(`Maximum hourly trade limit reached (${tradesLastHour} >= ${config.maxTradesPerHour})`);
  }
  if (tradesLastDay >= config.maxTradesPerDay) {
    reasons.push(`Maximum daily trade limit reached (${tradesLastDay} >= ${config.maxTradesPerDay})`);
  }
  if (tradesLastHour < config.maxTradesPerHour && tradesLastDay < config.maxTradesPerDay) {
    checks.tradeLimit = true;
  }

  // Requirement 12: Daily Max Loss Limit (-$20)
  if (portfolioState.dailyPnlUsd <= -config.maxDailyLossUsd) {
    reasons.push(`Daily maximum loss limit reached (-$${Math.abs(portfolioState.dailyPnlUsd).toFixed(2)} <= -$${config.maxDailyLossUsd.toFixed(2)})`);
  } else {
    checks.dailyLossLimit = true;
  }

  // Requirement 13: Circuit Breaker Check
  if (portfolioState.circuitBreakerActive) {
    reasons.push(`Circuit breaker active (${portfolioState.consecutiveLosses} consecutive losses)`);
  } else {
    checks.circuitBreaker = true;
  }

  // Requirement 16: Quantitative Risk Score & Max Risk Score Threshold
  const riskAnalysis = calculateRiskScore(candidate, strategyScore);
  if (riskAnalysis.score > config.maxRiskScore) {
    reasons.push(`Risk score exceeds maximum threshold (${riskAnalysis.score} > ${config.maxRiskScore})`);
  }

  // Final Decision
  const approved = reasons.length === 0;
  const positionSize = approved ? calculatePositionSize(candidate) : 0;

  // Requirement 17: Decision Logging
  logRiskDecision(candidate, strategyScore, riskAnalysis, positionSize, approved, reasons);

  return {
    approved,
    reasons,
    riskScore: riskAnalysis.score,
    riskRating: riskAnalysis.rating,
    positionSize,
    checks
  };
}

/**
 * Logs a concise risk evaluation summary table to terminal.
 */
function logRiskDecision(candidate, strategyScore, riskAnalysis, positionSize, approved, reasons) {
  const symbol = candidate?.symbol || 'UNKNOWN';
  const name = candidate?.name || 'Unknown';
  const liquidityStr = candidate?.liquidity || `$${(candidate?.liquidityUsd || 0).toLocaleString()}`;
  const volumeStr = candidate?.volume5m || `$${(candidate?.volume5mUsd || 0).toLocaleString()}`;

  console.log('\n========================================');
  console.log('RISK CHECK');
  console.log('========================================');
  console.log(`Token       : ${symbol} (${name})`);
  console.log(`Strategy    : ${strategyScore}`);
  console.log(`Liquidity   : ${liquidityStr}`);
  console.log(`Volume 5m   : ${volumeStr}`);

  if (approved) {
    console.log(`Risk Score  : ${riskAnalysis.score} (${riskAnalysis.rating})`);
    console.log(`Position    : $${positionSize.toFixed(2)}`);
    console.log(`Decision    : APPROVED`);
  } else {
    console.log(`Risk Score  : ${riskAnalysis.score} (${riskAnalysis.rating})`);
    console.log(`Decision    : REJECTED`);
    console.log(`Reason      : ${reasons.join(', ')}`);
  }
  console.log('========================================');
}
