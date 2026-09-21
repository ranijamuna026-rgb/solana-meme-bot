// ============================================================================
// TOKEN MONITORING MODULE (src/monitor.js)
// Purpose: Detects newly launched Solana memecoins and collects market data
// ============================================================================

import { config } from './config.js';

// JavaScript Set to store token addresses we have already processed.
// A Set ensures we never process or log the exact same token repeatedly.
const seenTokens = new Set();
const seenTokensMap = new Map();

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
  // 1. Try DexScreener API first
  try {
    const url = `${config.dexscreenerApiUrl}/latest/dex/tokens/${tokenAddress}`;
    const response = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' } });

    if (response.ok) {
      const data = await response.json();
      if (data.pairs && data.pairs.length > 0) {
        const solanaPairs = data.pairs.filter(p => p.chainId === 'solana');
        if (solanaPairs.length > 0) {
          const mainPair = solanaPairs.reduce((best, current) => {
            const bestLiq = best.liquidity?.usd || 0;
            const currentLiq = current.liquidity?.usd || 0;
            return currentLiq > bestLiq ? current : best;
          }, solanaPairs[0]);

          const launchTimestamp = mainPair.pairCreatedAt;
          let launchTimeString = 'N/A';
          let ageMinutes = null;
          if (launchTimestamp) {
            const launchDate = new Date(launchTimestamp);
            ageMinutes = Math.floor((Date.now() - launchTimestamp) / (1000 * 60));
            launchTimeString = `${launchDate.toISOString()} (${ageMinutes} min ago)`;
          }

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
            holders: 'N/A (Not provided by API)',
            dexUrl: mainPair.url || 'N/A'
          };
        }
      }
    }
  } catch (error) {
    // Silently fall through to GeckoTerminal fallback
  }

  // 2. Fallback to GeckoTerminal API for Solana Mainnet token market details
  try {
    const fallbackUrl = `https://api.geckoterminal.com/api/v2/networks/solana/tokens/${tokenAddress}/pools`;
    const res = await fetch(fallbackUrl, { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' } });
    if (res.ok) {
      const json = await res.json();
      if (json.data && json.data.length > 0) {
        const pool = json.data[0];
        const attr = pool.attributes || {};
        const priceUsd = attr.base_token_price_usd ? parseFloat(attr.base_token_price_usd) : null;
        if (priceUsd && priceUsd > 0) {
          const rawName = attr.name || 'Unknown';
          const nameParts = rawName.split('/');
          const symbol = nameParts[0].trim();
          const launchTimestamp = attr.pool_created_at ? new Date(attr.pool_created_at).getTime() : null;
          let launchTimeString = 'N/A';
          let ageMinutes = null;
          if (launchTimestamp) {
            ageMinutes = Math.floor((Date.now() - launchTimestamp) / (1000 * 60));
            launchTimeString = `${new Date(launchTimestamp).toISOString()} (${ageMinutes} min ago)`;
          }

          const liqUsd = parseFloat(attr.reserve_in_usd || attr.fdv_usd || '0') || null;
          const vol5m = parseFloat(attr.volume_usd?.m5 || '0') || null;
          const vol24h = parseFloat(attr.volume_usd?.h24 || '0') || null;

          return {
            address: tokenAddress,
            pairAddress: attr.address || 'N/A',
            name: symbol,
            symbol: symbol,
            launchTime: launchTimeString,
            ageMinutes: ageMinutes,
            pairCreatedAt: launchTimestamp,
            liquidityUsd: liqUsd,
            liquidity: formatUsd(liqUsd),
            priceUsd: priceUsd,
            price: formatUsd(priceUsd),
            volume5mUsd: vol5m,
            volume5m: formatUsd(vol5m),
            volume24h: formatUsd(vol24h),
            buys5m: attr.transactions?.m5?.buys ?? 0,
            sells5m: attr.transactions?.m5?.sells ?? 0,
            buys24h: attr.transactions?.h24?.buys ?? 0,
            sells24h: attr.transactions?.h24?.sells ?? 0,
            holders: 'N/A (GeckoTerminal)',
            dexUrl: `https://www.geckoterminal.com/solana/pools/${attr.address}`
          };
        }
      }
    }
  } catch (err) {
    console.warn(`[WARN] Failed to fetch market details for ${tokenAddress}:`, err.message);
  }

  return null;
}

export function parseGeckoPoolToDetails(pool) {
  if (!pool || typeof pool !== 'object') return null;
  const baseTokenData = pool.relationships?.base_token?.data;
  if (!baseTokenData || !baseTokenData.id) return null;
  const tokenAddress = baseTokenData.id.replace('solana_', '');
  const attr = pool.attributes || {};
  const priceUsd = attr.base_token_price_usd ? parseFloat(attr.base_token_price_usd) : null;
  if (!priceUsd || priceUsd <= 0) return null;

  const rawName = attr.name || 'Unknown';
  const nameParts = rawName.split('/');
  const symbol = nameParts[0].trim();
  const launchTimestamp = attr.pool_created_at ? new Date(attr.pool_created_at).getTime() : null;
  let launchTimeString = 'N/A';
  let ageMinutes = null;
  if (launchTimestamp) {
    ageMinutes = Math.floor((Date.now() - launchTimestamp) / (1000 * 60));
    launchTimeString = `${new Date(launchTimestamp).toISOString()} (${ageMinutes} min ago)`;
  }

  const liqUsd = parseFloat(attr.reserve_in_usd || attr.fdv_usd || '0') || null;
  const vol5m = parseFloat(attr.volume_usd?.m5 || '0') || null;
  const vol24h = parseFloat(attr.volume_usd?.h24 || '0') || null;

  return {
    address: tokenAddress,
    pairAddress: attr.address || 'N/A',
    name: symbol,
    symbol: symbol,
    launchTime: launchTimeString,
    ageMinutes: ageMinutes,
    pairCreatedAt: launchTimestamp,
    liquidityUsd: liqUsd,
    liquidity: formatUsd(liqUsd),
    priceUsd: priceUsd,
    price: formatUsd(priceUsd),
    volume5mUsd: vol5m,
    volume5m: formatUsd(vol5m),
    volume24h: formatUsd(vol24h),
    buys5m: attr.transactions?.m5?.buys ?? 0,
    sells5m: attr.transactions?.m5?.sells ?? 0,
    buys24h: attr.transactions?.h24?.buys ?? 0,
    sells24h: attr.transactions?.h24?.sells ?? 0,
    holders: 'N/A (GeckoTerminal)',
    dexUrl: `https://www.geckoterminal.com/solana/pools/${attr.address}`
  };
}

/**
 * Scans DexScreener (with GeckoTerminal fallback) for newly listed Solana token profiles and queries their market data.
 * 
 * @returns {Promise<Array<Object>>} Array of newly detected token info objects
 */
export async function detectNewSolanaTokens() {
  const newTokens = [];

  // 1. Try DexScreener token-profiles first
  try {
    const url = `${config.dexscreenerApiUrl}/token-profiles/latest/v1`;
    const response = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' } });

    if (response.ok) {
      const profiles = await response.json();
      if (Array.isArray(profiles)) {
        const solanaProfiles = profiles.filter(p => p.chainId === 'solana' && p.tokenAddress);
        for (const profile of solanaProfiles) {
          const tokenAddress = profile.tokenAddress;
          const lastSeen = seenTokensMap.get(tokenAddress);
          if (lastSeen && Date.now() - lastSeen < 30000) continue;
          seenTokensMap.set(tokenAddress, Date.now());
          const details = await fetchTokenMarketDetails(tokenAddress);
          if (details) {
            newTokens.push(details);
            logNewToken(details);
          }
        }
        if (newTokens.length > 0) return newTokens;
      }
    }
  } catch (error) {
    // Fall through to GeckoTerminal fallback
  }

  // 2. Fallback to GeckoTerminal new_pools and trending_pools API
  const fallbackEndpoints = [
    'https://api.geckoterminal.com/api/v2/networks/solana/new_pools',
    'https://api.geckoterminal.com/api/v2/networks/solana/trending_pools'
  ];

  for (const fallbackUrl of fallbackEndpoints) {
    try {
      const response = await fetch(fallbackUrl, { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' } });
      if (response.ok) {
        const json = await response.json();
        if (json.data && Array.isArray(json.data)) {
          for (const pool of json.data) {
            const details = parseGeckoPoolToDetails(pool);
            if (!details || !details.address) continue;

            const tokenAddress = details.address;
            const lastSeen = seenTokensMap.get(tokenAddress);
            if (lastSeen && Date.now() - lastSeen < 30000) continue;
            seenTokensMap.set(tokenAddress, Date.now());

            newTokens.push(details);
            logNewToken(details);
          }
        }
      }
    } catch (error) {
      // Continue to next endpoint
    }
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

