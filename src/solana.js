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
export async function testConnection() {
  try {
    // Request current node version from Solana RPC
    const versionInfo = await connection.getVersion();
    const version = versionInfo && versionInfo['solana-core'] ? versionInfo['solana-core'] : 'Unknown';

    // Request the latest block slot height from Solana RPC
    const slot = await connection.getSlot();

    return {
      success: true,
      version: version,
      slot: slot
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
