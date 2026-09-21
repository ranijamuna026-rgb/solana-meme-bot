process.env.NODE_ENV = 'test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEXRouter,
  isValidPublicKey,
  MAX_ALLOWED_SLIPPAGE_BPS,
  DEFAULT_SLIPPAGE_BPS,
  DEFAULT_QUOTE_FRESHNESS_MS
} from '../src/dexRouter.js';
import { getTradeHistory, isGenuineMarketTrade } from '../src/paperTrader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HISTORY_FILE_PATH = path.join(__dirname, '..', 'paper_trades_history.json');

console.log('====================================================');
console.log('       RUNNING DEX ROUTER AUTOMATED TESTS           ');
console.log('====================================================\n');

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
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
    await fn();
    console.log(`[PASS] TEST ${totalTests}: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] TEST ${totalTests}: ${name}`);
    console.error(`       Error: ${err.message}\n${err.stack}`);
  }
}

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const VALID_WALLET = '7wCM5K4ziHmrbjGe5QFhBqBME2fH82dn4Wfx8vhKSTNK';

// Store original env state
const origTradingMode = process.env.TRADING_MODE;
const origAllowLive = global.ALLOW_LIVE_EXECUTION;

try {
  // Read initial history state
  const initialRawHistory = fs.readFileSync(HISTORY_FILE_PATH, 'utf-8');
  const initialParsedHistory = JSON.parse(initialRawHistory);
  const initialGenuineCount = initialParsedHistory.filter(isGenuineMarketTrade).length;

  // 1. Valid Solana mint validation
  runTest('Valid Solana mint address is accepted and validated', () => {
    assert.strictEqual(isValidPublicKey(SOL_MINT), true);
    assert.strictEqual(isValidPublicKey(USDC_MINT), true);
    assert.strictEqual(isValidPublicKey(VALID_WALLET), true);
    const router = new DEXRouter();
    assert.strictEqual(router.validateMint(SOL_MINT, 'SOL mint'), true);
  });

  // 2. Invalid mint rejection
  runTest('Invalid or malformed mint address is rejected', () => {
    assert.strictEqual(isValidPublicKey('invalid-mint-address'), false);
    assert.strictEqual(isValidPublicKey(''), false);
    assert.strictEqual(isValidPublicKey(null), false);
    assert.strictEqual(isValidPublicKey(12345), false);

    const router = new DEXRouter();
    assert.throws(() => router.validateMint('invalid-mint'), /Invalid Token address/);
    assert.throws(() => router.validateMint('', 'input mint'), /Invalid input mint/);
  });

  // 3. Invalid amount rejection
  runTest('Non-numeric and NaN amounts are strictly rejected', () => {
    const router = new DEXRouter();
    assert.throws(() => router.validateAmount('100'), /Invalid swap amount/);
    assert.throws(() => router.validateAmount(NaN), /Invalid swap amount/);
    assert.throws(() => router.validateAmount(null), /Invalid swap amount/);
    assert.throws(() => router.validateAmount(undefined), /Invalid swap amount/);
  });

  // 4. Zero amount rejection
  runTest('Zero amount is strictly rejected', () => {
    const router = new DEXRouter();
    assert.throws(() => router.validateAmount(0), /Invalid swap amount/);
  });

  // 5. Negative amount rejection
  runTest('Negative amount is strictly rejected', () => {
    const router = new DEXRouter();
    assert.throws(() => router.validateAmount(-10.5), /Invalid swap amount/);
  });

  // 6. Valid buy/sell quote generation
  await runAsyncTest('getBuyQuote and getSellQuote return structured quote abstractions', async () => {
    const router = new DEXRouter();
    const buyQuote = await router.getBuyQuote(SOL_MINT, USDC_MINT, 1.5, 50);
    assert.strictEqual(buyQuote.protocol, 'Jupiter');
    assert.strictEqual(buyQuote.action, 'BUY');
    assert.strictEqual(buyQuote.inputMint, SOL_MINT);
    assert.strictEqual(buyQuote.outputMint, USDC_MINT);
    assert.strictEqual(buyQuote.inAmount, '1.5');
    assert.strictEqual(buyQuote.slippageBps, 50);
    assert.strictEqual(buyQuote.isExecutable, false);
    assert.strictEqual(typeof buyQuote.timestamp, 'number');

    const sellQuote = await router.getSellQuote(USDC_MINT, SOL_MINT, 100, 50);
    assert.strictEqual(sellQuote.action, 'SELL');
    assert.strictEqual(sellQuote.inputMint, USDC_MINT);
    assert.strictEqual(sellQuote.outputMint, SOL_MINT);
    assert.strictEqual(sellQuote.isExecutable, false);
  });

  // 7. PAPER mode execution blocked
  await runAsyncTest('PAPER mode strictly blocks swap transaction building with SAFETY LOCK', async () => {
    process.env.TRADING_MODE = 'PAPER';
    global.ALLOW_LIVE_EXECUTION = false;
    const router = new DEXRouter();
    const quote = await router.getBuyQuote(SOL_MINT, USDC_MINT, 1.0, 50);

    await assert.rejects(async () => {
      await router.buildBuySwapTransaction(quote, VALID_WALLET);
    }, /SAFETY LOCK: Live swap execution prohibited/);

    await assert.rejects(async () => {
      await router.buildSellSwapTransaction(quote, VALID_WALLET);
    }, /SAFETY LOCK: Live swap execution prohibited/);
  });

  // 8. Missing LIVE authorization blocked
  await runAsyncTest('LIVE mode without global.ALLOW_LIVE_EXECUTION blocks transaction building', async () => {
    process.env.TRADING_MODE = 'LIVE';
    global.ALLOW_LIVE_EXECUTION = false; // Missing authorization
    const router = new DEXRouter();
    const quote = await router.getBuyQuote(SOL_MINT, USDC_MINT, 1.0, 50);

    await assert.rejects(async () => {
      await router.buildBuySwapTransaction(quote, VALID_WALLET);
    }, /SAFETY LOCK: Live swap execution prohibited/);
  });

  // 9. Step 2 preview mode safety lock (even when both LIVE flags are set)
  await runAsyncTest('Dual LIVE authorization still fails closed with Step 2 preview mode safety lock', async () => {
    process.env.TRADING_MODE = 'LIVE';
    global.ALLOW_LIVE_EXECUTION = true;
    const router = new DEXRouter();
    const quote = await router.getBuyQuote(SOL_MINT, USDC_MINT, 1.0, 50);

    await assert.rejects(async () => {
      await router.buildBuySwapTransaction(quote, VALID_WALLET);
    }, /SAFETY LOCK: Transaction building and signing disabled in Step 2 preview mode/);

    await assert.rejects(async () => {
      await router.buildSellSwapTransaction(quote, VALID_WALLET);
    }, /SAFETY LOCK: Transaction building and signing disabled in Step 2 preview mode/);
  });

  // 10. Quote freshness validation & stale quote rejection
  runTest('Fresh quotes pass and stale quotes (>3000ms) are strictly rejected', () => {
    const router = new DEXRouter({ quoteFreshnessMs: 3000 });
    const freshQuote = { timestamp: Date.now() };
    assert.strictEqual(router.isQuoteFresh(freshQuote), true);
    assert.strictEqual(router.validateQuoteFreshness(freshQuote), true);

    const staleQuote = { timestamp: Date.now() - 3500 };
    assert.strictEqual(router.isQuoteFresh(staleQuote), false);
    assert.throws(() => router.validateQuoteFreshness(staleQuote), /Stale quote rejected/);
  });

  // 11. Slippage > 1.0% (100 bps) rejection
  runTest('Slippage exceeding maximum allowed 1.0% (100 bps) is strictly rejected', () => {
    const router = new DEXRouter();
    assert.strictEqual(router.validateSlippage(50), true);
    assert.strictEqual(router.validateSlippage(100), true); // 1.0% exact limit

    assert.throws(() => router.validateSlippage(101), /Excessive slippage: 101 bps exceeds maximum allowed limit/);
    assert.throws(() => router.validateSlippage(200), /Excessive slippage: 200 bps exceeds maximum allowed limit/);
    assert.throws(() => router.validateSlippage(-10), /Invalid slippage/);
  });

  // 12. Missing wallet public key rejection
  await runAsyncTest('Missing or invalid user wallet public key is rejected during transaction build', async () => {
    process.env.TRADING_MODE = 'LIVE';
    global.ALLOW_LIVE_EXECUTION = true;
    const router = new DEXRouter();
    const quote = await router.getBuyQuote(SOL_MINT, USDC_MINT, 1.0, 50);

    await assert.rejects(async () => {
      await router.buildBuySwapTransaction(quote, null);
    }, /Missing wallet public key/);

    await assert.rejects(async () => {
      await router.buildBuySwapTransaction(quote, 'invalid-public-key');
    }, /Missing wallet public key/);
  });

  // 13. Zero transaction signing or submission executed
  runTest('Zero transaction signing or broadcast mechanisms exist in DEXRouter', () => {
    const router = new DEXRouter();
    assert.strictEqual(typeof router.signTransaction, 'undefined');
    assert.strictEqual(typeof router.submitTransaction, 'undefined');
    assert.strictEqual(typeof router.sendTransaction, 'undefined');
    assert.strictEqual(typeof router.sendRawTransaction, 'undefined');
  });

  // 14. Zero private key exposure
  runTest('No private key, seed phrase, or secret key material is exposed or accessed', () => {
    assert.strictEqual(process.env.SOLANA_PRIVATE_KEY, undefined);
    assert.strictEqual(process.env.PRIVATE_KEY, undefined);
    assert.strictEqual(process.env.SEED_PHRASE, undefined);
    const router = new DEXRouter();
    assert.strictEqual(Object.keys(router).includes('privateKey'), false);
    assert.strictEqual(Object.keys(router).includes('secretKey'), false);
  });

  // 15. Verify paper_trades_history.json untouched
  runTest('paper_trades_history.json remains completely untouched and intact', () => {
    const currentRawHistory = fs.readFileSync(HISTORY_FILE_PATH, 'utf-8');
    const currentParsedHistory = JSON.parse(currentRawHistory);
    const currentGenuineCount = currentParsedHistory.filter(isGenuineMarketTrade).length;

    assert.strictEqual(currentRawHistory, initialRawHistory, 'File content must match initial content byte-for-byte');
    assert.strictEqual(currentParsedHistory.length, initialParsedHistory.length, 'Total trade records count must be unchanged');
    assert.strictEqual(currentGenuineCount, initialGenuineCount, 'Genuine trades count must remain exact');
  });

} finally {
  // Restore original environment
  if (origTradingMode !== undefined) {
    process.env.TRADING_MODE = origTradingMode;
  } else {
    delete process.env.TRADING_MODE;
  }
  global.ALLOW_LIVE_EXECUTION = origAllowLive;
}

console.log('\n====================================================');
console.log(` TEST SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
console.log('====================================================\n');

if (passedTests !== totalTests) {
  process.exit(1);
}
