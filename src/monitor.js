// ============================================================================
// TOKEN MONITORING MODULE (src/monitor.js)
// Purpose: Detects newly launched Solana memecoins and collects market data
// ============================================================================

import { config } from './config.js';

// JavaScript Set to store token addresses we have already processed.
// A Set ensures we never process or log the exact same token repeatedly.
const seenTokens = new Set();

/**
 * Formats a raw number or string into a clean currency string (e.g. $1,234.56).
 * Handles missing or invalid numbers safely.
 * 
 * @param {number|string} val - Value to format
 * @returns {string} Formatted string
 */
function formatUsd(val) {
  if (val === undefined || val === null || isNaN(Number(val))) return 'N/A';
  return '$' + Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

/**
 * Fetches detailed market data for a specific Solana token address from DexScreener API.
 * 
 * @param {string} tokenAddress - The Solana mint address of the token
 * @returns {Promise<Object|null>} Token market data object or null if failed
 */
export async function fetchTokenMarketDetails(tokenAddress) {
  try {
    const url = `${config.dexscreenerApiUrl}/latest/dex/tokens/${tokenAddress}`;
    const response = await fetch(url);

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    // If no trading pair is found for this token address, return null
    if (!data.pairs || data.pairs.length === 0) {
      return null;
    }

    // Filter for Solana pairs only
    const solanaPairs = data.pairs.filter(p => p.chainId === 'solana');
    if (solanaPairs.length === 0) return null;

    // Pick the primary trading pair (highest liquidity pair)
    const mainPair = solanaPairs.reduce((best, current) => {
      const bestLiq = best.liquidity?.usd || 0;
      const currentLiq = current.liquidity?.usd || 0;
      return currentLiq > bestLiq ? current : best;
    }, solanaPairs[0]);

    // Calculate token age / launch time
    const launchTimestamp = mainPair.pairCreatedAt;
    let launchTimeString = 'N/A';
    let ageMinutes = null;
    if (launchTimestamp) {
      const launchDate = new Date(launchTimestamp);
      ageMinutes = Math.floor((Date.now() - launchTimestamp) / (1000 * 60));
      launchTimeString = `${launchDate.toISOString()} (${ageMinutes} min ago)`;
    }

    // Extract available data fields without inventing data
    return {
      address: tokenAddress,
      pairAddress: mainPair.pairAddress || 'N/A',
      name: mainPair.baseToken?.name || 'Unknown',
      symbol: mainPair.baseToken?.symbol || 'UNKNOWN',
      launchTime: launchTimeString,
      ageMinutes: ageMinutes,
      pairCreatedAt: launchTimestamp || null,
      liquidityUsd: mainPair.liquidity?.usd ?? null,
      liquidity: mainPair.liquidity?.usd !== undefined ? formatUsd(mainPair.liquidity.usd) : 'N/A',
      priceUsd: mainPair.priceUsd ? parseFloat(mainPair.priceUsd) : null,
      price: mainPair.priceUsd ? formatUsd(mainPair.priceUsd) : 'N/A',
      volume5mUsd: mainPair.volume?.m5 ?? null,
      volume5m: mainPair.volume?.m5 !== undefined ? formatUsd(mainPair.volume.m5) : 'N/A',
      volume24h: mainPair.volume?.h24 !== undefined ? formatUsd(mainPair.volume.h24) : 'N/A',
      buys5m: mainPair.txns?.m5?.buys ?? null,
      sells5m: mainPair.txns?.m5?.sells ?? null,
      buys24h: mainPair.txns?.h24?.buys ?? null,
      sells24h: mainPair.txns?.h24?.sells ?? null,
      // Holders field is not provided by DexScreener public endpoint
      holders: 'N/A (Not provided by API)',
      dexUrl: mainPair.url || 'N/A'
    };
  } catch (error) {
    // Gracefully catch network errors or parsing exceptions
    console.error(`[WARN] Failed to fetch market details for ${tokenAddress}:`, error.message);
    return null;
  }
}

/**
 * Scans DexScreener for newly listed Solana token profiles and queries their market data.
 * 
 * @returns {Promise<Array<Object>>} Array of newly detected token info objects
 */
export async function detectNewSolanaTokens() {
  const newTokens = [];

  try {
    // 1. Fetch latest token profiles from DexScreener
    const url = `${config.dexscreenerApiUrl}/token-profiles/latest/v1`;
    const response = await fetch(url);

    if (!response.ok) {
      console.warn(`[WARN] DexScreener API returned HTTP ${response.status}`);
      return newTokens;
    }

    const profiles = await response.json();

    if (!Array.isArray(profiles)) {
      return newTokens;
    }

    // 2. Filter for Solana tokens only
    const solanaProfiles = profiles.filter(p => p.chainId === 'solana' && p.tokenAddress);

    // 3. Loop through detected Solana profiles
    for (const profile of solanaProfiles) {
      const tokenAddress = profile.tokenAddress;

      // Skip if we have already detected and processed this token address
      if (seenTokens.has(tokenAddress)) {
        continue;
      }

      // Mark token as seen immediately to avoid double processing during async operations
      seenTokens.add(tokenAddress);

      // Fetch complete market metrics for this newly detected token
      const details = await fetchTokenMarketDetails(tokenAddress);

      if (details) {
        newTokens.push(details);

        // Display the token log in the requested format
        logNewToken(details);
      }
    }
  } catch (error) {
    console.error('[WARN] Error in detectNewSolanaTokens:', error.message);
  }

  return newTokens;
}

/**
 * Prints a clean terminal summary for a newly detected token.
 * 
 * @param {Object} token - Token details object
 */
function logNewToken(token) {
  console.log('\n========================================');
  console.log('NEW SOLANA TOKEN DETECTED');
  console.log('========================================');
  console.log(`Name       : ${token.name}`);
  console.log(`Symbol     : ${token.symbol}`);
  console.log(`Address    : ${token.address}`);
  console.log(`Launch     : ${token.launchTime}`);
  console.log(`Liquidity  : ${token.liquidity}`);
  console.log(`Price      : ${token.price}`);
  console.log(`Volume     : 5m: ${token.volume5m} | 24h: ${token.volume24h}`);
  console.log(`Buys       : 5m: ${token.buys5m ?? 'N/A'} | 24h: ${token.buys24h ?? 'N/A'}`);
  console.log(`Sells      : 5m: ${token.sells5m ?? 'N/A'} | 24h: ${token.sells24h ?? 'N/A'}`);
  console.log(`Holders    : ${token.holders}`);
  console.log('========================================');
}

/**
 * Starts continuous monitoring loop on a set interval.
 * 
 * @param {Function} [onTokenDetected] - Optional callback function triggered when a new token is found
 */
export function startTokenMonitoring(onTokenDetected) {
  console.log(`[INFO] Token monitoring active! Scanning for new Solana tokens every ${config.pollIntervalMs / 1000}s...`);

  // Execute immediate initial scan
  detectNewSolanaTokens().then(tokens => {
    if (onTokenDetected && tokens.length > 0) {
      tokens.forEach(t => onTokenDetected(t));
    }
  });

  // Set recurring interval timer
  const intervalId = setInterval(async () => {
    const tokens = await detectNewSolanaTokens();
    if (onTokenDetected && tokens.length > 0) {
      tokens.forEach(t => onTokenDetected(t));
    }
  }, config.pollIntervalMs);

  return () => clearInterval(intervalId);
}

