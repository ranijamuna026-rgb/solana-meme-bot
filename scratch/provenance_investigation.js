import fs from 'fs';
import { isGenuineMarketTrade } from '../src/paperTrader.js';

const raw = fs.readFileSync('./paper_trades_history.json', 'utf8');
const history = JSON.parse(raw);

console.log(`Total Records in paper_trades_history.json: ${history.length}`);

const targetIds = ['PT-000055', 'PT-000056', 'PT-000068'];

targetIds.forEach(id => {
  const matches = history.filter(t => t.tradeId === id);
  console.log(`\n=== Inspection for ${id} (Found ${matches.length} record(s)) ===`);
  matches.forEach((t, i) => {
    console.log(`Record #${i + 1}:`);
    console.log(`  Symbol: ${t.symbol}`);
    console.log(`  Name: ${t.tokenName}`);
    console.log(`  Address: ${t.tokenAddress}`);
    console.log(`  Entry Price: ${t.entryPrice}`);
    console.log(`  Exit Price: ${t.exitPrice}`);
    console.log(`  Quantity: ${t.quantity}`);
    console.log(`  Investment: ${t.investment}`);
    console.log(`  P&L: ${t.pnl}`);
    console.log(`  P&L %: ${t.pnlPercent}`);
    console.log(`  Entry Time: ${t.entryTime}`);
    console.log(`  Exit Time: ${t.exitTime}`);
    console.log(`  Exit Reason: ${t.exitReason}`);
    console.log(`  Source: ${t.source}`);
    console.log(`  isGenuineMarketTrade: ${isGenuineMarketTrade(t)}`);
  });
});
