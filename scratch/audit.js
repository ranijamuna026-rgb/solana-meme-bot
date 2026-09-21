import { runLaunchIntelligence, LAUNCH_SOURCES } from '../src/launchIntelligence.js';

async function performRealDataAudit() {
  console.log('====================================================');
  console.log('       REAL-DATA DISCOVERY & API AUDIT SCRIPT       ');
  console.log('====================================================\n');

  console.log('1. TESTING REAL DEXSCREENER TOKEN PROFILES API...');
  try {
    const dexUrl = 'https://api.dexscreener.com/token-profiles/latest/v1';
    console.log(`Fetching: ${dexUrl}`);
    const res = await fetch(dexUrl, { headers: { 'Accept': 'application/json' } });
    console.log(`HTTP Status: ${res.status} ${res.statusText}`);
    
    if (res.ok) {
      const data = await res.json();
      console.log(`Response Payload Type: ${Array.isArray(data) ? 'Array' : typeof data}`);
      console.log(`Items Returned: ${Array.isArray(data) ? data.length : 0}`);

      if (Array.isArray(data) && data.length > 0) {
        console.log('\nSample Item [0] Fields:');
        console.log(Object.keys(data[0]));
        console.log('\nSample Item [0] Raw Content:');
        console.log(JSON.stringify(data[0], null, 2));

        // Check for expected date fields across all items
        let dateFieldsFound = [];
        let explicitDateMentions = 0;

        for (const item of data) {
          const keys = Object.keys(item);
          for (const key of keys) {
            if (key.toLowerCase().includes('date') || key.toLowerCase().includes('time') || key.toLowerCase().includes('launch') || key.toLowerCase().includes('schedule')) {
              if (!dateFieldsFound.includes(key)) dateFieldsFound.push(key);
            }
          }

          if (item.description) {
            const dateMatch = item.description.match(/launch\s*(?:date)?\s*[:=]?\s*(\d{4}-\d{2}-\d{2})/i);
            if (dateMatch) {
              explicitDateMentions++;
              console.log(`[FOUND DATE MENTION IN DESC] ${item.tokenAddress}: ${dateMatch[0]}`);
            }
          }
        }

        console.log('\nDate/Launch-related schema fields found in items:', dateFieldsFound);
        console.log(`Explicit launch date mentions found in descriptions: ${explicitDateMentions}`);
      }
    }
  } catch (err) {
    console.error('DexScreener API Fetch Error:', err.message);
  }

  console.log('\n----------------------------------------------------');
  console.log('2. TESTING PUMP.FUN PUBLIC TOKEN FEED API...');
  try {
    const pumpUrl = 'https://frontend-api.pump.fun/coins/latest';
    console.log(`Fetching: ${pumpUrl}`);
    const res = await fetch(pumpUrl, { headers: { 'Accept': 'application/json' } });
    console.log(`HTTP Status: ${res.status} ${res.statusText}`);
    if (res.ok) {
      const data = await res.json();
      const items = Array.isArray(data) ? data : (data.coins || []);
      console.log(`Items Returned: ${items.length}`);
      if (items.length > 0) {
        console.log('Sample Item [0] Fields:', Object.keys(items[0]));
      }
    }
  } catch (err) {
    console.error('Pump.fun API Fetch Error:', err.message);
  }

  console.log('\n----------------------------------------------------');
  console.log('3. RUNNING FULL LAUNCH INTELLIGENCE ENGINE SCAN...');
  const nowMs = Date.now();
  const scanReport = await runLaunchIntelligence({ nowMs, timezone: 'UTC', bypassCache: true });

  console.log('\nLaunch Intelligence State:');
  console.dir(scanReport.status, { depth: null });

  console.log('\nSources Health:');
  console.dir(scanReport.sources, { depth: null });

  console.log('\nScheduled Candidates Count:', scanReport.scheduledCandidates.length);
  console.log('Live Candidates Count:', scanReport.liveCandidates.length);

  console.log('\nOverall Status:', scanReport.overallStatus);
  console.log('Message:', scanReport.message);
  console.log('====================================================\n');
}

performRealDataAudit().catch(console.error);
