// ============================================================================
// READ-ONLY DASHBOARD API SERVER (src/server.js)
// Purpose: Exposes bot runtime state via read-only HTTP REST endpoints for web dashboard
// ============================================================================

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { getPortfolioState } from './riskManager.js';
import { getTradeHistory, getActiveTrade, isGenuineMarketTrade } from './paperTrader.js';
import { getCandidates } from './candidateTracker.js';
import { calculatePerformanceAnalytics } from './analytics.js';
import { getKillSwitchState, getSimulationAuditLogs } from './simulationLayer.js';
import { isSafetyConfigurationValid } from './safetyGate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

let serverInstance = null;
let startTimeMs = Date.now();

/**
 * Formats JSON response with conservative CORS headers.
 * 
 * @param {http.ServerResponse} res 
 * @param {number} statusCode 
 * @param {Object} data 
 */
function sendJsonResponse(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-cache, no-store, must-revalidate'
  });
  res.end(JSON.stringify(data, null, 2));
}

/**
 * Handles incoming HTTP requests for the read-only dashboard API.
 * 
 * @param {http.IncomingMessage} req 
 * @param {http.ServerResponse} res 
 */
function handleApiRequest(req, res) {
  // 1. Handle CORS Preflight OPTIONS
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  // 2. Strict READ-ONLY Enforcement: Reject any non-GET request
  if (req.method !== 'GET') {
    sendJsonResponse(res, 405, {
      error: 'Method Not Allowed',
      message: 'Dashboard API is READ-ONLY. Trade execution via API is prohibited.'
    });
    return;
  }

  // Parse request URL path safely
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  try {
    // Route 1: GET /api/status
    if (pathname === '/api/status') {
      const nowMs = Date.now();
      const uptimeSeconds = Math.floor((nowMs - startTimeMs) / 1000);

      sendJsonResponse(res, 200, {
        status: 'RUNNING',
        mode: 'PAPER TRADING ONLY',
        tradingMode: config.tradingMode || 'PAPER',
        liveTradingActive: false,
        liveTradingStatus: 'DISABLED',
        paperTradingActive: true,
        simulationActive: true,
        killSwitchState: getKillSwitchState(),
        uptimeSeconds,
        startTime: new Date(startTimeMs).toISOString(),
        timestamp: new Date(nowMs).toISOString(),
        rpcUrl: config.rpcUrl
      });
      return;
    }

    // Route 1B: GET /api/simulation
    if (pathname === '/api/simulation') {
      sendJsonResponse(res, 200, {
        executionMode: 'PAPER',
        liveTradingActive: false,
        liveTradingStatus: 'DISABLED',
        simulationActive: true,
        killSwitchState: getKillSwitchState(),
        auditLogsCount: getSimulationAuditLogs().length,
        maxSlippagePercent: config.maxSlippagePercent,
        maxPositionSizeUsd: config.maxPositionSizeUsd,
        maxDailyLossUsd: config.maxDailyLossUsd
      });
      return;
    }

    // Route 1C: GET /api/simulation/logs
    if (pathname === '/api/simulation/logs') {
      const logs = getSimulationAuditLogs();
      sendJsonResponse(res, 200, {
        count: logs.length,
        logs
      });
      return;
    }

    // Route 1D: GET /api/safety-gate
    if (pathname === '/api/safety-gate') {
      sendJsonResponse(res, 200, {
        executionMode: config.tradingMode || 'PAPER',
        safetyGateStatus: 'ACTIVE',
        liveTradingStatus: 'DISABLED',
        killSwitchState: getKillSwitchState(),
        configurationValid: isSafetyConfigurationValid(),
        totalSafetyChecks: 13,
        readinessNotice: 'Pre-execution safety gate active. Real trading execution remains LOCKED.'
      });
      return;
    }

    // Route 2: GET /api/candidates
    if (pathname === '/api/candidates') {
      const candidates = getCandidates();
      sendJsonResponse(res, 200, {
        count: candidates.length,
        candidates
      });
      return;
    }

    // Route 3: GET /api/active-trade
    if (pathname === '/api/active-trade') {
      const activeTradeData = getActiveTrade();
      sendJsonResponse(res, 200, activeTradeData);
      return;
    }

    // Route 4: GET /api/risk
    if (pathname === '/api/risk') {
      const portfolio = getPortfolioState();
      const nowMs = Date.now();

      // Compute rolling trade counts
      const oneHourAgoMs = nowMs - (60 * 60 * 1000);
      const tradesLastHour = portfolio.recentTradeTimes.filter(t => t >= oneHourAgoMs).length;

      const oneDayAgoMs = nowMs - (24 * 60 * 60 * 1000);
      const tradesLastDay = portfolio.recentTradeTimes.filter(t => t >= oneDayAgoMs).length;

      // Compute cooldown status
      const cooldownMs = config.cooldownAfterLossMinutes * 60 * 1000;
      let cooldownActive = false;
      let cooldownRemainingSeconds = 0;

      if (portfolio.lastLosingTradeTimeMs > 0) {
        const elapsedSinceLoss = nowMs - portfolio.lastLosingTradeTimeMs;
        if (elapsedSinceLoss < cooldownMs) {
          cooldownActive = true;
          cooldownRemainingSeconds = Math.ceil((cooldownMs - elapsedSinceLoss) / 1000);
        }
      }

      sendJsonResponse(res, 200, {
        hourlyTrades: tradesLastHour,
        dailyTrades: tradesLastDay,
        dailyPnlUsd: portfolio.dailyPnlUsd,
        totalPnlUsd: portfolio.totalPnlUsd,
        consecutiveLosses: portfolio.consecutiveLosses,
        circuitBreakerActive: portfolio.circuitBreakerActive,
        cooldownActive,
        cooldownRemainingSeconds,
        currentEquity: portfolio.currentEquity,
        activeTokenCount: portfolio.activeTokenAddresses.size,
        tradingMode: config.tradingMode || 'PAPER',
        liveTradingStatus: 'DISABLED',
        emergencyKillSwitch: Boolean(config.emergencyKillSwitch),
        limits: {
          minLiquidityUsd: config.minLiquidityUsd,
          min5mVolumeUsd: config.min5mVolumeUsd,
          minStrategyScore: config.minStrategyScore,
          maxRiskScore: config.maxRiskScore,
          maxTradesPerHour: config.maxTradesPerHour,
          maxTradesPerDay: config.maxTradesPerDay,
          maxDailyLossUsd: config.maxDailyLossUsd,
          cooldownAfterLossMinutes: config.cooldownAfterLossMinutes,
          maxConsecutiveLosses: config.maxConsecutiveLosses,
          minPositionSizeUsd: config.minPositionSizeUsd,
          maxPositionSizeUsd: config.maxPositionSizeUsd,
          maxPositionLiquidityPercent: config.maxPositionLiquidityPercent,
          maxSlippagePercent: config.maxSlippagePercent || 1.0
        }
      });
      return;
    }

    // Route 5: GET /api/trades
    if (pathname === '/api/trades') {
      const history = getTradeHistory();
      sendJsonResponse(res, 200, {
        count: history.length,
        trades: history
      });
      return;
    }

    // Route 6: GET /api/performance
    if (pathname === '/api/performance') {
      const history = getTradeHistory();
      const genuineTrades = history.filter(isGenuineMarketTrade);
      // Analyze genuine market trades if present, fallback to history if no genuine trades exist
      const targetTrades = genuineTrades.length > 0 ? genuineTrades : history;
      const analytics = calculatePerformanceAnalytics(targetTrades);
      const candidates = getCandidates();
      const approvedCandidates = candidates.filter(c => (c.riskManager && c.riskManager.approved) || (c.decision === 'APPROVED'));
      const rejectedCandidatesCount = candidates.length - approvedCandidates.length;

      sendJsonResponse(res, 200, {
        ...analytics,
        candidateAnalysis: {
          totalEvaluated: candidates.length,
          approvedCount: approvedCandidates.length,
          rejectedCount: rejectedCandidatesCount
        }
      });
      return;
    }

    // Route 7: GET /api/validation
    if (pathname === '/api/validation') {
      const nowMs = Date.now();
      const uptimeSeconds = Math.floor((nowMs - startTimeMs) / 1000);
      const hours = Math.floor(uptimeSeconds / 3600);
      const mins = Math.floor((uptimeSeconds % 3600) / 60);
      const secs = uptimeSeconds % 60;
      const durationStr = `${String(hours).padStart(2, '0')}h ${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;

      const history = getTradeHistory();
      const genuineMarketTrades = history.filter(isGenuineMarketTrade);
      const legacyTestTrades = history.filter(t => !isGenuineMarketTrade(t));

      const marketTradeCount = genuineMarketTrades.length;
      const wins = genuineMarketTrades.filter(t => (t.pnl || 0) > 0).length;
      const sessionWinRate = marketTradeCount > 0 ? Number(((wins / marketTradeCount) * 100).toFixed(2)) : 0;
      const sessionPnlUsd = Number(genuineMarketTrades.reduce((sum, t) => sum + (t.pnl || 0), 0).toFixed(4));

      const targetMin = 100;
      const targetRec = 200;
      const progressMinPercent = Math.min(100, Number(((marketTradeCount / targetMin) * 100).toFixed(1)));
      const progressRecPercent = Math.min(100, Number(((marketTradeCount / targetRec) * 100).toFixed(1)));

      const isCompleted = marketTradeCount >= targetMin;
      const statusStr = isCompleted ? 'COMPLETE' : 'IN_PROGRESS';

      sendJsonResponse(res, 200, {
        completed: isCompleted,
        status: statusStr,
        target: targetMin,
        genuineTrades: marketTradeCount,
        targetTrades: targetMin,
        sessionStatus: isCompleted ? 'COMPLETED' : 'IN_PROGRESS',
        sessionStartTime: new Date(startTimeMs).toISOString(),
        sessionDurationSeconds: uptimeSeconds,
        sessionDurationStr: durationStr,
        targetMinimum: targetMin,
        targetRecommended: targetRec,
        marketPaperTrades: marketTradeCount,
        progressMinimumPercent: progressMinPercent,
        progressRecommendedPercent: progressRecPercent,
        sessionWinRate,
        sessionPnlUsd,
        historicalTotalTrades: history.length,
        legacyTestTradesExcluded: legacyTestTrades.length,
        genuineMarketTradesCount: marketTradeCount,
        remainingTo100: Math.max(0, targetMin - marketTradeCount),
        remainingTo200: Math.max(0, targetRec - marketTradeCount)
      });
      return;
    }

    // If route starts with /api/, return API 404
    if (pathname.startsWith('/api/')) {
      sendJsonResponse(res, 404, {
        error: 'Not Found',
        message: `Unknown API endpoint: ${pathname}`
      });
      return;
    }

    // Serve static frontend assets from public/
    let reqPath = pathname === '/' ? '/index.html' : pathname;
    const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
    const filePath = path.join(PUBLIC_DIR, safePath);

    if (filePath.startsWith(PUBLIC_DIR) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon'
      };
      const contentType = mimeTypes[ext] || 'application/octet-stream';
      const content = fs.readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      res.end(content);
      return;
    }

    // If file not found in public/, fallback to index.html for single-page routing or 404
    const indexPath = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      const content = fs.readFileSync(indexPath);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      res.end(content);
      return;
    }

    sendJsonResponse(res, 404, {
      error: 'Not Found',
      message: `File not found: ${pathname}`
    });
  } catch (err) {
    // Safe error handling: Log internally without crashing bot or leaking internal details
    console.error('[ERROR] Dashboard API request error:', err.message);
    sendJsonResponse(res, 500, {
      error: 'Internal Server Error',
      message: 'Failed to process dashboard API request safely.'
    });
  }
}

/**
 * Starts the read-only dashboard HTTP API server.
 * 
 * @param {number} [portOverride] - Optional port number override
 * @returns {Promise<{ server: http.Server, port: number, stopServer: Function }>}
 */
export function startDashboardServer(portOverride = null) {
  const port = portOverride || config.port || 3000;
  startTimeMs = Date.now();

  return new Promise((resolve, reject) => {
    try {
      serverInstance = http.createServer(handleApiRequest);

      serverInstance.on('error', (err) => {
        console.error(`[ERROR] Dashboard API server error on port ${port}:`, err.message);
        reject(err);
      });

      serverInstance.listen(port, () => {
        console.log('====================================================');
        console.log(`[INFO] Read-Only Dashboard API running on port ${port}`);
        console.log(`[INFO] Endpoints: /api/status, /api/candidates, /api/active-trade, /api/risk, /api/trades`);
        console.log('====================================================');

        const stopServer = () => {
          if (serverInstance) {
            serverInstance.close();
            serverInstance = null;
          }
        };

        resolve({ server: serverInstance, port, stopServer });
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Stops the dashboard HTTP server cleanly.
 */
export function stopDashboardServer() {
  if (serverInstance) {
    serverInstance.close();
    serverInstance = null;
    console.log('[INFO] Dashboard API server stopped.');
  }
}
