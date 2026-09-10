// ============================================================================
// MAIN ENTRY POINT (src/index.js)
// Purpose: Starts the bot, initializes RPC connection, Monitor, Risk, Strategy & Paper Trader
// ============================================================================

import { config } from './config.js';
import { testConnection } from './solana.js';
import { startTokenMonitoring } from './monitor.js';
import { evaluateTokenRisk } from './riskFilter.js';
import { evaluateStrategy } from './strategy.js';
import { executePaperTrade, stopPaperTrader } from './paperTrader.js';
import { evaluateTradeRisk } from './riskManager.js';
import { recordCandidate } from './candidateTracker.js';
import { startDashboardServer, stopDashboardServer } from './server.js';

let monitorStopFn = null;
let dashboardServerObj = null;

async function startBot() {
  console.log('====================================================');
  console.log('      SOLANA MEMECOIN BOT (PAPER-TRADING)');
  console.log('====================================================');
  console.log(`[INFO] Mode       : PAPER TRADING ONLY`);
  console.log(`[INFO] RPC URL    : ${config.rpcUrl}`);
  console.log(`[INFO] Commitment : ${config.commitment}`);
  console.log(`[INFO] Poll Rate  : ${config.pollIntervalMs / 1000}s`);
  console.log(`[INFO] Min Liq    : $${config.minLiquidityUsd.toLocaleString()}`);
  console.log(`[INFO] Min 5m Vol : $${config.min5mVolumeUsd.toLocaleString()}`);
  console.log(`[INFO] Min Score  : ${config.minStrategyScore}`);
  console.log(`[INFO] TP         : +${config.profitTargetPercent.toFixed(2)}%`);
  console.log(`[INFO] SL         : -${config.stopLossPercent.toFixed(2)}%`);
  console.log(`[INFO] Hold Time  : ${config.maxHoldMinutes} minute(s)`);
  console.log('----------------------------------------------------');
  console.log('[INFO] Testing connection to Solana RPC...');

  try {
    const result = await testConnection();

    if (result && result.success) {
      console.log('====================================================');
      console.log('[SUCCESS] Connected to Solana RPC successfully!');
      console.log(`[INFO] Node Version : ${result.version}`);
      console.log(`[INFO] Current Slot : ${result.slot}`);
      console.log('====================================================');
      console.log('[INFO] Initializing Full Paper-Trading Bot (Phase 8.5.1)...');

      // Start Read-Only Dashboard API Server
      try {
        dashboardServerObj = await startDashboardServer();
      } catch (serverErr) {
        console.error('[WARN] Dashboard API server failed to start:', serverErr.message);
      }

      // Start continuous token monitoring
      monitorStopFn = startTokenMonitoring((token) => {
        // Step 1: Phase 3 Risk Filter Evaluation
        const riskResult = evaluateTokenRisk(token);

        let strategyResult = null;
        let riskDecision = null;

        // Step 2: Phase 4 Strategy Scoring (ONLY for tokens that PASS Phase 3)
        if (riskResult && riskResult.isCandidate) {
          strategyResult = evaluateStrategy(token, riskResult);

          // Step 3: Phase 8 Advanced Risk Manager Check
          if (strategyResult && strategyResult.status === 'CANDIDATE') {
            riskDecision = evaluateTradeRisk(token, strategyResult);

            // Step 4: Execute paper BUY with position size if approved
            if (riskDecision.approved) {
              executePaperTrade(token, riskDecision.positionSize);
            }
          }
        }

        // Record candidate evaluation in dashboard tracker
        recordCandidate({
          ...token,
          riskFilter: riskResult,
          strategy: strategyResult,
          riskManager: riskDecision
        });
      });
    } else {
      console.log('====================================================');
      console.log('[ERROR] Failed to connect to Solana RPC!');
      console.log(`[REASON] ${result?.error || 'Unknown RPC error'}`);
      console.log('====================================================');
      console.log('[TIP] Check your internet connection or update SOLANA_RPC_URL in .env');
    }
  } catch (err) {
    console.log('====================================================');
    console.log('[ERROR] Unexpected error during bot startup!');
    console.log(`[REASON] ${err.message}`);
    console.log('====================================================');
  }
}

// Graceful shutdown handling
function handleShutdown(signal) {
  console.log(`\n[INFO] Received ${signal}. Shutting down paper-trading bot gracefully...`);
  if (typeof monitorStopFn === 'function') {
    monitorStopFn();
  }
  stopPaperTrader();
  stopDashboardServer();
  process.exit(0);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

// Execute the main startup function with error handling
startBot().catch((err) => {
  console.error('[FATAL] Unhandled error starting bot:', err);
});

