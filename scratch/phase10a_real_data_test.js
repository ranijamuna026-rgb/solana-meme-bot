import { runLaunchAnnouncementDiscovery } from '../src/launchAnnouncementDiscovery.js';

async function performPhase10ARealDataAudit() {
  console.log('====================================================');
  console.log('    PHASE 10A REAL-DATA ANNOUNCEMENT AUDIT SCRIPT   ');
  console.log('====================================================\n');

  const nowMs = Date.now();
  console.log(`Current Run Timestamp: ${new Date(nowMs).toISOString()}`);
  console.log('Target Tomorrow Date: 2026-09-15 (Today: 2026-09-14)');

  const result = await runLaunchAnnouncementDiscovery({ nowMs, timezone: 'UTC', bypassCache: true });

  console.log('\n--- DISCOVERY STATUS ---');
  console.dir(result.status, { depth: null });

  console.log('\n--- REGISTERED SOURCES ACCESSIBILITY ---');
  console.dir(result.sources, { depth: null });

  console.log('\n--- SCHEDULED ANNOUNCEMENTS COUNT ---');
  console.log(`Count: ${result.scheduledAnnouncements.length}`);

  console.log('\n--- LIVE ANNOUNCEMENTS COUNT ---');
  console.log(`Count: ${result.liveAnnouncements.length}`);

  console.log('\n--- OVERALL ENGINE STATUS ---');
  console.log(`Status: ${result.overallStatus}`);
  console.log(`Message: ${result.message}`);
  console.log('====================================================\n');
}

performPhase10ARealDataAudit().catch(console.error);
