// ============================================================================
// FRESH LIVE AUDIT & RESEARCH SCRIPT (scratch/phase10b_final_audit.js)
// Purpose: Live audit of Metaplex API and research of potential Solana launch sources.
// Mode: REAL MARKET DATA + PAPER TRADING ONLY (Zero Web3 signing, zero wallets, zero real trades)
// ============================================================================

async function runFinalAuditAndResearch() {
  console.log('====================================================');
  console.log('  PHASE 10B — FRESH LIVE AUDIT & SOURCE RESEARCH    ');
  console.log('====================================================\n');

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  console.log(`Audit Timestamp (UTC): ${nowIso}`);
  console.log(`Target Today Date     : 2026-09-14`);
  console.log(`Target Tomorrow Date  : 2026-09-15`);
  console.log('----------------------------------------------------\n');

  // ==========================================================================
  // PART 1 & 2: METAPLEX GENESIS API FRESH AUDIT
  // ==========================================================================
  console.log('[SECTION A: METAPLEX API AUDIT]');
  
  let metaplexReachable = false;
  let upcomingStatusCount = 0;
  let validFutureStartTimeCount = 0;
  let realTomorrowCount = 0;
  let matchingRecords = [];

  try {
    const res = await fetch('https://api.metaplex.com/v1/launches', {
      headers: { 'Accept': 'application/json' }
    });
    
    if (res.ok) {
      metaplexReachable = true;
      const data = await res.json();
      const items = Array.isArray(data) ? data : (data.data || data.launches || []);
      console.log(`[METAPLEX] Total records returned from /v1/launches: ${items.length}`);

      for (const item of items) {
        const launch = item.launch || item;
        const baseToken = item.baseToken || item.token || {};
        const status = launch.status;
        const startTime = launch.startTime;

        if (status === 'upcoming') {
          upcomingStatusCount++;
        }

        if (startTime) {
          const startTimeMs = new Date(startTime).getTime();
          if (!isNaN(startTimeMs) && startTimeMs > nowMs && status === 'upcoming') {
            validFutureStartTimeCount++;

            // Calculate UTC calendar date
            const dateStr = new Date(startTimeMs).toISOString().split('T')[0];
            let classification = 'FUTURE_FAR';
            if (dateStr === '2026-09-15') {
              classification = 'TOMORROW';
              realTomorrowCount++;
            } else if (dateStr === '2026-09-14') {
              classification = 'TODAY';
            } else if (startTimeMs < nowMs) {
              classification = 'PAST';
            }

            matchingRecords.push({
              status: launch.status,
              startTime: launch.startTime,
              endTime: launch.endTime,
              genesisAddress: launch.genesisAddress || null,
              baseTokenAddress: baseToken.address || null,
              baseTokenName: baseToken.name || null,
              baseTokenSymbol: baseToken.symbol || null,
              launchPage: launch.launchPage || item.website || null,
              utcDateStr: dateStr,
              classification
            });
          }
        }
      }
    }
  } catch (err) {
    console.error('[METAPLEX] Fetch error:', err.message);
  }

  console.log(`Metaplex Reachable                  : ${metaplexReachable ? 'YES' : 'NO'}`);
  console.log(`Upcoming Records Returned           : ${upcomingStatusCount}`);
  console.log(`Upcoming Records with Future startTime: ${validFutureStartTimeCount}`);
  console.log(`Real TOMORROW Candidates Found      : ${realTomorrowCount}`);

  if (matchingRecords.length > 0) {
    console.log('\n[MATCHING REAL UPCOMING RECORDS FOUND]:');
    console.log(JSON.stringify(matchingRecords, null, 2));
  } else {
    console.log('\nResult: NO_VERIFIED_UPCOMING_RECORD (0 records currently have status="upcoming" with valid future startTime)');
  }

  // ==========================================================================
  // SECTION B: NEXT SOURCES RESEARCH
  // ==========================================================================
  console.log('\n====================================================');
  console.log('[SECTION B: NEXT SOURCES LIVE RESEARCH]');
  console.log('====================================================\n');

  // 1. Launchpad.meme API
  console.log('--- 1. Launchpad.meme API ---');
  try {
    const resLp = await fetch('https://launchpad.meme/api/public/tokens/new', { headers: { 'Accept': 'application/json' } });
    console.log(`HTTP Status: ${resLp.status}`);
    if (resLp.ok) {
      const dataLp = await resLp.json();
      console.log(`Returned Items: ${Array.isArray(dataLp) ? dataLp.length : 0}`);
      if (Array.isArray(dataLp) && dataLp.length > 0) {
        console.log('Sample Item Keys:', Object.keys(dataLp[0]));
        console.log('Sample Item Status/Type:', dataLp[0].status, dataLp[0].type);
      }
    }
  } catch (err) {
    console.log('Launchpad.meme fetch failed:', err.message);
  }

  // 2. DexScreener Profiles API
  console.log('\n--- 2. DexScreener Profiles API ---');
  try {
    const resDex = await fetch('https://api.dexscreener.com/token-profiles/latest/v1', { headers: { 'Accept': 'application/json' } });
    console.log(`HTTP Status: ${resDex.status}`);
    if (resDex.ok) {
      const dataDex = await resDex.json();
      console.log(`Returned Items: ${Array.isArray(dataDex) ? dataDex.length : 0}`);
      if (Array.isArray(dataDex) && dataDex.length > 0) {
        console.log('Sample Item Keys:', Object.keys(dataDex[0]));
      }
    }
  } catch (err) {
    console.log('DexScreener fetch failed:', err.message);
  }

  // 3. Pump.fun Latest Feed
  console.log('\n--- 3. Pump.fun Latest Feed ---');
  try {
    const resPump = await fetch('https://frontend-api.pump.fun/coins/latest', { headers: { 'Accept': 'application/json' } });
    console.log(`HTTP Status: ${resPump.status}`);
    if (resPump.ok) {
      const dataPump = await resPump.json();
      console.log(`Returned Items: ${Array.isArray(dataPump) ? dataPump.length : 0}`);
      if (Array.isArray(dataPump) && dataPump.length > 0) {
        console.log('Sample Item Keys:', Object.keys(dataPump[0]));
      }
    }
  } catch (err) {
    console.log('Pump.fun fetch failed:', err.message);
  }

  // 4. Raydium / Jupiter / Solanium public APIs
  console.log('\n--- 4. Raydium Pools API ---');
  try {
    const resRay = await fetch('https://api-v3.raydium.io/pools/info/list?poolType=all&poolSort=default&pageSize=5&page=1', { headers: { 'Accept': 'application/json' } });
    console.log(`Raydium HTTP Status: ${resRay.status}`);
  } catch (err) {
    console.log('Raydium fetch failed:', err.message);
  }

  console.log('\n--- 5. Solana Floor / Ecosystem Calendar ---');
  try {
    const resSf = await fetch('https://solanafloor.com/api/nft/launchpad/upcoming', { headers: { 'Accept': 'application/json' } });
    console.log(`SolanaFloor HTTP Status: ${resSf.status}`);
  } catch (err) {
    console.log('SolanaFloor fetch failed:', err.message);
  }
}

runFinalAuditAndResearch().catch(err => {
  console.error('Fatal audit error:', err);
});
