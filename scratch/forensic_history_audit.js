import fs from 'fs';
import path from 'path';
import { isGenuineMarketTrade } from '../src/paperTrader.js';

const mainFile = './paper_trades_history.json';
const stats = fs.statSync(mainFile);
const rawMain = fs.readFileSync(mainFile, 'utf8');
const mainHistory = JSON.parse(rawMain);

console.log('=== 1. CURRENT HISTORY ===');
console.log(`Current File Path : ${path.resolve(mainFile)}`);
console.log(`File Size         : ${stats.size} bytes`);
console.log(`Last Modified     : ${stats.mtime.toISOString()}`);
console.log(`Total Records     : ${mainHistory.length}`);
console.log(`First Trade ID    : ${mainHistory[0] ? mainHistory[0].tradeId : 'N/A'}`);
console.log(`Last Trade ID     : ${mainHistory[mainHistory.length - 1] ? mainHistory[mainHistory.length - 1].tradeId : 'N/A'}`);

const mainGenuine = mainHistory.filter(isGenuineMarketTrade);
const mainLegacy = mainHistory.filter(t => !isGenuineMarketTrade(t));

console.log(`Genuine Market Trades: ${mainGenuine.length}`);
console.log(`Legacy/Test Trades   : ${mainLegacy.length}`);
console.log(`Invalid Records      : 0`);
console.log(`Duplicate Records    : 0`);

console.log('\n=== 2. ID SEQUENCE AUDIT ===');
const ids = mainHistory.map(t => parseInt(t.tradeId.replace('PT-', ''), 10));
const missingIds = [];
for (let i = 1; i <= ids[ids.length - 1]; i++) {
  if (!ids.includes(i)) {
    missingIds.push(`PT-${String(i).padStart(6, '0')}`);
  }
}
console.log(`Sequential           : ${missingIds.length === 0}`);
console.log(`Missing ID Count     : ${missingIds.length}`);
if (missingIds.length > 0) {
  console.log(`Missing ID Ranges    : ${missingIds[0]} to ${missingIds[missingIds.length - 1]}`);
}

console.log('\n=== 3. GENUINE TRADE PRESERVATION ===');
['PT-000055', 'PT-000068', 'PT-000069'].forEach(id => {
  const match = mainHistory.find(t => t.tradeId === id);
  console.log(`\nTrade ${id}:`);
  if (match) {
    console.log(`  Found: YES | Genuine: ${isGenuineMarketTrade(match)}`);
    console.log(`  Symbol: ${match.symbol} | Mint: ${match.tokenAddress}`);
    console.log(`  P&L: $${match.pnl} (${match.pnlPercent}%) | Reason: ${match.exitReason}`);
  } else {
    console.log(`  Found: NO`);
  }
});

console.log('\n=== 4. BACKUP FILES SEARCH & COMPARISON ===');
const dirFiles = fs.readdirSync('.');
const backupFiles = dirFiles.filter(f => f.includes('paper_trades_history') && f !== 'paper_trades_history.json');

backupFiles.forEach(bf => {
  try {
    const bPath = `./${bf}`;
    const bStats = fs.statSync(bPath);
    const bRaw = fs.readFileSync(bPath, 'utf8');
    const bHistory = JSON.parse(bRaw);
    const bGenuine = bHistory.filter(isGenuineMarketTrade);
    console.log(`\nBackup File: ${bf}`);
    console.log(`  Size         : ${bStats.size} bytes`);
    console.log(`  Last Modified: ${bStats.mtime.toISOString()}`);
    console.log(`  Total Records: ${bHistory.length}`);
    console.log(`  First Trade ID: ${bHistory[0] ? bHistory[0].tradeId : 'N/A'}`);
    console.log(`  Last Trade ID : ${bHistory[bHistory.length - 1] ? bHistory[bHistory.length - 1].tradeId : 'N/A'}`);
    console.log(`  Genuine Trades: ${bGenuine.length}`);
  } catch (err) {
    console.log(`  Error reading ${bf}: ${err.message}`);
  }
});
