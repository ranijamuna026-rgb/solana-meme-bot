import { startDashboardServer, stopDashboardServer } from '../src/server.js';
import { getTradeHistory, isGenuineMarketTrade } from '../src/paperTrader.js';

const PORT = 3095;
await startDashboardServer(PORT);
const BASE = `http://localhost:${PORT}`;

try {
  const statusRes = await fetch(`${BASE}/api/status`).then(r => r.json());
  const valRes = await fetch(`${BASE}/api/validation`).then(r => r.json());
  const perfRes = await fetch(`${BASE}/api/performance`).then(r => r.json());
  const tradesRes = await fetch(`${BASE}/api/trades`).then(r => r.json());

  console.log('=== API HEALTH CHECK ===');
  console.log('Status API               :', statusRes.status, statusRes.mode);
  console.log('Validation API Genuine   :', valRes.marketPaperTrades);
  console.log('Validation API Session PnL:', valRes.sessionPnlUsd);
  console.log('Validation API Win Rate  :', valRes.sessionWinRate);
  console.log('Performance API Total    :', perfRes.totalTrades);
  console.log('Performance API Net PnL  :', perfRes.netPnlUsd);
  console.log('Trades API Count         :', tradesRes.count);
  console.log('Genuine Count in File    :', getTradeHistory().filter(isGenuineMarketTrade).length);
} finally {
  stopDashboardServer();
}
