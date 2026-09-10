// ============================================================================
// CONFIGURATION MODULE (src/config.js)
// Purpose: Loads environment variables from .env file and provides central config
// ============================================================================

// 1. Import 'dotenv' to automatically read variables defined in the .env file
import dotenv from 'dotenv';

// 2. Execute dotenv.config() so variables in .env become accessible via process.env
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
  minLiquidityUsd: safeParseFloat(process.env.MIN_LIQUIDITY_USD, 1000),
  min5mVolumeUsd: safeParseFloat(process.env.MIN_5M_VOLUME_USD, 500),
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
  minLiquidityUsd: safeParseFloat(process.env.MIN_LIQUIDITY_USD, 10000),
  min5mVolumeUsd: safeParseFloat(process.env.MIN_VOLUME_5M_USD || process.env.MIN_5M_VOLUME_USD, 5000),
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
  walletAddressPlaceholder: process.env.SOLANA_WALLET_ADDRESS || null,
};



