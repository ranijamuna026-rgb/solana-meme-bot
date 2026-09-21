// ============================================================================
// TOMORROW LAUNCH PRE-FILTER ENGINE MODULE (src/preLaunchEngine.js)
// Purpose: Pre-launch candidate discovery, risk analysis, strategy scoring,
//          tomorrow watchlist persistence, and launch-day quick verification.
// Mode: REAL MARKET DATA + PAPER TRADING ONLY (Zero real trading, wallet, or Web3 signatures)
// ============================================================================

import fs from 'fs';
import path from 'path';
import { config } from './config.js';
import { evaluateTokenRisk } from './riskFilter.js';
import { evaluateStrategy } from './strategy.js';
import { evaluateTradeRisk } from './riskManager.js';
import { executePaperTrade } from './paperTrader.js';
import { discoverUpcomingSolanaTokens } from './upcomingDiscovery.js';

const WATCHLIST_FILE = path.resolve(process.cwd(), 'tomorrow_watchlist.json');
let tomorrowWatchlistCache = [];

/**
 * Filter Status Enums for Pre-Launch Candidates.
 */
export const PRE_LAUNCH_STATUS = Object.freeze({
  READY_FOR_LAUNCH: 'READY_FOR_LAUNCH',
  WATCH: 'WATCH',
  REJECTED: 'REJECTED',
  UNKNOWN: 'UNKNOWN'
});

/**
 * Standardizes a pre-launch candidate token object.
 * Enforces data honesty: missing or unverified fields are strictly set to 'UNKNOWN' or null.
 * 
 * @param {Object} raw 
 * @returns {Object} Standardized candidate object
 */
export function standardizePreLaunchCandidate(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const id = raw.id || `PRE-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const name = (raw.name || '').trim() || 'UNKNOWN';
  const symbol = (raw.symbol || '').trim() || 'UNKNOWN';
  const chain = (raw.chain || 'solana').toLowerCase();
  const contractAddress = raw.contractAddress || raw.address || 'UNKNOWN';
  
  const expectedLaunchDate = raw.expectedLaunchDate || 'UNKNOWN';
  const expectedLaunchTime = raw.expectedLaunchTime || 'UNKNOWN';
  const platform = raw.platform || 'UNKNOWN';
  const websiteUrl = raw.websiteUrl || 'UNKNOWN';
  const socialLinks = Array.isArray(raw.socialLinks) ? raw.socialLinks : [];
  const creatorInfo = raw.creatorInfo || 'UNKNOWN';
  const expectedLiquidityUsd = typeof raw.expectedLiquidityUsd === 'number' && !isNaN(raw.expectedLiquidityUsd) ? raw.expectedLiquidityUsd : null;
  const tokenomics = raw.tokenomics || 'UNKNOWN';
  
  // Data confidence calculation
  let knownFields = 0;
  if (name !== 'UNKNOWN') knownFields++;
  if (symbol !== 'UNKNOWN') knownFields++;
  if (contractAddress !== 'UNKNOWN') knownFields++;
  if (expectedLaunchDate !== 'UNKNOWN') knownFields++;
  if (expectedLaunchTime !== 'UNKNOWN') knownFields++;
  if (platform !== 'UNKNOWN') knownFields++;
  if (expectedLiquidityUsd !== null) knownFields++;
  if (socialLinks.length > 0) knownFields++;

  let dataConfidence = 'UNKNOWN';
  if (knownFields >= 6) dataConfidence = 'HIGH';
  else if (knownFields >= 4) dataConfidence = 'MEDIUM';
  else if (knownFields >= 2) dataConfidence = 'LOW';

  return {
    id,
    name,
    symbol,
    chain,
    contractAddress,
    expectedLaunchDate,
    expectedLaunchTime,
    platform,
    websiteUrl,
    socialLinks,
    creatorInfo,
    expectedLiquidityUsd,
    tokenomics,
    dataConfidence,
    discoveredAt: raw.discoveredAt || new Date().toISOString()
  };
}

/**
 * Pre-Launch Risk Analysis (0-100 score, higher = higher risk).
 * Evaluates available pre-launch data. Missing data is treated as UNKNOWN without assuming safety.
 * 
 * @param {Object} candidate 
 * @returns {{ preLaunchRiskScore: number, riskRating: string, riskFactors: Array<string>, unknownFactors: Array<string> }}
 */
export function evaluatePreLaunchRisk(candidate) {
  let riskPts = 0;
  const riskFactors = [];
  const unknownFactors = [];

  if (!candidate) {
    return { preLaunchRiskScore: 100, riskRating: 'EXTREME RISK', riskFactors: ['Invalid candidate object'], unknownFactors: [] };
  }

  // 1. Creator / Deployer History
  if (candidate.creatorInfo === 'UNKNOWN') {
    riskPts += 15;
    unknownFactors.push('Creator / deployer history unverified');
  } else if (candidate.creatorInfo.includes('suspicious') || candidate.creatorInfo.includes('rug')) {
    riskPts += 40;
    riskFactors.push('Creator history contains past rug/scam indicators');
  }

  // 2. Launch Date & Time Verification
  if (candidate.expectedLaunchDate === 'UNKNOWN') {
    riskPts += 20;
    unknownFactors.push('Launch date is UNKNOWN');
  }
  if (candidate.expectedLaunchTime === 'UNKNOWN') {
    riskPts += 10;
    unknownFactors.push('Launch time is UNKNOWN');
  }

  // 3. Contract Address Availability
  if (candidate.contractAddress === 'UNKNOWN') {
    riskPts += 15;
    unknownFactors.push('Contract address not yet published');
  }

  // 4. Expected Liquidity
  if (candidate.expectedLiquidityUsd === null) {
    riskPts += 15;
    unknownFactors.push('Expected initial liquidity amount UNKNOWN');
  } else if (candidate.expectedLiquidityUsd < config.minLiquidityUsd) {
    riskPts += 30;
    riskFactors.push(`Expected liquidity ($${candidate.expectedLiquidityUsd}) below minimum requirement ($${config.minLiquidityUsd})`);
  }

  // 5. Social & Community Presence
  if (candidate.socialLinks.length === 0) {
    riskPts += 15;
    unknownFactors.push('No verified social or community links');
  }

  const preLaunchRiskScore = Math.min(100, Math.max(0, riskPts));
  let riskRating = 'LOW RISK';
  if (preLaunchRiskScore > 80) riskRating = 'EXTREME RISK';
  else if (preLaunchRiskScore > 60) riskRating = 'HIGH RISK';
  else if (preLaunchRiskScore > 30) riskRating = 'MEDIUM RISK';

  return {
    preLaunchRiskScore,
    riskRating,
    riskFactors,
    unknownFactors
  };
}

/**
 * Pre-Launch Strategy Score (0-100 score).
 * Evaluates candidate across 8 categories and assigns final filter status.
 * 
 * @param {Object} candidate 
 * @param {Object} riskAnalysis 
 * @returns {Object} Evaluation summary
 */
export function evaluatePreLaunchStrategy(candidate, riskAnalysis) {
  if (!candidate || !riskAnalysis) {
    return { preLaunchStrategyScore: 0, status: PRE_LAUNCH_STATUS.REJECTED, reasons: ['Invalid inputs'] };
  }

  let strategyPts = 0;

  // 1. Risk Score Component (Max 25 pts)
  const rScore = riskAnalysis.preLaunchRiskScore;
  if (rScore <= 20) strategyPts += 25;
  else if (rScore <= 40) strategyPts += 20;
  else if (rScore <= 60) strategyPts += 15;
  else if (rScore <= 80) strategyPts += 5;

  // 2. Liquidity Readiness (Max 20 pts)
  const expLiq = candidate.expectedLiquidityUsd;
  if (expLiq !== null) {
    if (expLiq >= 25000) strategyPts += 20;
    else if (expLiq >= 15000) strategyPts += 15;
    else if (expLiq >= 10000) strategyPts += 10;
  } else {
    strategyPts += 5;
  }

  // 3. Launch Verification Confidence (Max 15 pts)
  if (candidate.expectedLaunchDate !== 'UNKNOWN' && candidate.expectedLaunchTime !== 'UNKNOWN') {
    strategyPts += 15;
  } else if (candidate.expectedLaunchDate !== 'UNKNOWN') {
    strategyPts += 10;
  }

  // 4. Community / Attention (Max 10 pts)
  if (candidate.socialLinks.length >= 3) strategyPts += 10;
  else if (candidate.socialLinks.length >= 1) strategyPts += 5;

  // 5. Data Quality (Max 15 pts)
  if (candidate.dataConfidence === 'HIGH') strategyPts += 15;
  else if (candidate.dataConfidence === 'MEDIUM') strategyPts += 10;
  else if (candidate.dataConfidence === 'LOW') strategyPts += 5;

  // 6. Platform Quality (Max 15 pts)
  if (candidate.platform !== 'UNKNOWN') strategyPts += 15;
  else strategyPts += 5;

  const preLaunchStrategyScore = Math.min(100, Math.max(0, strategyPts));

  // Determine Filter Status
  let status = PRE_LAUNCH_STATUS.UNKNOWN;

  if (candidate.dataConfidence === 'UNKNOWN' || candidate.expectedLaunchDate === 'UNKNOWN') {
    status = PRE_LAUNCH_STATUS.UNKNOWN;
  } else if (riskAnalysis.preLaunchRiskScore > 60 || preLaunchStrategyScore < 70) {
    status = PRE_LAUNCH_STATUS.REJECTED;
  } else if (candidate.expectedLaunchTime === 'UNKNOWN' || candidate.contractAddress === 'UNKNOWN') {
    status = PRE_LAUNCH_STATUS.WATCH;
  } else if (preLaunchStrategyScore >= 70 && riskAnalysis.preLaunchRiskScore <= 60) {
    status = PRE_LAUNCH_STATUS.READY_FOR_LAUNCH;
  } else {
    status = PRE_LAUNCH_STATUS.WATCH;
  }

  return {
    candidate,
    preLaunchRiskScore: riskAnalysis.preLaunchRiskScore,
    preLaunchStrategyScore,
    status,
    riskAnalysis
  };
}

/**
 * Loads the persistent Tomorrow Watchlist from disk.
 * @returns {Array<Object>}
 */
export function loadTomorrowWatchlist() {
  try {
    if (fs.existsSync(WATCHLIST_FILE)) {
      const raw = fs.readFileSync(WATCHLIST_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        tomorrowWatchlistCache = parsed;
        return [...tomorrowWatchlistCache];
      }
    }
  } catch (err) {
    console.warn('[WARN] Failed to load tomorrow_watchlist.json:', err.message);
  }
  tomorrowWatchlistCache = [];
  return [];
}

/**
 * Persists the Tomorrow Watchlist to disk (skips in test mode).
 * @param {Array<Object>} shortlist 
 */
export function saveTomorrowWatchlist(shortlist) {
  tomorrowWatchlistCache = Array.isArray(shortlist) ? shortlist : [];
  if (process.env.NODE_ENV === 'test' || global.IS_TEST_ENV) {
    return;
  }
  try {
    fs.writeFileSync(WATCHLIST_FILE, JSON.stringify(tomorrowWatchlistCache, null, 2), 'utf8');
  } catch (err) {
    console.error('[ERROR] Failed to save tomorrow_watchlist.json:', err.message);
  }
}

/**
 * Returns current copy of Tomorrow Watchlist.
 */
export function getTomorrowWatchlist() {
  return [...tomorrowWatchlistCache];
}

/**
 * Clears in-memory tomorrow watchlist (used in tests).
 */
export function resetTomorrowWatchlist() {
  tomorrowWatchlistCache = [];
  saveTomorrowWatchlist([]);
}

/**
 * Ingests, analyzes, ranks, and updates the Tomorrow Watchlist shortlist.
 * 
 * @param {Array<Object>} rawCandidates 
 * @returns {Array<Object>} Shortlisted candidates sorted by rank
 */
export function processPreLaunchCandidates(rawCandidates) {
  if (!Array.isArray(rawCandidates)) return [];

  const evaluatedList = [];

  for (const raw of rawCandidates) {
    const candidate = standardizePreLaunchCandidate(raw);
    if (!candidate) continue;

    const riskEval = evaluatePreLaunchRisk(candidate);
    const stratEval = evaluatePreLaunchStrategy(candidate, riskEval);

    evaluatedList.push({
      id: candidate.id,
      name: candidate.name,
      symbol: candidate.symbol,
      chain: candidate.chain,
      contractAddress: candidate.contractAddress,
      expectedLaunchDate: candidate.expectedLaunchDate,
      expectedLaunchTime: candidate.expectedLaunchTime,
      platform: candidate.platform,
      riskScore: stratEval.preLaunchRiskScore,
      strategyScore: stratEval.preLaunchStrategyScore,
      dataConfidence: candidate.dataConfidence,
      status: stratEval.status,
      positiveSignals: candidate.socialLinks.length > 0 ? ['Verified social links', 'Platform identified'] : ['Platform identified'],
      risks: riskEval.riskFactors,
      missingInformation: riskEval.unknownFactors,
      evaluatedAt: new Date().toISOString()
    });
  }

  // Filter for READY_FOR_LAUNCH or WATCH candidates and sort by strategy score descending
  const shortlist = evaluatedList
    .filter(c => c.status === PRE_LAUNCH_STATUS.READY_FOR_LAUNCH || c.status === PRE_LAUNCH_STATUS.WATCH)
    .sort((a, b) => b.strategyScore - a.strategyScore)
    .map((item, idx) => ({ rank: idx + 1, ...item }));

  saveTomorrowWatchlist(shortlist);
  return shortlist;
}

export const LAUNCH_VERIFICATION_DECISION = Object.freeze({
  FINAL_PASS: 'FINAL_PASS',
  REJECT_IDENTITY: 'REJECT_IDENTITY',
  REJECT_MARKET: 'REJECT_MARKET',
  REJECT_LIQUIDITY: 'REJECT_LIQUIDITY',
  REJECT_VOLUME: 'REJECT_VOLUME',
  REJECT_RISK: 'REJECT_RISK',
  REJECT_STRATEGY: 'REJECT_STRATEGY',
  WAITING: 'WAITING',
  UNAVAILABLE: 'UNAVAILABLE'
});

/**
 * Launch-Day Quick Verification.
 * Performs fast final checks when a shortlisted candidate actually launches.
 * 
 * Checks:
 * 1. Token / Mint Identity Match
 * 2. DEX Market / Pair & Live Price > 0
 * 3. Liquidity >= $10,000
 * 4. 5-Min Volume >= $5,000 & Active Trading
 * 5. Phase 3 Risk Score <= 60
 * 6. Phase 4 Strategy Score >= 70 & Phase 8 Risk Manager Approval
 * 
 * @param {Object} preLaunchCandidate 
 * @param {Object} liveMarketData 
 * @returns {{ decision: string, reasons: Array<string>, verifiedToken?: Object }}
 */
export function verifyLaunchDayCandidate(preLaunchCandidate, liveMarketData) {
  const reasons = [];

  if (!preLaunchCandidate || !liveMarketData) {
    return { 
      decision: LAUNCH_VERIFICATION_DECISION.UNAVAILABLE, 
      reasons: ['Missing pre-launch candidate or live market data payload'] 
    };
  }

  // Check 1: Identity & Mint Match
  const candidateMint = preLaunchCandidate.contractAddress || preLaunchCandidate.mint || 'UNKNOWN';
  if (candidateMint !== 'UNKNOWN' && liveMarketData.address) {
    if (candidateMint.toLowerCase() !== liveMarketData.address.toLowerCase()) {
      reasons.push(`Contract address mismatch (${liveMarketData.address} !== ${candidateMint})`);
      return { decision: LAUNCH_VERIFICATION_DECISION.REJECT_IDENTITY, reasons };
    }
  } else if (candidateMint === 'UNKNOWN' && !liveMarketData.address) {
    reasons.push('Token mint identity unavailable');
    return { decision: LAUNCH_VERIFICATION_DECISION.REJECT_IDENTITY, reasons };
  }

  // Check 2: DEX Market & Price Active
  if (!liveMarketData.priceUsd || typeof liveMarketData.priceUsd !== 'number' || liveMarketData.priceUsd <= 0) {
    reasons.push('Live price unavailable or <= 0');
    return { decision: LAUNCH_VERIFICATION_DECISION.REJECT_MARKET, reasons };
  }

  // Check 3: Minimum Liquidity ($10,000)
  const minLiquidity = config.minLiquidityUsd || 10000;
  if (typeof liveMarketData.liquidityUsd !== 'number' || liveMarketData.liquidityUsd < minLiquidity) {
    reasons.push(`Liquidity below minimum threshold ($${liveMarketData.liquidityUsd || 0} < $${minLiquidity})`);
    return { decision: LAUNCH_VERIFICATION_DECISION.REJECT_LIQUIDITY, reasons };
  }

  // Check 4: Minimum 5-Min Volume ($5,000)
  const minVolume = config.minVolume5mUsd || 5000;
  if (typeof liveMarketData.volume5mUsd !== 'number' || liveMarketData.volume5mUsd < minVolume) {
    reasons.push(`5m Volume below minimum threshold ($${liveMarketData.volume5mUsd || 0} < $${minVolume})`);
    return { decision: LAUNCH_VERIFICATION_DECISION.REJECT_VOLUME, reasons };
  }

  // Check 5: Phase 3 Risk Filter Evaluation
  const riskResult = evaluateTokenRisk(liveMarketData);
  if (!riskResult || !riskResult.isCandidate) {
    reasons.push(`Phase 3 Risk Filter Failed: ${riskResult?.reason || 'Unknown risk failure'}`);
    return { decision: LAUNCH_VERIFICATION_DECISION.REJECT_RISK, reasons };
  }

  // Check 6: Phase 4 Strategy Scoring Evaluation (min score 70)
  let stratResult = null;
  if (riskResult && riskResult.isCandidate) {
    stratResult = evaluateStrategy(liveMarketData, riskResult);
    if (!stratResult || stratResult.status !== 'CANDIDATE' || stratResult.totalScore < (config.minStrategyScore || 70)) {
      reasons.push(`Phase 4 Strategy Score Failed: Score ${stratResult?.totalScore || 0} < ${config.minStrategyScore || 70}`);
      return { decision: LAUNCH_VERIFICATION_DECISION.REJECT_STRATEGY, reasons };
    }
  }

  // Check 7: Phase 8 Advanced Risk Manager Evaluation (max risk score 60)
  if (stratResult && stratResult.status === 'CANDIDATE') {
    const riskManagerDec = evaluateTradeRisk(liveMarketData, stratResult);
    if (!riskManagerDec || !riskManagerDec.approved) {
      reasons.push(`Phase 8 Risk Manager Failed: ${riskManagerDec?.reasons?.join(', ') || 'Rejected'}`);
      return { decision: LAUNCH_VERIFICATION_DECISION.REJECT_RISK, reasons };
    }
  }

  return {
    decision: LAUNCH_VERIFICATION_DECISION.FINAL_PASS,
    reasons: [],
    verifiedToken: liveMarketData
  };
}

/**
 * Hands off a FINAL_PASS launch-day candidate to the existing Paper Trading Engine.
 * 
 * IMPORTANT SAFETY NOTICE:
 * Executes simulated paper trade ONLY. Zero real money, zero Web3 signatures, zero wallet connections.
 * 
 * @param {Object} verifiedToken 
 * @param {number} [customPositionSize] 
 * @returns {Promise<Object|null>} Paper trade result or null
 */
export async function handOffToPaperTrader(verifiedToken, customPositionSize = null) {
  if (!verifiedToken || typeof verifiedToken !== 'object') return null;

  // Prerequisite safety gate before invoking paperTrader
  if (!verifiedToken.address || 
      !verifiedToken.priceUsd || verifiedToken.priceUsd <= 0 ||
      typeof verifiedToken.liquidityUsd !== 'number' || verifiedToken.liquidityUsd < 10000 ||
      typeof verifiedToken.volume5mUsd !== 'number' || verifiedToken.volume5mUsd < 5000) {
    console.warn('[SAFETY] Prerequisite market metrics failed. Skipping paper trader handoff.');
    return null;
  }

  console.log('\n========================================');
  console.log('HANDING OFF LAUNCH-DAY CANDIDATE TO PAPER TRADER');
  console.log('========================================');
  console.log(`Symbol     : ${verifiedToken.symbol}`);
  console.log(`Address    : ${verifiedToken.address}`);
  console.log(`Price      : $${verifiedToken.priceUsd}`);
  console.log('Mode       : PAPER TRADING ONLY');
  console.log('========================================\n');

  return await executePaperTrade(verifiedToken, customPositionSize);
}

/**
 * Executes full Launch-Day Quick Verification Pipeline.
 * 
 * Pipeline Flow:
 * 1. Load tomorrow_watchlist.json (or options override)
 * 2. If watchlist is empty → status: NO_VERIFIED_TOMORROW_DATA
 * 3. For candidates, check launch window & verify identity / DEX market data
 * 4. Verify liquidity (>= $10,000), 5m volume (>= $5,000), risk (<= 60), strategy score (>= 70)
 * 5. If FINAL_PASS → hand off to paperTrader
 * 
 * @param {Object} [options]
 * @param {Array<Object>} [options.watchlistOverride]
 * @param {Map<string, Object>} [options.liveMarketOverrideMap]
 * @returns {Promise<Object>} Verification summary report
 */
export async function executeLaunchDayVerificationPipeline(options = {}) {
  const watchlist = options.watchlistOverride || loadTomorrowWatchlist();
  const liveMarketMap = options.liveMarketOverrideMap || new Map();

  if (!Array.isArray(watchlist) || watchlist.length === 0) {
    return {
      status: 'NO_VERIFIED_TOMORROW_DATA',
      watchedCandidatesCount: 0,
      verifiedCandidates: [],
      paperTradesStarted: 0,
      message: 'Watchlist is empty. Zero launch candidates to verify.'
    };
  }

  const verifiedCandidates = [];
  let paperTradesStarted = 0;

  for (const item of watchlist) {
    const candidate = item.candidate || item;
    const mint = candidate.contractAddress || candidate.mint || candidate.address || 'UNKNOWN';

    const liveMarketData = liveMarketMap.get(mint) || liveMarketMap.get(candidate.name) || null;

    if (!liveMarketData) {
      verifiedCandidates.push({
        candidateId: candidate.id || mint,
        name: candidate.name,
        symbol: candidate.symbol,
        mint,
        launchState: 'WAITING_FOR_MARKET',
        decision: LAUNCH_VERIFICATION_DECISION.REJECT_MARKET,
        reasons: ['DEX market pair not found or launch window not reached']
      });
      continue;
    }

    const verificationResult = verifyLaunchDayCandidate(candidate, liveMarketData);

    if (verificationResult.decision === LAUNCH_VERIFICATION_DECISION.FINAL_PASS) {
      const tradeResult = await handOffToPaperTrader(verificationResult.verifiedToken);
      if (tradeResult) {
        paperTradesStarted++;
      }
    }

    verifiedCandidates.push({
      candidateId: candidate.id || mint,
      name: candidate.name,
      symbol: candidate.symbol,
      mint,
      launchState: verificationResult.decision === LAUNCH_VERIFICATION_DECISION.FINAL_PASS ? 'LAUNCHED' : 'VERIFICATION_FAILED',
      decision: verificationResult.decision,
      reasons: verificationResult.reasons,
      verifiedToken: verificationResult.verifiedToken || null
    });
  }

  const finalPassCount = verifiedCandidates.filter(c => c.decision === LAUNCH_VERIFICATION_DECISION.FINAL_PASS).length;

  return {
    status: finalPassCount > 0 ? 'VERIFIED_LAUNCH_DAY_TRADES' : 'LAUNCH_DAY_VERIFICATION_COMPLETE',
    watchedCandidatesCount: watchlist.length,
    verifiedCandidates,
    finalPassCount,
    paperTradesStarted,
    message: `Evaluated ${watchlist.length} watched candidate(s). Final Pass: ${finalPassCount}. Paper Trades Started: ${paperTradesStarted}.`
  };
}
