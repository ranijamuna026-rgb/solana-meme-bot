// ============================================================================
// PHASE 10C SOURCE RESEARCH SCRIPT (scratch/phase10c_research.js)
// Purpose: Live empirical audit of official Solana launchpad and calendar feeds.
// Mode: REAL MARKET DATA + PAPER TRADING ONLY (Zero Web3 signing, zero wallets, zero real trades)
// ============================================================================

async function auditPhase10cSources() {
  console.log('====================================================');
  console.log(' PHASE 10C — OFFICIAL FUTURE LAUNCH SOURCE RESEARCH ');
  console.log('====================================================\n');

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  console.log(`Current Time (UTC): ${nowIso}`);
  console.log(`Target Today Date  : 2026-09-14`);
  console.log(`Target Tomorrow Date: 2026-09-15`);
  console.log('----------------------------------------------------\n');

  const sourcesToAudit = [
    {
      name: 'PinkSale Solana Launchpad API',
      url: 'https://api.pinksale.finance/api/v1/pool/list?chain=SOLANA',
      officialUrl: 'https://www.pinksale.finance/launchpads?chain=SOLANA'
    },
    {
      name: 'Solanium Launchpad Projects API',
      url: 'https://api.solanium.io/v1/projects',
      officialUrl: 'https://www.solanium.io'
    },
    {
      name: 'Streamflow Token Sales / Vesting API',
      url: 'https://api.streamflow.finance/v1/launches',
      officialUrl: 'https://streamflow.finance'
    },
    {
      name: 'CoinMarketCap Upcoming ICO Calendar API',
      url: 'https://api.coinmarketcap.com/data-api/v3/calendar/ico/upcoming?chain=solana',
      officialUrl: 'https://coinmarketcap.com/ico-calendar/'
    },
    {
      name: 'CoinGecko Coins / Categories Feed',
      url: 'https://api.coingecko.com/api/v3/coins/categories',
      officialUrl: 'https://www.coingecko.com'
    },
    {
      name: 'SolanaFloor Public Launchpad Feed',
      url: 'https://api.solanafloor.com/v1/launches',
      officialUrl: 'https://solanafloor.com'
    },
    {
      name: 'DexScreener Latest Token Profiles API',
      url: 'https://api.dexscreener.com/token-profiles/latest/v1',
      officialUrl: 'https://dexscreener.com'
    }
  ];

  const results = [];

  for (const src of sourcesToAudit) {
    console.log(`[AUDITING] ${src.name} (${src.url})...`);
    let status = 'UNREACHABLE';
    let accessible = false;
    let itemsCount = 0;
    let sampleKeys = [];
    let futureRecordObserved = false;
    let sampleUpcomingRecord = null;
    let rawError = null;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(src.url, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'SolanaMemeBotAudit/1.0' },
        signal: controller.signal
      });
      clearTimeout(timeout);

      status = `${res.status} ${res.statusText}`;

      if (res.ok) {
        accessible = true;
        const data = await res.json();
        const items = Array.isArray(data) ? data : (data.data || data.pools || data.projects || data.launches || []);
        itemsCount = Array.isArray(items) ? items.length : (data ? 1 : 0);

        if (Array.isArray(items) && items.length > 0) {
          sampleKeys = Object.keys(items[0]);

          // Scan items for explicit future timestamps
          for (const item of items) {
            const startTimeStr = item.startTime || item.startDate || item.poolStart || item.launchDate || item.start_time || null;
            if (startTimeStr) {
              const startMs = new Date(startTimeStr).getTime();
              if (!isNaN(startMs) && startMs > nowMs) {
                futureRecordObserved = true;
                sampleUpcomingRecord = item;
                break;
              }
            }
          }
        }
      }
    } catch (err) {
      rawError = err.message;
    }

    console.log(`  Accessible         : ${accessible ? 'YES' : 'NO'} (${status})`);
    console.log(`  Returned Items     : ${itemsCount}`);
    console.log(`  Sample Keys        : ${sampleKeys.join(', ') || 'None'}`);
    console.log(`  Future Record Seen : ${futureRecordObserved ? 'YES' : 'NO'}`);
    if (rawError) console.log(`  Error              : ${rawError}`);
    console.log('----------------------------------------------------\n');

    results.push({
      ...src,
      status,
      accessible,
      itemsCount,
      sampleKeys,
      futureRecordObserved,
      sampleUpcomingRecord
    });
  }

  console.log('\n====================================================');
  console.log('                SUMMARY OF RESEARCH                 ');
  console.log('====================================================');
  for (const r of results) {
    console.log(`${r.name.padEnd(40)} | Accessible: ${r.accessible ? 'YES' : 'NO'} | Future Rec: ${r.futureRecordObserved ? 'YES' : 'NO'}`);
  }
}

auditPhase10cSources().catch(err => {
  console.error('Fatal audit error:', err);
});
