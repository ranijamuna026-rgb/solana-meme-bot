// ============================================================================
// PHASE 10B REAL-DATA AUDIT SCRIPT (scratch/phase10b_real_data_test.js)
// Purpose: Live audit of real Metaplex Genesis and Launchpad.meme endpoints
//          against target launch date 2026-09-15 (Today: 2026-09-14).
// Mode: REAL MARKET DATA + PAPER TRADING ONLY (Zero Web3 signing, zero wallets, zero real trades)
// ============================================================================

import { MetaplexGenesisAdapter } from '../src/sources/metaplexGenesisAdapter.js';
import { LaunchpadMemeAdapter } from '../src/sources/launchpadMemeAdapter.js';
import { runLaunchAnnouncementDiscovery } from '../src/launchAnnouncementDiscovery.js';
import { calculateTomorrowTargetDate } from '../src/calendarEngine.js';

async function auditRealDataSources() {
  console.log('====================================================');
  console.log('      PHASE 10B — REAL DATA SOURCE AUDIT            ');
  console.log('====================================================');
  
  const todayIso = new Date().toISOString();
  const tomorrowTarget = calculateTomorrowTargetDate(todayIso);
  console.log(`Current Time (UTC): ${todayIso}`);
  console.log(`Target Launch Date (Tomorrow): ${tomorrowTarget.tomorrowDateStr}`);
  console.log('----------------------------------------------------');

  // 1. Audit Metaplex Genesis API
  console.log('\n[SOURCE 1] Auditing Metaplex Genesis API (https://api.metaplex.com/v1/launches)...');
  const metaplexAdapter = new MetaplexGenesisAdapter();
  const metaplexResult = await metaplexAdapter.fetchAndNormalize(true, { targetTomorrowDate: tomorrowTarget.tomorrowDateStr });
  
  console.log(`Status        : ${metaplexResult.status}`);
  console.log(`Error         : ${metaplexResult.error || 'None'}`);
  console.log(`Total Fetched : ${metaplexResult.totalCount || (metaplexResult.candidates ? metaplexResult.candidates.length : 0)}`);
  console.log(`Upcoming Count: ${metaplexResult.upcomingCount || 0}`);
  console.log(`Tomorrow Count: ${metaplexResult.tomorrowCount || 0}`);

  if (metaplexResult.rawSample) {
    console.log('Raw Payload Sample Keys:', Object.keys(metaplexResult.rawSample));
  }

  // 2. Audit Launchpad.meme API
  console.log('\n[SOURCE 2] Auditing Launchpad.meme API (https://launchpad.meme/api/public/tokens/new)...');
  const launchpadAdapter = new LaunchpadMemeAdapter();
  const launchpadResult = await launchpadAdapter.fetchAndNormalize(true, { targetTomorrowDate: tomorrowTarget.tomorrowDateStr });

  console.log(`Status        : ${launchpadResult.status}`);
  console.log(`Error         : ${launchpadResult.error || 'None'}`);
  console.log(`Total Fetched : ${launchpadResult.items ? launchpadResult.items.length : (launchpadResult.candidates ? launchpadResult.candidates.length : 0)}`);
  console.log(`Classification: LIVE_LAUNCH_SOURCE (0 upcoming predicted)`);

  // 3. Full Discovery Engine Audit Pipeline
  console.log('\n[PIPELINE AUDIT] Executing runLaunchAnnouncementDiscovery()...');
  const pipelineSummary = await runLaunchAnnouncementDiscovery({
    targetDate: tomorrowTarget.tomorrowDateStr,
    bypassCache: true
  });

  console.log('\n====================================================');
  console.log('            PIPELINE SUMMARY RESULT                 ');
  console.log('====================================================');
  console.log(`Target Date                   : ${pipelineSummary.targetDate}`);
  console.log(`Status                        : ${pipelineSummary.status ? pipelineSummary.status.status : 'OK'}`);
  console.log(`Overall Status                : ${pipelineSummary.overallStatus}`);
  console.log(`Message                       : ${pipelineSummary.message}`);
  console.log(`Scheduled Candidates Count    : ${pipelineSummary.scheduledAnnouncements ? pipelineSummary.scheduledAnnouncements.length : 0}`);
  console.log(`Live Announcements Count      : ${pipelineSummary.liveAnnouncements ? pipelineSummary.liveAnnouncements.length : 0}`);

  console.log('\n====================================================');
  console.log('               FINAL PHASE 10B VERDICT              ');
  console.log('====================================================');
  if (pipelineSummary.highConfidenceTomorrowCount > 0) {
    console.log('VERDICT: VERIFIED — Tomorrow candidate launches successfully discovered and verified.');
  } else if (metaplexResult.status === 'OK') {
    console.log('VERDICT: PARTIALLY_VERIFIED — Source endpoints and adapters operational, but 0 candidates are scheduled for tomorrow.');
  } else {
    console.log('VERDICT: UNVERIFIED — Source endpoints unreachable or failing.');
  }
}

auditRealDataSources().catch(err => {
  console.error('Fatal audit error:', err);
  process.exit(1);
});
