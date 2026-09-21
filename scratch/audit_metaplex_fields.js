// ============================================================================
// METAPLEX ALL KEYS AUDIT (scratch/audit_metaplex_fields.js)
// ============================================================================

async function inspectAllKeys() {
  const res = await fetch('https://api.metaplex.com/v1/launches', { headers: { 'Accept': 'application/json' } });
  const data = await res.json();
  const items = Array.isArray(data) ? data : (data.data || data.launches || []);
  
  const launchKeys = new Set();
  const baseTokenKeys = new Set();
  const topKeys = new Set();

  for (const item of items) {
    Object.keys(item).forEach(k => topKeys.add(k));
    if (item.launch) Object.keys(item.launch).forEach(k => launchKeys.add(k));
    if (item.baseToken) Object.keys(item.baseToken).forEach(k => baseTokenKeys.add(k));
  }

  console.log('Top Level Keys:', Array.from(topKeys));
  console.log('Launch Object Keys:', Array.from(launchKeys));
  console.log('Base Token Object Keys:', Array.from(baseTokenKeys));
}

inspectAllKeys();
