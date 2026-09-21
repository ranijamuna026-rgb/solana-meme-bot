// ============================================================================
// LAUNCH-DAY AUTOMATED SCHEDULER (src/launchDayScheduler.js)
// Phase 10D.3 — Production Pre-Launch Verification Orchestrator
// Coordinates periodic execution of Phase 10D.2 launch-day verification pipeline,
// dynamic watchlist loading, duplicate trade protection, and error-resilient polling.
// Safety: REAL SOLANA MAINNET MARKET DATA + PAPER TRADING ONLY (Zero Web3 signing)
// ============================================================================

import { config } from './config.js';
import { getTomorrowWatchlist } from './preLaunchEngine.js';
import { executeLaunchDayVerificationPipeline, LAUNCH_VERIFICATION_DECISION } from './preLaunchEngine.js';
import { getActiveTrade } from './paperTrader.js';

let schedulerTimerId = null;
let isEnabled = true;
let isRunning = false; // Lock against overlapping concurrent runs
let pollIntervalMs = 60000; // Default: 60s (60000ms)

let lastRunAt = null;
let nextRunAt = null;
let lastRunStatus = 'NOT_RUN';
let lastError = null;

let watchedCandidatesCount = 0;
let verifiedCandidatesCount = 0;
let paperTradesStartedCount = 0;

// Session duplicate protection tracking: candidate Mint -> timestamp
const activeSessionTradesMap = new Map();

/**
 * Validates polling interval input.
 * @param {any} val 
 * @returns {number|null} Valid interval in ms or null if invalid
 */
export function parseAndValidatePollInterval(val) {
  if (val === undefined || val === null || val === '') return null;
  const num = Number(val);
  if (isNaN(num) || !isFinite(num) || num <= 0) return null;
  return Math.floor(num);
}

/**
 * Checks if a candidate is already active in paper trading or session handoff history.
 * @param {string} mintOrId 
 * @returns {boolean}
 */
export function isCandidateDuplicateActive(mintOrId) {
  if (!mintOrId || mintOrId === 'UNKNOWN') return false;

  // Check 1: Session tracking map
  if (activeSessionTradesMap.has(mintOrId)) {
    return true;
  }

  // Check 2: Active trade state in paperTrader
  const activeTradeState = getActiveTrade();
  if (activeTradeState && activeTradeState.active && activeTradeState.trade) {
    const activeTrade = activeTradeState.trade;
    if (activeTrade.address === mintOrId || activeTrade.symbol === mintOrId) {
      return true;
    }
  }

  return false;
}

/**
 * Executes a single launch-day verification run tick.
 * 
 * Pipeline Steps:
 * 1. Acquire isRunning lock (skip tick if already executing)
 * 2. Reload latest tomorrow_watchlist.json (dynamic, no stale caching)
 * 3. If watchlist is empty -> return NO_VERIFIED_TOMORROW_DATA status cleanly
 * 4. Filter candidates against duplicate protection
 * 5. Trigger Phase 10D.2 executeLaunchDayVerificationPipeline()
 * 6. Record session handoffs and metrics
 * 7. Release lock & handle errors safely without stopping scheduler loop
 * 
 * @param {Object} [options]
 * @param {Array<Object>} [options.watchlistOverride]
 * @param {Map<string, Object>} [options.liveMarketOverrideMap]
 * @returns {Promise<Object>} Verification Run Status
 */
export async function runLaunchDayCheck(options = {}) {
  // Check enablement
  if (options.enabled === false || (options.enabled === undefined && isEnabled === false)) {
    lastRunStatus = 'DISABLED';
    return {
      enabled: false,
      running: false,
      status: 'DISABLED',
      watchedCandidatesCount: 0,
      verifiedCandidates: [],
      paperTradesStarted: 0,
      message: 'Launch-Day Scheduler is disabled.'
    };
  }

  // Overlapping Run Lock Protection
  if (isRunning) {
    console.log('[WARN] Launch-Day verification run already in progress. Skipping overlapping tick.');
    return {
      status: 'SKIPPED_OVERLAPPING_RUN',
      running: true,
      message: 'Launch-Day check skipped because previous run is still executing.'
    };
  }

  isRunning = true;
  lastRunAt = new Date().toISOString();
  lastError = null;

  try {
    // Reload CURRENT watchlist dynamically (or override in options for tests)
    const currentWatchlist = options.watchlistOverride || getTomorrowWatchlist();
    const liveMarketMap = options.liveMarketOverrideMap || new Map();

    watchedCandidatesCount = Array.isArray(currentWatchlist) ? currentWatchlist.length : 0;

    if (!Array.isArray(currentWatchlist) || currentWatchlist.length === 0) {
      lastRunStatus = 'NO_VERIFIED_TOMORROW_DATA';
      verifiedCandidatesCount = 0;
      paperTradesStartedCount = 0;
      isRunning = false;

      return {
        status: 'NO_VERIFIED_TOMORROW_DATA',
        watchedCandidatesCount: 0,
        verifiedCandidates: [],
        paperTradesStarted: 0,
        message: 'Watchlist is empty. Zero launch candidates to verify.'
      };
    }

    // Filter candidate list for duplicate active paper trades
    const filteredWatchlist = [];
    let duplicateSkippedCount = 0;

    for (const item of currentWatchlist) {
      const candidate = item.candidate || item;
      const mint = candidate.contractAddress || candidate.mint || candidate.address || 'UNKNOWN';
      const id = candidate.id || mint;

      if (isCandidateDuplicateActive(mint) || isCandidateDuplicateActive(id)) {
        duplicateSkippedCount++;
        console.log(`[INFO] Skipping duplicate active candidate: ${candidate.symbol || id}`);
      } else {
        filteredWatchlist.push(item);
      }
    }

    // Run Phase 10D.2 Pipeline
    const pipelineResult = await executeLaunchDayVerificationPipeline({
      watchlistOverride: filteredWatchlist,
      liveMarketOverrideMap: liveMarketMap
    });

    // Update tracking for newly started paper trades
    if (pipelineResult && Array.isArray(pipelineResult.verifiedCandidates)) {
      for (const item of pipelineResult.verifiedCandidates) {
        if (item.decision === LAUNCH_VERIFICATION_DECISION.FINAL_PASS && item.verifiedToken) {
          const mint = item.mint || item.verifiedToken.address;
          if (mint && mint !== 'UNKNOWN') {
            activeSessionTradesMap.set(mint, Date.now());
          }
        }
      }
    }

    verifiedCandidatesCount = pipelineResult.verifiedCandidates ? pipelineResult.verifiedCandidates.length : 0;
    paperTradesStartedCount = pipelineResult.paperTradesStarted || 0;
    lastRunStatus = pipelineResult.status || 'LAUNCH_DAY_VERIFICATION_COMPLETE';

    isRunning = false;

    return {
      status: lastRunStatus,
      watchedCandidatesCount,
      verifiedCandidatesCount,
      paperTradesStarted: paperTradesStartedCount,
      duplicateSkippedCount,
      pipelineResult,
      message: pipelineResult.message || 'Launch-day verification complete.'
    };
  } catch (err) {
    console.error('[ERROR] Launch-Day Scheduler run exception:', err.message);
    lastRunStatus = 'ERROR';
    lastError = err.message;
    isRunning = false;

    return {
      status: 'ERROR',
      error: err.message,
      watchedCandidatesCount,
      verifiedCandidatesCount: 0,
      paperTradesStarted: 0
    };
  }
}

/**
 * Starts the Launch-Day Automated Scheduler polling loop cleanly.
 * 
 * @param {Object} [options]
 * @param {number} [options.pollIntervalMs]
 * @param {boolean} [options.enabled]
 * @returns {Object} Start Status
 */
export function startLaunchDayScheduler(options = {}) {
  // Determine enablement
  if (options.enabled !== undefined) {
    isEnabled = Boolean(options.enabled);
  } else {
    isEnabled = config.launchDaySchedulerEnabled !== false;
  }

  if (!isEnabled) {
    console.log('[INFO] Launch-Day Scheduler is disabled in configuration.');
    return { enabled: false, running: false, status: 'DISABLED' };
  }

  // Prevent duplicate timers when start() is called twice
  if (schedulerTimerId !== null) {
    console.warn('[WARN] Launch-Day Scheduler is already running. Skipping duplicate timer initialization.');
    return getLaunchDaySchedulerStatus();
  }

  // Parse & validate poll interval
  let intervalInput = options.pollIntervalMs !== undefined ? options.pollIntervalMs : config.launchDayPollIntervalMs;
  let validatedInterval = parseAndValidatePollInterval(intervalInput);

  if (validatedInterval === null) {
    console.warn(`[WARN] Invalid poll interval provided (${intervalInput}). Falling back to default 60,000ms (60s).`);
    validatedInterval = 60000;
  }

  pollIntervalMs = validatedInterval;
  nextRunAt = new Date(Date.now() + pollIntervalMs).toISOString();

  console.log('====================================================');
  console.log(`[INFO] Starting Launch-Day Automated Scheduler (Phase 10D.3)`);
  console.log(`[INFO] Poll Interval : ${pollIntervalMs / 1000}s (${pollIntervalMs}ms)`);
  console.log(`[INFO] Mode          : REAL MAINNET DATA + PAPER TRADING ONLY`);
  console.log('====================================================');

  // Trigger initial check immediately on start
  runLaunchDayCheck(options).catch(err => {
    console.error('[ERROR] Initial Launch-Day check failed:', err.message);
  });

  // Set recurring polling timer
  schedulerTimerId = setInterval(() => {
    nextRunAt = new Date(Date.now() + pollIntervalMs).toISOString();
    runLaunchDayCheck(options).catch(err => {
      console.error('[ERROR] Scheduled Launch-Day check failed:', err.message);
    });
  }, pollIntervalMs);

  return getLaunchDaySchedulerStatus();
}

/**
 * Stops the Launch-Day Automated Scheduler cleanly.
 * @returns {Object} Stop Status
 */
export function stopLaunchDayScheduler() {
  if (schedulerTimerId !== null) {
    clearInterval(schedulerTimerId);
    schedulerTimerId = null;
    nextRunAt = null;
    console.log('[INFO] Launch-Day Automated Scheduler stopped.');
  } else {
    console.log('[INFO] Launch-Day Automated Scheduler was not running.');
  }

  return getLaunchDaySchedulerStatus();
}

/**
 * Returns current Launch-Day Scheduler status.
 * @returns {Object} Status Report
 */
export function getLaunchDaySchedulerStatus() {
  return {
    enabled: isEnabled,
    running: schedulerTimerId !== null,
    pollIntervalMs,
    lastRunAt,
    lastRunStatus,
    nextRunAt: schedulerTimerId ? nextRunAt : null,
    lastError,
    watchedCandidates: watchedCandidatesCount,
    verifiedCandidates: verifiedCandidatesCount,
    paperTradesStarted: paperTradesStartedCount,
    activeSessionTradesCount: activeSessionTradesMap.size
  };
}

/**
 * Resets in-memory state for clean test execution.
 */
export function resetLaunchDayScheduler() {
  if (schedulerTimerId !== null) {
    clearInterval(schedulerTimerId);
    schedulerTimerId = null;
  }
  isEnabled = true;
  isRunning = false;
  pollIntervalMs = 60000;
  lastRunAt = null;
  nextRunAt = null;
  lastRunStatus = 'NOT_RUN';
  lastError = null;
  watchedCandidatesCount = 0;
  verifiedCandidatesCount = 0;
  paperTradesStartedCount = 0;
  activeSessionTradesMap.clear();
}
