async function researchPhase10BSources() {
  console.log('====================================================');
  console.log('      PHASE 10B SOURCE RESEARCH & AUDIT SCRIPT      ');
  console.log('====================================================\n');

  // 1. Research Metaplex Genesis API
  console.log('--- 1. METAPLEX GENESIS API RESEARCH ---');
  const metaplexUrls = [
    'https://api.metaplex.com/v1/launches?status=upcoming',
    'https://api.metaplex.com/v1/launches',
    'https://genesis.metaplex.com/api/launches'
  ];

  for (const url of metaplexUrls) {
    try {
      console.log(`Fetching: ${url}`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(url, { headers: { 'Accept': 'application/json' }, signal: controller.signal });
      clearTimeout(timeout);
      console.log(`  -> Status: ${res.status} ${res.statusText}`);
      if (res.ok) {
        const text = await res.text();
        console.log(`  -> Response Payload (first 300 chars): ${text.slice(0, 300)}`);
      }
    } catch (err) {
      console.log(`  -> Error: ${err.message}`);
    }
  }

  // 2. Research Launchpad.meme API
  console.log('\n--- 2. LAUNCHPAD.MEME API RESEARCH ---');
  const memepadUrls = [
    'https://launchpad.meme/api/public/tokens/new',
    'https://launchpad.meme/api/public/events',
    'https://launchpad.meme/api/docs'
  ];

  for (const url of memepadUrls) {
    try {
      console.log(`Fetching: ${url}`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(url, { headers: { 'Accept': 'application/json' }, signal: controller.signal });
      clearTimeout(timeout);
      console.log(`  -> Status: ${res.status} ${res.statusText}`);
      if (res.ok) {
        const text = await res.text();
        console.log(`  -> Response Payload (first 300 chars): ${text.slice(0, 300)}`);
      }
    } catch (err) {
      console.log(`  -> Error: ${err.message}`);
    }
  }

  // 3. Research Other Public Solana Launchpad / Calendar Feeds
  console.log('\n--- 3. OTHER SOLANA FEEDS RESEARCH ---');
  const otherUrls = [
    'https://api.dexscreener.com/token-profiles/latest/v1',
    'https://frontend-api.pump.fun/coins/latest'
  ];

  for (const url of otherUrls) {
    try {
      console.log(`Fetching: ${url}`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(url, { headers: { 'Accept': 'application/json' }, signal: controller.signal });
      clearTimeout(timeout);
      console.log(`  -> Status: ${res.status} ${res.statusText}`);
      if (res.ok) {
        const text = await res.text();
        console.log(`  -> Response Payload (first 300 chars): ${text.slice(0, 300)}`);
      }
    } catch (err) {
      console.log(`  -> Error: ${err.message}`);
    }
  }

  console.log('\n====================================================\n');
}

researchPhase10BSources().catch(console.error);
