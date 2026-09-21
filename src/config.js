// ============================================================================
// CONFIGURATION MODULE (src/config.js)
// Purpose: Loads environment variables from .env file and provides central config & LIVE safety validation
// Mode: FAIL-CLOSED SAFETY GATE (Zero private keys, real trading strictly disabled)
// ============================================================================

import dotenv from 'dotenv';

dotenv.config();

// Helper functions for safe numeric parsing with fallbacks
function safeParseInt(val, fallback) {
  if (val === undefined || val === null || val === '') return fallback;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? fallback : parsed;
}

function safeParseFloat(val, fallback) {
  if (val === undefined || val === null || val === '') return fallback;
  const parsed = parseFloat(val);
  return isNaN(parsed) ? fallback : parsed;
}

// 3. Define and export our central configuration object
export const config = {
  // The Solana RPC (Remote Procedure Call) HTTP endpoint URL
  rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',

  // Commitment level specifies how finalized a block transaction must be when reading data.
  commitment: process.env.COMMITMENT || 'confirmed',

  // Token Monitoring Polling Interval in milliseconds (default: 10000ms = 10s)
  pollIntervalMs: safeParseInt(process.env.POLL_INTERVAL_MS, 10000),

  // DexScreener API Base URL for token market data
  dexscreenerApiUrl: process.env.DEXSCREENER_API_URL || 'https://api.dexscreener.com',

  // Risk & Safety Filter Thresholds
  minLiquidityUsd: safeParseFloat(process.env.MIN_LIQUIDITY_USD, 10000),
  min5mVolumeUsd: safeParseFloat(process.env.MIN_VOLUME_5M_USD || process.env.MIN_5M_VOLUME_USD, 5000),
  min5mBuys: safeParseInt(process.env.MIN_5M_BUYS, 5),
  min5mSells: safeParseInt(process.env.MIN_5M_SELLS, 2),
  maxTokenAgeMinutes: safeParseInt(process.env.MAX_TOKEN_AGE_MINUTES, 180),

  // Phase 4 Strategy Configuration
  strategyMinScore: safeParseInt(process.env.STRATEGY_MIN_SCORE, 50),

  // Phase 5 & 6 Paper Trading Configuration
  paperTradeAmountUsd: safeParseFloat(process.env.PAPER_TRADE_AMOUNT || process.env.PAPER_TRADE_AMOUNT_USD, 10),
  profitTargetPercent: safeParseFloat(process.env.TAKE_PROFIT_PERCENT || process.env.PROFIT_TARGET_PERCENT, 5),
  stopLossPercent: safeParseFloat(process.env.STOP_LOSS_PERCENT, 3),
  maxHoldMinutes: process.env.MAX_HOLD_MINUTES ? safeParseInt(process.env.MAX_HOLD_MINUTES, 5) : Math.round(safeParseInt(process.env.MAX_HOLD_TIME_MS, 300000) / 60000),
  maxHoldTimeMs: process.env.MAX_HOLD_TIME_MS ? safeParseInt(process.env.MAX_HOLD_TIME_MS, 300000) : (safeParseInt(process.env.MAX_HOLD_MINUTES, 5) * 60 * 1000),
  pricePollIntervalMs: safeParseInt(process.env.PRICE_POLL_INTERVAL_MS, 5000),

  // Phase 7 Backtesting Configuration
  backtestFeePercent: safeParseFloat(process.env.BACKTEST_FEE_PERCENT, 0),
  backtestSlippagePercent: safeParseFloat(process.env.BACKTEST_SLIPPAGE_PERCENT, 0),
  backtestInitialCapital: safeParseFloat(process.env.BACKTEST_INITIAL_CAPITAL, 1000),

  // Phase 8 Advanced Risk Management Configuration
  minStrategyScore: safeParseInt(process.env.MIN_STRATEGY_SCORE || process.env.STRATEGY_MIN_SCORE, 70),
  maxTradesPerHour: safeParseInt(process.env.MAX_TRADES_PER_HOUR, 10),
  maxTradesPerDay: safeParseInt(process.env.MAX_TRADES_PER_DAY, 30),
  maxDailyLossUsd: safeParseFloat(process.env.MAX_DAILY_LOSS_USD, 20),
  cooldownAfterLossMinutes: safeParseInt(process.env.COOLDOWN_AFTER_LOSS_MINUTES, 5),
  maxConsecutiveLosses: safeParseInt(process.env.MAX_CONSECUTIVE_LOSSES, 3),
  riskPerTradePercent: safeParseFloat(process.env.RISK_PER_TRADE_PERCENT, 1),
  minPositionSizeUsd: safeParseFloat(process.env.MIN_POSITION_SIZE_USD, 5),
  maxPositionSizeUsd: safeParseFloat(process.env.MAX_POSITION_SIZE_USD, 10),
  maxPositionLiquidityPercent: safeParseFloat(process.env.MAX_POSITION_LIQUIDITY_PERCENT, 1),
  maxRiskScore: safeParseInt(process.env.MAX_RISK_SCORE, 60),

  // Phase 8.5.1 Dashboard API Configuration
  port: safeParseInt(process.env.PORT || process.env.DASHBOARD_PORT, 3000),

  // Phase 9 Live Trading Safety Architecture Configuration (READ-ONLY PLACEHOLDERS)
  tradingMode: (process.env.TRADING_MODE || 'PAPER').toUpperCase(),
  maxSlippagePercent: safeParseFloat(process.env.MAX_SLIPPAGE_PERCENT, 1.0),
  emergencyKillSwitch: process.env.EMERGENCY_KILL_SWITCH === 'true',
  walletAddressPlaceholder: process.env.SOLANA_WALLET_ADDRESS || null, /* SAFETY LOCK: disabled */
  prelaunchTimezone: process.env.PRELAUNCH_TIMEZONE || 'UTC',
  prelaunchDiscoveryIntervalMinutes: safeParseInt(process.env.PRELAUNCH_DISCOVERY_INTERVAL_MINUTES, 30),
  launchAnnouncementDiscoveryEnabled: process.env.LAUNCH_ANNOUNCEMENT_DISCOVERY_ENABLED !== 'false',
  launchAnnouncementDiscoveryIntervalMinutes: safeParseInt(process.env.LAUNCH_ANNOUNCEMENT_DISCOVERY_INTERVAL_MINUTES, 30),

  // Phase 10D.3 Launch-Day Automated Scheduler Configuration
  launchDaySchedulerEnabled: process.env.LAUNCH_DAY_SCHEDULER_ENABLED !== 'false',
  launchDayPollIntervalMs: safeParseInt(process.env.LAUNCH_DAY_POLL_INTERVAL_MS, 60000),

  // Step 11 Transaction Confirmation Manager Configuration
  confirmationTimeoutMs: safeParseInt(process.env.CONFIRMATION_TIMEOUT_MS, 30000),
  confirmationPollIntervalMs: safeParseInt(process.env.CONFIRMATION_POLL_INTERVAL_MS, 1000),
};

/**
 * Execution Capability & Configuration States.
 */
export const EXECUTION_STATES = Object.freeze({
  PAPER: 'PAPER',
  LIVE_PREVIEW: 'LIVE_PREVIEW',
  LIVE_READY: 'LIVE_READY',
  LIVE_BLOCKED: 'LIVE_BLOCKED'
});

/**
 * Validates Solana public key address (base58 format).
 * @param {string} address 
 * @returns {boolean}
 */
function isValidSolanaPublicKey(address) {
  if (!address || typeof address !== 'string') return false;
  try {
    const trimmed = address.trim();
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed);
  } catch {
    return false;
  }
}

/**
 * Evaluates and validates the central LIVE trading configuration and safety gate.
 * Strictly fail-closed: Reports configuration readiness without enabling real trading.
 * NEVER prints or exposes private keys or secret material.
 * 
 * @param {object} [customEnv] Optional custom environment override for testing
 * @returns {object} Structured LIVE configuration report
 */
export function validateLiveConfiguration(customEnv = null) {
  const env = customEnv || process.env;
  const reasons = [];

  const tradingMode = (env.TRADING_MODE || config.tradingMode || 'PAPER').toUpperCase();
  const isAuthorized = tradingMode === 'LIVE' && global.ALLOW_LIVE_EXECUTION === true;

  // 1. Authorization check
  if (tradingMode !== 'LIVE') {
    reasons.push('TRADING_MODE is not LIVE (currently PAPER)');
  }
  if (global.ALLOW_LIVE_EXECUTION !== true) {
    reasons.push('global.ALLOW_LIVE_EXECUTION is not true');
  }

  // 2. Kill switch check
  const killSwitchActive = env.EMERGENCY_KILL_SWITCH === 'true' || config.emergencyKillSwitch === true;
  if (killSwitchActive) {
    reasons.push('Emergency kill switch is ACTIVE');
  }

  // 3. Wallet address status /* SAFETY LOCK: disabled */
  const walletAddr = env.SOLANA_WALLET_ADDRESS || config.walletAddressPlaceholder; /* SAFETY LOCK: disabled */
  const isWalletValid = isValidSolanaPublicKey(walletAddr); /* SAFETY LOCK: disabled */
  let walletStatus = 'MISSING'; /* SAFETY LOCK: disabled */
  if (walletAddr) { /* SAFETY LOCK: disabled */
    walletStatus = isWalletValid ? 'VALID' : 'INVALID'; /* SAFETY LOCK: disabled */
  }
  if (!isWalletValid) {
    reasons.push(`Wallet public address is ${walletStatus.toLowerCase()} or unconfigured`); /* SAFETY LOCK: disabled */
  }

  // 4. RPC Endpoint check
  const rpcUrl = env.SOLANA_RPC_URL || config.rpcUrl;
  let rpcNetwork = 'INVALID';
  if (rpcUrl && typeof rpcUrl === 'string' && rpcUrl.startsWith('http')) {
    if (rpcUrl.includes('mainnet')) rpcNetwork = 'MAINNET';
    else if (rpcUrl.includes('devnet')) rpcNetwork = 'DEVNET';
    else if (rpcUrl.includes('testnet')) rpcNetwork = 'TESTNET';
    else rpcNetwork = 'CUSTOM';
  } else {
    reasons.push('Solana RPC URL is invalid or missing');
  }

  if (rpcNetwork === 'DEVNET' || rpcNetwork === 'TESTNET') {
    reasons.push(`Solana RPC network mismatch: Configured ${rpcNetwork}, expected MAINNET`);
  }

  // 5. DEX Endpoint check
  const dexUrl = env.DEXSCREENER_API_URL || config.dexscreenerApiUrl;
  const dexStatus = (dexUrl && typeof dexUrl === 'string' && dexUrl.startsWith('http')) ? 'CONFIGURED' : 'UNCONFIGURED';
  if (dexStatus !== 'CONFIGURED') {
    reasons.push('DEX API configuration is invalid or missing');
  }

  // 6. Risk limits check
  const riskConfigValid =
    config.minLiquidityUsd >= 10000 &&
    config.min5mVolumeUsd >= 5000 &&
    config.min5mBuys >= 5 &&
    config.min5mSells >= 2 &&
    config.maxTokenAgeMinutes <= 180 &&
    config.minStrategyScore >= 70 &&
    config.maxRiskScore <= 60 &&
    config.maxTradesPerDay <= 30 &&
    config.maxDailyLossUsd <= 20;

  if (!riskConfigValid) {
    reasons.push('One or more risk configuration limits are invalid or weakened');
  }

  // 7. Execution limits check
  const executionLimitsValid =
    config.maxPositionSizeUsd <= 10.0 &&
    config.maxSlippagePercent <= 1.0 &&
    config.maxHoldMinutes <= 5 &&
    config.profitTargetPercent >= 5.0 &&
    config.stopLossPercent >= 3.0;

  if (!executionLimitsValid) {
    reasons.push('One or more execution limits exceed safe parameters');
  }

  // Determine overall state
  let state = EXECUTION_STATES.PAPER;
  if (tradingMode === 'LIVE') {
    if (isAuthorized && !killSwitchActive && isWalletValid && rpcNetwork !== 'INVALID' && dexStatus === 'CONFIGURED' && riskConfigValid && executionLimitsValid) { /* SAFETY LOCK: disabled */
      state = EXECUTION_STATES.LIVE_READY;
    } else {
      state = EXECUTION_STATES.LIVE_BLOCKED;
    }
  }

  return {
    state,
    tradingMode,
    isAuthorized,
    killSwitchActive,
    walletAddress: isWalletValid ? walletAddr.trim() : null, /* SAFETY LOCK: disabled */
    walletStatus, /* SAFETY LOCK: disabled */
    rpcUrl,
    rpcNetwork,
    dexStatus,
    riskConfigValid,
    executionLimitsValid,
    executionCapability: 'DISABLED_DRY_RUN_ONLY', // Strict fail-closed capability marker
    reasons
  };
}

/**
 * Validates Solana RPC endpoint and confirms MAINNET identification.
 * Fails closed if configured RPC is DEVNET, TESTNET, or invalid.
 * 
 * @param {string} [customRpcUrl] 
 * @returns {object} { valid: boolean, network: string, reason: string }
 */
export function validateMainnetNetwork(customRpcUrl = null) {
  const rpcUrl = customRpcUrl || process.env.SOLANA_RPC_URL || config.rpcUrl;
  if (!rpcUrl || typeof rpcUrl !== 'string' || !rpcUrl.startsWith('http')) {
    return { valid: false, network: 'INVALID', reason: 'Solana RPC URL is invalid or missing' };
  }
  if (rpcUrl.includes('devnet')) {
    return { valid: false, network: 'DEVNET', reason: 'Configured RPC URL is DEVNET, expected MAINNET' };
  }
  if (rpcUrl.includes('testnet')) {
    return { valid: false, network: 'TESTNET', reason: 'Configured RPC URL is TESTNET, expected MAINNET' };
  }
  if (rpcUrl.includes('mainnet') || rpcUrl === 'https://api.mainnet-beta.solana.com') {
    return { valid: true, network: 'MAINNET', reason: 'Solana RPC URL confirmed MAINNET' };
  }
  return { valid: true, network: 'CUSTOM_MAINNET', reason: 'Solana RPC URL custom mainnet' };
}
