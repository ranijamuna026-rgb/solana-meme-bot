async function inspectMetaplexLaunches() {
  console.log('====================================================');
  console.log('    METAPLEX GENESIS API DEEP SCHEMA INSPECTION     ');
  console.log('====================================================\n');

  const url = 'https://api.metaplex.com/v1/launches';
  console.log(`Fetching: ${url}`);
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  console.log(`HTTP Status: ${res.status} ${res.statusText}`);

  if (res.ok) {
    const json = await res.json();
    const items = json.data || [];
    console.log(`Total Launches Returned: ${items.length}`);

    if (items.length > 0) {
      console.log('\nSample Launch Item [0] Structure:');
      console.log(JSON.stringify(items[0], null, 2));

      // Analyze all statuses in dataset
      const statuses = new Set();
      let upcomingCount = 0;
      let liveCount = 0;
      let completedCount = 0;
      let futureStartTimeCount = 0;
      const nowMs = Date.now();

      for (const item of items) {
        const launch = item.launch || item;
        const status = launch.status || 'unknown';
        statuses.add(status);

        if (status === 'upcoming') upcomingCount++;
        else if (status === 'live') liveCount++;
        else if (status === 'completed') completedCount++;

        if (launch.startTime) {
          const startTimeMs = new Date(launch.startTime).getTime();
          if (startTimeMs > nowMs) {
            futureStartTimeCount++;
            console.log(`[FUTURE START TIME FOUND] Token: ${launch.mint || launch.genesisAddress || 'unknown'}, StartTime: ${launch.startTime}, Status: ${status}`);
          }
        }
      }

      console.log('\nUnique Status Values Found:', Array.from(statuses));
      console.log(`Upcoming Status Count: ${upcomingCount}`);
      console.log(`Live Status Count: ${liveCount}`);
      console.log(`Completed Status Count: ${completedCount}`);
      console.log(`Future StartTime Count: ${futureStartTimeCount}`);
    }
  }
  console.log('====================================================\n');
}

inspectMetaplexLaunches().catch(console.error);
