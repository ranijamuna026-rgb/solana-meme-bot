// ============================================================================
// METAPLEX SCHEMA AUDIT SCRIPT (scratch/audit_metaplex_schema.js)
// Purpose: Fetch real Metaplex Genesis API endpoints and dump detailed field schema.
// Mode: REAL MARKET DATA + PAPER TRADING ONLY (Zero Web3 signing, zero wallets, zero real trades)
// ============================================================================

async function inspectMetaplexSchema() {
  console.log('====================================================');
  console.log('    METAPLEX GENESIS API SCHEMA AUDIT              ');
  console.log('====================================================\n');

  // 1. Fetch ?status=upcoming
  console.log('[STEP 1] Querying https://api.metaplex.com/v1/launches?status=upcoming ...');
  try {
    const resUpcoming = await fetch('https://api.metaplex.com/v1/launches?status=upcoming', {
      headers: { 'Accept': 'application/json' }
    });
    console.log(`Status Code: ${resUpcoming.status} ${resUpcoming.statusText}`);
    const dataUpcoming = await resUpcoming.json();
    console.log('Response Payload:', JSON.stringify(dataUpcoming, null, 2));
  } catch (err) {
    console.error('Error fetching upcoming status:', err.message);
  }

  // 2. Fetch main launches endpoint
  console.log('\n[STEP 2] Querying https://api.metaplex.com/v1/launches ...');
  try {
    const resMain = await fetch('https://api.metaplex.com/v1/launches', {
      headers: { 'Accept': 'application/json' }
    });
    console.log(`Status Code: ${resMain.status} ${resMain.statusText}`);
    const dataMain = await resMain.json();
    const items = Array.isArray(dataMain) ? dataMain : (dataMain.data || dataMain.launches || []);
    
    console.log(`Total Records Returned: ${items.length}`);

    // Inspect status values across all items
    const statusCounts = {};
    let upcomingSample = null;
    let anySample = null;
    let sampleWithStartTime = null;

    for (const item of items) {
      const launch = item.launch || item;
      const status = launch.status || 'MISSING';
      statusCounts[status] = (statusCounts[status] || 0) + 1;

      if (!anySample) anySample = item;
      if (status === 'upcoming' && !upcomingSample) upcomingSample = item;
      if (launch.startTime && !sampleWithStartTime) sampleWithStartTime = item;
    }

    console.log('\n[STATUS DISTRIBUTION across returned records]:');
    console.dir(statusCounts);

    if (upcomingSample) {
      console.log('\n[SAMPLE UPCOMING RECORD]:');
      console.log(JSON.stringify(upcomingSample, null, 2));
    } else {
      console.log('\n[NOTE] 0 records in response currently have status === "upcoming".');
    }

    if (sampleWithStartTime) {
      console.log('\n[SAMPLE RECORD CONTAINING startTime]:');
      console.log(JSON.stringify(sampleWithStartTime, null, 2));
    } else {
      console.log('\n[NOTE] Inspecting fields of a representative sample record:');
      console.log(JSON.stringify(anySample, null, 2));
    }

  } catch (err) {
    console.error('Error fetching main launches:', err.message);
  }
}

inspectMetaplexSchema().catch(err => {
  console.error('Fatal audit error:', err);
});
