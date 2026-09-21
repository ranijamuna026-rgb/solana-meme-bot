process.env.NODE_ENV = 'test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

import { config, validateLiveConfiguration, EXECUTION_STATES } from '../src/config.js';
import { LiveExecutionEngine } from '../src/executionEngine.js';
import { DEXRouter } from '../src/dexRouter.js';
import { isKillSwitchTriggered, resetKillSwitch, resetDuplicateOrderCache } from '../src/simulationLayer.js';
import { getTradeHistory, isGenuineMarketTrade, resetTradeState } from '../src/paperTrader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HISTORY_FILE_PATH = path.join(__dirname, '..', 'paper_trades_history.json');

console.log('====================================================');
console.log('   RUNNING LIVE CONFIGURATION & SAFETY GATE TESTS   ');
console.log('====================================================\n');

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    resetKillSwitch();
    resetDuplicateOrderCache();
    resetTradeState();
    fn();
    console.log(`[PASS] TEST ${totalTests}: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] TEST ${totalTests}: ${name}`);
    console.error(`       Error: ${err.message}\n${err.stack}`);
  }
}

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    resetKillSwitch();
    resetDuplicateOrderCache();
    resetTradeState();
    await fn();
    console.log(`[PASS] TEST ${totalTests}: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] TEST ${totalTests}: ${name}`);
    console.error(`       Error: ${err.message}\n${err.stack}`);
  }
}

const VALID_KEYPAIR = Keypair.generate();
const VALID_WALLET = VALID_KEYPAIR.publicKey.toBase58();
const VALID_PRIVATE_KEY = bs58.encode(VALID_KEYPAIR.secretKey);

const origTradingMode = process.env.TRADING_MODE;
const origAllowLive = global.ALLOW_LIVE_EXECUTION;
const origAllowSubmission = global.ALLOW_MAINNET_SUBMISSION;
const origSolanaWalletAddr = process.env.SOLANA_WALLET_ADDRESS;
const origRpcUrl = process.env.SOLANA_RPC_URL;
const origDexUrl = process.env.DEXSCREENER_API_URL;
const origKillSwitch = process.env.EMERGENCY_KILL_SWITCH;

try {
  const initialRawHistory = fs.readFileSync(HISTORY_FILE_PATH, 'utf-8');
  const initialHash = crypto.createHash('sha256').update(initialRawHistory).digest('hex');
  const initialParsedHistory = JSON.parse(initialRawHistory);
  const initialGenuineCount = initialParsedHistory.filter(isGenuineMarketTrade).length;

  // 1. PAPER is default
  runTest('PAPER is default execution state', () => {
    delete process.env.TRADING_MODE;
    global.ALLOW_LIVE_EXECUTION = false;
    const res = validateLiveConfiguration();
    assert.strictEqual(res.tradingMode, 'PAPER');
    assert.strictEqual(res.state, EXECUTION_STATES.PAPER);
    assert.strictEqual(res.isAuthorized, false);
  });

  // 2. LIVE without authorization fails
  runTest('LIVE without global authorization fails closed', () => {
    process.env.TRADING_MODE = 'LIVE';
    global.ALLOW_LIVE_EXECUTION = false;
    const res = validateLiveConfiguration();
    assert.strictEqual(res.state, EXECUTION_STATES.LIVE_BLOCKED);
    assert.strictEqual(res.isAuthorized, false);
    assert.ok(res.reasons.length > 0);
  });

  // 3. LIVE with only one authorization condition fails
  runTest('LIVE with only TRADING_MODE=LIVE (missing global) fails', () => {
    process.env.TRADING_MODE = 'LIVE';
    global.ALLOW_LIVE_EXECUTION = false;
    const res = validateLiveConfiguration();
    assert.strictEqual(res.isAuthorized, false);
    assert.strictEqual(res.state, EXECUTION_STATES.LIVE_BLOCKED);
  });

  // 4. Both authorization conditions are required
  runTest('Both TRADING_MODE=LIVE and global.ALLOW_LIVE_EXECUTION=true produce isAuthorized=true', () => {
    process.env.TRADING_MODE = 'LIVE';
    global.ALLOW_LIVE_EXECUTION = true;
    process.env.SOLANA_WALLET_ADDRESS = VALID_WALLET;
    const res = validateLiveConfiguration();
    assert.strictEqual(res.isAuthorized, true);
  });

  // 5. Kill switch blocks LIVE
  runTest('Active emergency kill switch blocks LIVE state', () => {
    process.env.TRADING_MODE = 'LIVE';
    global.ALLOW_LIVE_EXECUTION = true;
    process.env.SOLANA_WALLET_ADDRESS = VALID_WALLET;
    process.env.EMERGENCY_KILL_SWITCH = 'true';
    const res = validateLiveConfiguration();
    assert.strictEqual(res.killSwitchActive, true);
    assert.strictEqual(res.state, EXECUTION_STATES.LIVE_BLOCKED);
  });

  // 6. Missing wallet address blocks LIVE
  runTest('Missing wallet address blocks LIVE configuration', () => {
    process.env.TRADING_MODE = 'LIVE';
    global.ALLOW_LIVE_EXECUTION = true;
    delete process.env.SOLANA_WALLET_ADDRESS;
    delete config.walletAddressPlaceholder;
    const res = validateLiveConfiguration();
    assert.strictEqual(res.walletStatus, 'MISSING');
    assert.strictEqual(res.state, EXECUTION_STATES.LIVE_BLOCKED);
  });

  // 7. Invalid wallet address blocks LIVE
  runTest('Invalid wallet address blocks LIVE configuration', () => {
    process.env.TRADING_MODE = 'LIVE';
    global.ALLOW_LIVE_EXECUTION = true;
    process.env.SOLANA_WALLET_ADDRESS = 'invalid_wallet_address_123';
    const res = validateLiveConfiguration();
    assert.strictEqual(res.walletStatus, 'INVALID');
    assert.strictEqual(res.state, EXECUTION_STATES.LIVE_BLOCKED);
  });

  // 8. Missing RPC configuration blocks LIVE
  runTest('Invalid/missing RPC URL blocks LIVE configuration', () => {
    process.env.TRADING_MODE = 'LIVE';
    global.ALLOW_LIVE_EXECUTION = true;
    process.env.SOLANA_WALLET_ADDRESS = VALID_WALLET;
    process.env.SOLANA_RPC_URL = 'invalid-rpc-url';
    const res = validateLiveConfiguration();
    assert.strictEqual(res.rpcNetwork, 'INVALID');
    assert.strictEqual(res.state, EXECUTION_STATES.LIVE_BLOCKED);
  });

  // 9. Missing DEX configuration blocks LIVE
  runTest('Invalid/missing DEX API URL blocks LIVE configuration', () => {
    process.env.TRADING_MODE = 'LIVE';
    global.ALLOW_LIVE_EXECUTION = true;
    process.env.SOLANA_WALLET_ADDRESS = VALID_WALLET;
    process.env.SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com';
    process.env.DEXSCREENER_API_URL = 'invalid-dex-url';
    const res = validateLiveConfiguration();
    assert.strictEqual(res.dexStatus, 'UNCONFIGURED');
    assert.strictEqual(res.state, EXECUTION_STATES.LIVE_BLOCKED);
  });

  // 10. Invalid execution limits block LIVE
  runTest('Invalid execution limits block LIVE configuration', () => {
    const origMaxPos = config.maxPositionSizeUsd;
    try {
      config.maxPositionSizeUsd = 50.0; // Exceeds $10 max cap
      process.env.TRADING_MODE = 'LIVE';
      global.ALLOW_LIVE_EXECUTION = true;
      process.env.SOLANA_WALLET_ADDRESS = VALID_WALLET;
      const res = validateLiveConfiguration();
      assert.strictEqual(res.executionLimitsValid, false);
      assert.strictEqual(res.state, EXECUTION_STATES.LIVE_BLOCKED);
    } finally {
      config.maxPositionSizeUsd = origMaxPos;
    }
  });

  // 11. Existing risk limits remain unchanged
  runTest('Existing risk limits remain exactly configured', () => {
    assert.strictEqual(config.minLiquidityUsd, 10000, 'minLiquidityUsd must be 10000');
    assert.strictEqual(config.min5mVolumeUsd, 5000, 'min5mVolumeUsd must be 5000');
    assert.strictEqual(config.min5mBuys, 5, 'min5mBuys must be 5');
    assert.strictEqual(config.min5mSells, 2, 'min5mSells must be 2');
    assert.strictEqual(config.maxTokenAgeMinutes, 180, 'maxTokenAgeMinutes must be 180');
    assert.strictEqual(config.minStrategyScore, 70, 'minStrategyScore must be 70');
    assert.strictEqual(config.maxRiskScore, 60, 'maxRiskScore must be 60');
  });

  // 12. Existing daily trade limit remains unchanged
  runTest('Existing daily trade limit remains 30 trades per day', () => {
    assert.strictEqual(config.maxTradesPerDay, 30, 'maxTradesPerDay must be 30');
  });

  // 13. Existing daily loss protection remains unchanged
  runTest('Existing daily loss limit remains $20.00 max loss', () => {
    assert.strictEqual(config.maxDailyLossUsd, 20.0, 'maxDailyLossUsd must be 20.0');
  });

  // 14. Position size > $10 is blocked
  runTest('Position size > $10 is rejected by configuration validation', () => {
    const origMaxPos = config.maxPositionSizeUsd;
    try {
      config.maxPositionSizeUsd = 15.0;
      const res = validateLiveConfiguration();
      assert.strictEqual(res.executionLimitsValid, false);
    } finally {
      config.maxPositionSizeUsd = origMaxPos;
    }
  });

  // 15. Slippage > 100 bps is blocked
  runTest('Slippage > 100 bps (1.0%) is rejected by configuration validation', () => {
    const origMaxSlip = config.maxSlippagePercent;
    try {
      config.maxSlippagePercent = 2.5;
      const res = validateLiveConfiguration();
      assert.strictEqual(res.executionLimitsValid, false);
    } finally {
      config.maxSlippagePercent = origMaxSlip;
    }
  });

  // 16. Quote age > 3000ms is blocked
  runTest('Quote age > 3000ms is rejected by DEXRouter validation', () => {
    const dexRouter = new DEXRouter();
    const staleQuote = { timestamp: Date.now() - 4000 };
    assert.throws(() => dexRouter.validateQuoteFreshness(staleQuote, 3000), /Stale quote rejected/);
  });

  // 17. Configuration output contains no private-key material
  runTest('validateLiveConfiguration() report contains zero private key material', () => {
    const res = validateLiveConfiguration();
    const serialized = JSON.stringify(res);
    assert.strictEqual(serialized.includes('privateKey'), false);
    assert.strictEqual(serialized.includes('secretKey'), false);
    assert.strictEqual(serialized.includes('seedPhrase'), false);
    assert.strictEqual(res.executionCapability, 'DISABLED_DRY_RUN_ONLY');
  });

  // 18. No private key or seed phrase is accessed
  runTest('Environment maintains zero private key or seed phrase credentials', () => {
    assert.strictEqual(process.env.SOLANA_PRIVATE_KEY, undefined);
    assert.strictEqual(process.env.PRIVATE_KEY, undefined);
    assert.strictEqual(process.env.SEED_PHRASE, undefined);
  });

  // 19. No transaction is signed
  await runAsyncTest('LiveExecutionEngine signTransaction remains fail-closed', async () => {
    const liveEngine = new LiveExecutionEngine();
    await assert.rejects(async () => {
      await liveEngine.signTransaction();
    }, /SAFETY LOCK/);
  });

  // 20. No transaction is broadcast
  await runAsyncTest('submitTransaction terminates at DRY_RUN_BLOCKED without broadcast', async () => {
    process.env.TRADING_MODE = 'LIVE';
    global.ALLOW_LIVE_EXECUTION = true;
    global.ALLOW_MAINNET_SUBMISSION = true;
    process.env.SOLANA_WALLET_ADDRESS = VALID_WALLET;
    process.env.SOLANA_PRIVATE_KEY = VALID_PRIVATE_KEY;
    try {
      const liveEngine = new LiveExecutionEngine();

      const cand = {
        id: 'CFG_TEST_20',
        address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        symbol: 'CFG_20',
        priceUsd: 0.0005,
        liquidityUsd: 25000,
        volume5mUsd: 12000,
        buys5m: 10,
        sells5m: 5,
        strategyScore: 85,
        riskScore: 20
      };

      const res = await liveEngine.executeBuy(cand, null, 10);
      assert.strictEqual(res.status, 'DRY_RUN_BLOCKED');
      assert.strictEqual(res.submissionResult.submitted, false);
    } finally {
      delete process.env.SOLANA_PRIVATE_KEY;
      delete process.env.SOLANA_WALLET_ADDRESS;
      delete process.env.TRADING_MODE;
      global.ALLOW_LIVE_EXECUTION = false;
      global.ALLOW_MAINNET_SUBMISSION = false;
    }
  });

  // 21. DRY_RUN_BLOCKED remains active
  runTest('Execution capability state verifies DRY_RUN_BLOCKED remains active', () => {
    const res = validateLiveConfiguration();
    assert.strictEqual(res.executionCapability, 'DISABLED_DRY_RUN_ONLY');
  });

  // 22. PAPER history remains untouched
  runTest('paper_trades_history.json remains 100% byte-for-byte identical', () => {
    const currentRawHistory = fs.readFileSync(HISTORY_FILE_PATH, 'utf-8');
    const currentHash = crypto.createHash('sha256').update(currentRawHistory).digest('hex');
    const currentParsedHistory = JSON.parse(currentRawHistory);
    const currentGenuineCount = currentParsedHistory.filter(isGenuineMarketTrade).length;

    assert.strictEqual(currentHash, initialHash, 'File content must match initial SHA-256 hash byte-for-byte');
    assert.strictEqual(currentParsedHistory.length, initialParsedHistory.length, 'Total trade records count must be unchanged');
    assert.strictEqual(currentGenuineCount, initialGenuineCount, 'Genuine trades count must remain exact');
  });

  // 23. No LIVE -> PAPER fallback occurs
  await runAsyncTest('Failed LIVE configuration execution throws exception without fallback to PAPER trade', async () => {
    process.env.TRADING_MODE = 'LIVE';
    global.ALLOW_LIVE_EXECUTION = true;
    delete process.env.SOLANA_WALLET_ADDRESS;
    const liveEngine = new LiveExecutionEngine();

    const paperCountBefore = getTradeHistory().length;
    await assert.rejects(async () => {
      await liveEngine.executeBuy({ address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', priceUsd: 0.001 });
    });
    const paperCountAfter = getTradeHistory().length;
    assert.strictEqual(paperCountAfter, paperCountBefore, 'Failed LIVE execution must NOT fallback or create paper trade');
  });

} finally {
  resetKillSwitch();
  resetDuplicateOrderCache();
  resetTradeState();
  if (origTradingMode !== undefined) {
    process.env.TRADING_MODE = origTradingMode;
  } else {
    delete process.env.TRADING_MODE;
  }
  global.ALLOW_LIVE_EXECUTION = origAllowLive;
  global.ALLOW_MAINNET_SUBMISSION = origAllowSubmission;
  if (origSolanaWalletAddr !== undefined) {
    process.env.SOLANA_WALLET_ADDRESS = origSolanaWalletAddr;
  } else {
    delete process.env.SOLANA_WALLET_ADDRESS;
  }
  if (origRpcUrl !== undefined) {
    process.env.SOLANA_RPC_URL = origRpcUrl;
  } else {
    delete process.env.SOLANA_RPC_URL;
  }
  if (origDexUrl !== undefined) {
    process.env.DEXSCREENER_API_URL = origDexUrl;
  } else {
    delete process.env.DEXSCREENER_API_URL;
  }
  if (origKillSwitch !== undefined) {
    process.env.EMERGENCY_KILL_SWITCH = origKillSwitch;
  } else {
    delete process.env.EMERGENCY_KILL_SWITCH;
  }
}

console.log('\n====================================================');
console.log(` TEST SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
console.log('====================================================\n');

if (passedTests !== totalTests) {
  process.exit(1);
}
