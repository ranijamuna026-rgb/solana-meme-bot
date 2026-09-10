import { startDashboardServer, stopDashboardServer } from '../src/server.js';
import { getTradeHistory, isGenuineMarketTrade } from '../src/paperTrader.js';

const PORT = 3097;
await startDashboardServer(PORT);
const BASE = `http://localhost:${PORT}`;

try {
  const statusRes = await fetch(`${BASE}/api/status`).then(r => r.json());
  const candidatesRes = await fetch(`${BASE}/api/candidates`).then(r => r.json());
  const activeTradeRes = await fetch(`${BASE}/api/active-trade`).then(r => r.json());
  const riskRes = await fetch(`${BASE}/api/risk`).then(r => r.json());
  const tradesRes = await fetch(`${BASE}/api/trades`).then(r => r.json());
  const perfRes = await fetch(`${BASE}/api/performance`).then(r => r.json());
  const valRes = await fetch(`${BASE}/api/validation`).then(r => r.json());

  console.log('--- API AUDIT RESULTS ---');
  console.log('/api/status:', JSON.stringify(statusRes, null, 2));
  console.log('\n/api/validation:', JSON.stringify(valRes, null, 2));
  console.log('\n/api/performance:', JSON.stringify(perfRes, null, 2));
  console.log('\n/api/trades count:', tradesRes.length);
  
  // Verify genuine trade count in validation API
  const genuineInFile = getTradeHistory().filter(isGenuineMarketTrade);
  console.log(`\nGenuine Trades in File: ${genuineInFile.length}`);
  console.log(`Validation API Genuine Count: ${valRes.marketPaperTrades}`);
  console.log(`Validation API Session PnL: $${valRes.sessionPnlUsd}`);
  console.log(`Validation API Session Win Rate: ${valRes.sessionWinRate}%`);

} finally {
  stopDashboardServer();
}
