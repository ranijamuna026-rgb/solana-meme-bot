// ============================================================================
// RISK / SAFETY FILTER MODULE (src/riskFilter.js)
// Purpose: Evaluates market data for newly detected Solana tokens to reject risky tokens
// ============================================================================

import { config } from './config.js';

/**
 * Evaluates a newly detected token against configurable safety and activity rules.
 * 
 * DISCLAIMER:
 * Passing these checks does NOT guarantee that a token is safe, rug-proof, or profitable.
 * It merely filters out tokens with low liquidity, zero sell activity, or missing data.
 * 
 * @param {Object} token - Token market data collected by monitor.js
 * @returns {{ isCandidate: boolean, result: 'PASS' | 'REJECT', reason?: string, checks: Object }}
 */
export function evaluateTokenRisk(token) {
  const checks = {
    liquidity: 'FAIL',
    activity: 'FAIL',
    buySell: 'FAIL',
    data: 'FAIL'
  };

  const failureReasons = [];

  // 1. DATA COMPLETENESS CHECK
  // Verify token has essential market fields (valid address, non-null price, and valid priceUsd)
  if (!token || !token.address || token.priceUsd === null || isNaN(token.priceUsd)) {
    failureReasons.push('Missing or invalid price/market data');
  } else {
    checks.data = 'PASS';
  }

  // 2. MINIMUM LIQUIDITY CHECK
  const liquidityUsd = token.liquidityUsd ?? 0;
  if (liquidityUsd < config.minLiquidityUsd) {
    failureReasons.push(`Liquidity below minimum ($${liquidityUsd.toLocaleString()} < $${config.minLiquidityUsd.toLocaleString()})`);
  } else {
    checks.liquidity = 'PASS';
  }

  // 3. MINIMUM 5-MINUTE VOLUME CHECK
  const volume5mUsd = token.volume5mUsd ?? 0;
  if (volume5mUsd < config.min5mVolumeUsd) {
    failureReasons.push(`5m Volume below minimum ($${volume5mUsd.toLocaleString()} < $${config.min5mVolumeUsd.toLocaleString()})`);
  } else {
    checks.activity = 'PASS';
  }

  // 4. BUY AND SELL TRANSACTIONS CHECK (Crucial: Sells must be > 0 to filter out zero-sell honeypots)
  const buys5m = token.buys5m ?? 0;
  const sells5m = token.sells5m ?? 0;

  if (buys5m < config.min5mBuys) {
    failureReasons.push(`Insufficient 5m buy count (${buys5m} < ${config.min5mBuys})`);
  }

  if (sells5m < config.min5mSells) {
    failureReasons.push(`Insufficient 5m sell count / honeypot risk (${sells5m} < ${config.min5mSells})`);
  } else {
    checks.buySell = 'PASS';
  }

  // 5. TOKEN AGE CHECK (If launch time is available)
  if (token.ageMinutes !== null && token.ageMinutes > config.maxTokenAgeMinutes) {
    failureReasons.push(`Token age exceeds maximum allowed (${token.ageMinutes} min > ${config.maxTokenAgeMinutes} min)`);
  }

  // 6. SUSPICIOUS CONDITION CHECK
  // If buys exist but sells are 0, or if liquidity is exactly 0, flag as suspicious
  if (buys5m > 10 && sells5m === 0) {
    failureReasons.push('Suspicious honeypot pattern (High buys but 0 sells)');
    checks.buySell = 'FAIL';
  }

  // Determine final status
  const isCandidate = failureReasons.length === 0;
  const resultStatus = isCandidate ? 'PASS' : 'REJECT';
  const primaryReason = isCandidate ? undefined : failureReasons[0];

  // Print risk analysis terminal output
  logRiskAnalysis(token, checks, resultStatus, primaryReason);

  return {
    isCandidate,
    result: resultStatus,
    reason: primaryReason,
    checks
  };
}

/**
 * Logs a clean risk analysis summary table to the terminal.
 * 
 * @param {Object} token - Token data object
 * @param {Object} checks - Object containing PASS/FAIL for each sub-check
 * @param {string} resultStatus - 'PASS' or 'REJECT'
 * @param {string} [reason] - Primary failure reason if rejected
 */
function logRiskAnalysis(token, checks, resultStatus, reason) {
  const ageDisplay = token.ageMinutes !== null ? `${token.ageMinutes} min` : 'N/A';

  console.log('\n========================================');
  console.log('RISK ANALYSIS');
  console.log('========================================');
  console.log(`Token      : ${token.symbol} (${token.name})`);
  console.log(`Liquidity  : ${token.liquidity}`);
  console.log(`5m Volume  : ${token.volume5m}`);
  console.log(`5m Buys    : ${token.buys5m ?? 'N/A'}`);
  console.log(`5m Sells   : ${token.sells5m ?? 'N/A'}`);
  console.log(`Age        : ${ageDisplay}`);
  console.log('');
  console.log(`Liquidity  : ${checks.liquidity}`);
  console.log(`Activity   : ${checks.activity}`);
  console.log(`Buy/Sell   : ${checks.buySell}`);
  console.log(`Data       : ${checks.data}`);
  console.log('');

  if (resultStatus === 'PASS') {
    console.log('FINAL RESULT: PASS - CANDIDATE');
  } else {
    console.log('FINAL RESULT: REJECT');
    console.log(`Reason: ${reason || 'Failed safety conditions'}`);
  }
  console.log('========================================');
}
