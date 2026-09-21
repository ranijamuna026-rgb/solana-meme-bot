// ============================================================================
// DEXSCREENER PROFILES TEXT INSPECTION (scratch/inspect_dexscreener_descriptions.js)
// Purpose: Inspect raw text descriptions from DexScreener token profiles API.
// ============================================================================

async function inspectDexScreenerDescriptions() {
  console.log('Fetching https://api.dexscreener.com/token-profiles/latest/v1 ...');
  const res = await fetch('https://api.dexscreener.com/token-profiles/latest/v1');
  const items = await res.json();
  console.log(`Total Profiles: ${items.length}`);

  let launchAnnouncementsFound = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const desc = item.description || '';
    const chain = item.chainId;
    const token = item.tokenAddress;

    console.log(`\n--- Profile [${i + 1}] (${chain}) - Token: ${token} ---`);
    console.log(`URL: ${item.url}`);
    console.log(`Description Snippet: ${desc.slice(0, 150).replace(/\n/g, ' ')}...`);

    // Check for date pattern
    const dateMatch = desc.match(/\b(2026-\d{2}-\d{2}|\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}(st|nd|rd|th)?,? 202\d)\b/i);
    if (dateMatch) {
      console.log(`>>> DATE MATCH FOUND: ${dateMatch[0]}`);
      launchAnnouncementsFound++;
    }
  }

  console.log(`\nTotal Explicit Date Matches Found: ${launchAnnouncementsFound}`);
}

inspectDexScreenerDescriptions().catch(console.error);
