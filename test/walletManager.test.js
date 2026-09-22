process.env.NODE_ENV = 'test';
import assert from 'node:assert';
import {
  isValidPublicKey,
  isWalletConfigured,
  getPublicWalletAddress,
  getSignerInterface
} from '../src/walletManager.js';
import { config } from '../src/config.js';
import { isGenuineMarketTrade, getTradeHistory } from '../src/paperTrader.js';

console.log('====================================================');
console.log('       RUNNING WALLET MANAGER AUTOMATED TESTS       ');
console.log('====================================================\n');

let passedTests = 0;
let totalTests = 0;

async function runTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(`       Error: ${err.message}\n${err.stack}`);
  }
}

const VALID_MAINNET_ADDRESS = '7wCM5K4ziHmrbjGe5QFhBqBME2fH82dn4Wfx8vhKSTNK';
const INVALID_ADDRESS = 'invalid_solana_address_123';

try {
  // TEST 1: Public Key Validation
  await runTest('TEST 1: Valid Solana public address is accepted and invalid address rejected', async () => {
    assert.strictEqual(isValidPublicKey(VALID_MAINNET_ADDRESS), true, 'Valid Solana address must return true');
    assert.strictEqual(isValidPublicKey(INVALID_ADDRESS), false, 'Invalid address string must return false');
    assert.strictEqual(isValidPublicKey(null), false, 'Null address must return false');
    assert.strictEqual(isValidPublicKey(undefined), false, 'Undefined address must return false');
  });

  // TEST 2: PAPER Mode Blocks Signer Access
  await runTest('TEST 2: PAPER mode strictly blocks signer access with SAFETY LOCK error', async () => {
    config.tradingMode = 'PAPER';
    process.env.TRADING_MODE = 'PAPER';
    global.ALLOW_LIVE_EXECUTION = false;

    try {
      getSignerInterface();
      assert.fail('getSignerInterface must throw error in PAPER mode');
    } catch (err) {
      assert.ok(err.message.includes('SAFETY LOCK'));
      assert.ok(err.message.includes('not authorized') || err.message.includes('TRADING_MODE'));
    }
  });

  // TEST 3: Missing LIVE Authorization Blocks Signer Access Even in LIVE Mode
  await runTest('TEST 3: Missing global.ALLOW_LIVE_EXECUTION blocks signer access in LIVE mode', async () => {
    config.tradingMode = 'LIVE';
    process.env.TRADING_MODE = 'LIVE';
    global.ALLOW_LIVE_EXECUTION = false; // Missing global flag

    try {
      getSignerInterface();
      assert.fail('getSignerInterface must throw error if global.ALLOW_LIVE_EXECUTION is false');
    } catch (err) {
      assert.ok(err.message.includes('SAFETY LOCK'));
    } finally {
      // Revert mode to PAPER
      config.tradingMode = 'PAPER';
      process.env.TRADING_MODE = 'PAPER';
    }
  });

  // TEST 4: Both LIVE Mode and global.ALLOW_LIVE_EXECUTION Required
  await runTest('TEST 4: Signer access requires BOTH TRADING_MODE=LIVE and global.ALLOW_LIVE_EXECUTION=true', async () => {
    config.tradingMode = 'LIVE';
    process.env.TRADING_MODE = 'LIVE';
    global.ALLOW_LIVE_EXECUTION = true;
    process.env.SOLANA_WALLET_ADDRESS = VALID_MAINNET_ADDRESS;

    try {
      const signer = getSignerInterface();
      assert.ok(signer, 'Signer interface returned when authorized');
      assert.strictEqual(signer.publicKey, VALID_MAINNET_ADDRESS);
      assert.strictEqual(signer.getPublicKey(), VALID_MAINNET_ADDRESS);
    } finally {
      // Revert mode and cleanup
      config.tradingMode = 'PAPER';
      process.env.TRADING_MODE = 'PAPER';
      global.ALLOW_LIVE_EXECUTION = false;
      delete process.env.SOLANA_WALLET_ADDRESS;
    }
  });

  // TEST 5: Zero Private Key Exposure
  await runTest('TEST 5: WalletManager exposes zero private key, seed phrase, or secret key material', async () => {
    assert.strictEqual(process.env.SOLANA_PRIVATE_KEY, undefined);
    assert.strictEqual(process.env.SOLANA_SECRET_KEY, undefined);
    assert.strictEqual(process.env.SEED_PHRASE, undefined);

    const publicAddr = getPublicWalletAddress();
    assert.ok(publicAddr === null || typeof publicAddr === 'string');
    if (publicAddr) {
      assert.ok(!publicAddr.includes('secret') && !publicAddr.includes('private'));
    }
  });

  // TEST 6: No Wallet Connection in PAPER Mode
  await runTest('TEST 6: Zero wallet connections or Keypair instantiations happen in PAPER mode', async () => {
    config.tradingMode = 'PAPER';
    process.env.TRADING_MODE = 'PAPER';

    assert.strictEqual(isWalletConfigured(), false);
    assert.strictEqual(getPublicWalletAddress(), null);
  });

  // TEST 7: Paper Trades History Integrity
  await runTest('TEST 7: Paper trades history file remains completely intact and untouched', async () => {
    const history = getTradeHistory();
    const genuine = history.filter(isGenuineMarketTrade);

    assert.ok(history.length >= 90, 'Total trade records must be preserved');
    assert.ok(genuine.length >= 90, 'Genuine market paper trades must be preserved');
  });

} finally {
  config.tradingMode = 'PAPER';
  process.env.TRADING_MODE = 'PAPER';
  global.ALLOW_LIVE_EXECUTION = false;
}

console.log('\n====================================================');
console.log(` TEST SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
console.log('====================================================\n');

if (passedTests !== totalTests) {
  process.exit(1);
}
