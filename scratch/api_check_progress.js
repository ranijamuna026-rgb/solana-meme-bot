import { startDashboardServer, stopDashboardServer } from '../src/server.js';
import { getTradeHistory, isGenuineMarketTrade } from '../src/paperTrader.js';

const PORT = 3096;
await startDashboardServer(PORT);
const BASE = `http://localhost:${PORT}`;

try {
  const statusRes = await fetch(`${BASE}/api/status`).then(r => r.json());
  const valRes = await fetch(`${BASE}/api/validation`).then(r => r.json());
  const perfRes = await fetch(`${BASE}/api/performance`).then(r => r.json());
  const tradesRes = await fetch(`${BASE}/api/trades`).then(r => r.json());

  console.log('=== API PROGRESS CHECK ===');
  console.log('/api/validation genuine market trades:', valRes.marketPaperTrades);
  console.log('/api/validation session PnL:', valRes.sessionPnlUsd);
  console.log('/api/validation session Win Rate:', valRes.sessionWinRate);
  console.log('/api/performance total trades:', perfRes.totalTrades);
  console.log('/api/performance net PnL:', perfRes.netPnlUsd);
  console.log('/api/trades total records:', tradesRes.count);
  console.log('Genuine trades in file:', getTradeHistory().filter(isGenuineMarketTrade).length);
} finally {
  stopDashboardServer();
}
