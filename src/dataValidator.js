// ============================================================================
// BACKTEST DATA VALIDATOR MODULE (src/dataValidator.js)
// Purpose: Validates, cleans, and sorts historical price datasets for backtesting
// ============================================================================

/**
 * Validates and cleans raw market data records before backtesting.
 * 
 * Rejects records with:
 * - Missing or invalid timestamps
 * - Missing or empty token names/symbols
 * - Missing, non-numeric, zero, or negative prices
 * - NaN or Infinity values
 * 
 * Sorts records chronologically per token and removes duplicate timestamp entries.
 * 
 * @param {Array<Object>} rawRecords - Raw market data array from JSON fixture
 * @returns {{ validRecordsByToken: Map<string, Array<Object>>, validRecordsCount: number, rejectedCount: number, warnings: Array<string> }}
 */
export function validateBacktestData(rawRecords) {
  const warnings = [];
  const validRecordsByToken = new Map();
  let validRecordsCount = 0;
  let rejectedCount = 0;

  if (!Array.isArray(rawRecords) || rawRecords.length === 0) {
    warnings.push('Backtest dataset is empty or not an array');
    return { validRecordsByToken, validRecordsCount: 0, rejectedCount: 0, warnings };
  }

  for (let i = 0; i < rawRecords.length; i++) {
    const rec = rawRecords[i];
    const recordId = `Record #${i + 1}`;

    if (!rec || typeof rec !== 'object') {
      rejectedCount++;
      warnings.push(`${recordId}: Invalid non-object record skipped`);
      continue;
    }

    // 1. Validate Token Symbol / Name
    const tokenSymbol = (rec.token || rec.symbol || '').toString().trim();
    if (!tokenSymbol) {
      rejectedCount++;
      warnings.push(`${recordId}: Missing token symbol`);
      continue;
    }

    // 2. Validate Price
    const price = Number(rec.price);
    if (rec.price === undefined || rec.price === null || isNaN(price) || !isFinite(price) || price <= 0) {
      rejectedCount++;
      warnings.push(`${recordId} (${tokenSymbol}): Invalid price value (${rec.price})`);
      continue;
    }

    // 3. Validate Timestamp
    if (!rec.timestamp) {
      rejectedCount++;
      warnings.push(`${recordId} (${tokenSymbol}): Missing timestamp`);
      continue;
    }

    const timeMs = new Date(rec.timestamp).getTime();
    if (isNaN(timeMs)) {
      rejectedCount++;
      warnings.push(`${recordId} (${tokenSymbol}): Invalid timestamp string (${rec.timestamp})`);
      continue;
    }

    const cleanRecord = {
      timestamp: new Date(timeMs).toISOString(),
      timeMs,
      token: tokenSymbol,
      symbol: tokenSymbol,
      price
    };

    if (!validRecordsByToken.has(tokenSymbol)) {
      validRecordsByToken.set(tokenSymbol, []);
    }
    validRecordsByToken.get(tokenSymbol).push(cleanRecord);
    validRecordsCount++;
  }

  // Sort and deduplicate timestamps per token
  for (const [symbol, ticks] of validRecordsByToken.entries()) {
    // Sort chronologically ascending by timestamp
    ticks.sort((a, b) => a.timeMs - b.timeMs);

    // Deduplicate identical timestamps per token
    const uniqueTicks = [];
    const seenTimes = new Set();

    for (const tick of ticks) {
      if (seenTimes.has(tick.timeMs)) {
        rejectedCount++;
        warnings.push(`Token ${symbol}: Duplicate timestamp ${tick.timestamp} ignored`);
        continue;
      }
      seenTimes.add(tick.timeMs);
      uniqueTicks.push(tick);
    }

    validRecordsByToken.set(symbol, uniqueTicks);
  }

  return {
    validRecordsByToken,
    validRecordsCount,
    rejectedCount,
    warnings
  };
}
