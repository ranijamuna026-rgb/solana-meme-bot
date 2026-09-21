// ============================================================================
// SOLANA RPC MODULE (src/solana.js)
// Purpose: Handles connection to the Solana blockchain RPC endpoint
// ============================================================================

// 1. Import Connection class from the official @solana/web3.js SDK
import { Connection } from '@solana/web3.js';

// 2. Import our application configuration from config.js
import { config } from './config.js';

// 3. Create a Connection object used to send requests to the Solana RPC node
export const connection = new Connection(config.rpcUrl, config.commitment);

/**
 * Helper function to test whether the RPC endpoint is online and responding.
 * Fetches the Solana node version and the current block slot number.
 * 
 * @returns {Promise<{ success: boolean, version?: string, slot?: number, error?: string }>}
 */
export async function testConnection(retries = 3) {
  const rpcEndpoints = [
    config.rpcUrl,
    'https://solana-rpc.publicnode.com'
  ];

  for (const endpoint of rpcEndpoints) {
    const conn = endpoint === config.rpcUrl ? connection : new Connection(endpoint, config.commitment);
    for (let i = 0; i < retries; i++) {
      try {
        const versionInfo = await conn.getVersion();
        const version = versionInfo && versionInfo['solana-core'] ? versionInfo['solana-core'] : 'Unknown';
        const slot = await conn.getSlot();
        return {
          success: true,
          version,
          slot,
          endpoint
        };
      } catch (err) {
        if (i < retries - 1) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }
  }

  return {
    success: false,
    error: 'All Solana RPC endpoints failed to respond after retries.'
  };
}
