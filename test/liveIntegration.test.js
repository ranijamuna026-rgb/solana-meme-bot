process.env.NODE_ENV = 'test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

import {
  LiveExecutionEngine,
  PaperExecutionEngine,
  getExecutionEngine
} from '../src/executionEngine.js';
import { DEXRouter } from '../src/dexRouter.js';
import { TransactionBuilder } from '../src/transactionBuilder.js';
import { TransactionSubmitter } from '../src/transactionSubmitter.js';
import { evaluateTokenRisk } from '../src/riskFilter.js';
import { evaluateStrategy } from '../src/strategy.js';
import { evaluateTradeRisk } from '../src/riskManager.js';
import { triggerKillSwitch, resetKillSwitch, resetDuplicateOrderCache } from '../src/simulationLayer.js';
import { getTradeHistory, isGenuineMarketTrade, resetTradeState } from '../src/paperTrader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HISTORY_FILE_PATH = path.join(__dirname, '..', 'paper_trades_history.json');

console.log('====================================================');
console.log('LIVE INTEGRATION TESTS');
console.log('======================\n');

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    resetKillSwitch();
    resetDuplicateOrderCache();
    resetTradeState();
    fn();
    console.log(`[PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(`       Error: ${err.message}\n${err.stack}`);
  }
}

const VALID_KEYPAIR = Keypair.generate();
const VALID_WALLET = VALID_KEYPAIR.publicKey.toBase58();
const VALID_PRIVATE_KEY = bs58.encode(VALID_KEYPAIR.secretKey);
const SOL_MINT = 'So11111111111111111111111111111111111111112';

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    resetKillSwitch();
    resetDuplicateOrderCache();
    resetTradeState();
    await fn();
    console.log(`[PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(`       Error: ${err.message}\n${err.stack}`);
  }
}

function makeCandidate(id, address, overrides = {}) {
  return {
    id,
    address,
    symbol: 'LIVE_INT',
    name: 'Live Integration Token',
    priceUsd: 0.0005,
    liquidityUsd: 25000,
    volume5mUsd: 12000,
    buys5m: 10,
    sells5m: 5,
    ageMinutes: 30,
    strategyScore: 85,
    riskScore: 20,
    ...overrides
  };
}

const origTradingMode = process.env.TRADING_MODE;
const origAllowLive = global.ALLOW_LIVE_EXECUTION;
const origSolanaWalletAddr = process.env.SOLANA_WALLET_ADDRESS;

try {
  // Snapshot paper_trades_history.json before test execution
  const initialRawHistory = fs.readFileSync(HISTORY_FILE_PATH, 'utf-8');
  const initialHash = crypto.createHash('sha256').update(initialRawHistory).digest('hex');
  const initialParsedHistory = JSON.parse(initialRawHistory);
  const initialGenuineCount = initialParsedHistory.filter(isGenuineMarketTrade).length;

  // 1. PAPER isolation
  runTest('PAPER isolation', () => {
    process.env.TRADING_MODE = 'PAPER';
    global.ALLOW_LIVE_EXECUTION = false;
    const engine = getExecutionEngine();
    assert.strictEqual(engine instanceof PaperExecutionEngine, true);
    assert.strictEqual(engine.mode, 'PAPER');
  });

  // 2. LIVE authorization
  await runAsyncTest('LIVE authorization', async () => {
    process.env.TRADING_MODE = 'LIVE';
    global.ALLOW_LIVE_EXECUTION = false;
    const liveEngine = new LiveExecutionEngine();
    const cand = makeCandidate('INT_02', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

    await assert.rejects(async () => {
      await liveEngine.executeBuy(cand);
    }, (err) => err.message.includes('SAFETY LOCK'));
  });

  // 3. Kill switch
  await runAsyncTest('Kill switch', async () => {
    process.env.TRADING_MODE = 'LIVE';
    global.ALLOW_LIVE_EXECUTION = true;
    process.env.SOLANA_WALLET_ADDRESS = VALID_WALLET;
    const liveEngine = new LiveExecutionEngine();
    const cand = makeCandidate('INT_03', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

    triggerKillSwitch();
    await assert.rejects(async () => {
      await liveEngine.executeBuy(cand);
    }, (err) => err.message.includes('Emergency kill switch is active'));

    await assert.rejects(async () => {
      await liveEngine.executeSell({ tokenAddress: cand.address, quantity: 100 }, 0.001, 1000, 'TP');
    }, (err) => err.message.includes('Emergency kill switch is active'));
  });

  // 4. Candidate validation
  await runAsyncTest('Candidate validation', async () => {
    process.env.TRADING_MODE = 'LIVE';
    global.ALLOW_LIVE_EXECUTION = true;
    process.env.SOLANA_WALLET_ADDRESS = VALID_WALLET;
    const liveEngine = new LiveExecutionEngine();

    // Liquidity < $10,000
    await assert.rejects(async () => {
      await liveEngine.executeBuy(makeCandidate('INT_04_1', '7wCM5K4ziHmrbjGe5QFhBqBME2fH82dn4Wfx8vhKSTNK', { liquidityUsd: 8000 }));
    }, (err) => err.message.includes('Liquidity below minimum'));

    // Volume < $5,000
    await assert.rejects(async () => {
      await liveEngine.executeBuy(makeCandidate('INT_04_2', '7wCM5K4ziHmrbjGe5QFhBqBME2fH82dn4Wfx8vhKSTNK', { volume5mUsd: 3000 }));
    }, (err) => err.message.includes('5m Volume below minimum'));

    // Buys < 5
    await assert.rejects(async () => {
      await liveEngine.executeBuy(makeCandidate('INT_04_3', '7wCM5K4ziHmrbjGe5QFhBqBME2fH82dn4Wfx8vhKSTNK', { buys5m: 3 }));
    }, (err) => err.message.includes('5m Buys count below minimum'));

    // Sells < 2
    await assert.rejects(async () => {
      await liveEngine.executeBuy(makeCandidate('INT_04_4', '7wCM5K4ziHmrbjGe5QFhBqBME2fH82dn4Wfx8vhKSTNK', { sells5m: 1 }));
    }, (err) => err.message.includes('5m Sells count below minimum'));

    // Age > 180 min
    await assert.rejects(async () => {
      await liveEngine.executeBuy(makeCandidate('INT_04_5', '7wCM5K4ziHmrbjGe5QFhBqBME2fH82dn4Wfx8vhKSTNK', { ageMinutes: 240 }));
    }, (err) => err.message.includes('Token age exceeds 180 minutes'));

    // Strategy Score < 70
    await assert.rejects(async () => {
      await liveEngine.executeBuy(makeCandidate('INT_04_6', '7wCM5K4ziHmrbjGe5QFhBqBME2fH82dn4Wfx8vhKSTNK', { strategyScore: 50 }));
    }, (err) => err.message.includes('Strategy score below minimum'));

    // Risk Score > 60
    await assert.rejects(async () => {
      await liveEngine.executeBuy(makeCandidate('INT_04_7', '7wCM5K4ziHmrbjGe5QFhBqBME2fH82dn4Wfx8vhKSTNK', { riskScore: 75 }));
    }, (err) => err.message.includes('Risk score exceeds maximum'));

    // Position Size > $10
    await assert.rejects(async () => {
      await liveEngine.executeBuy(makeCandidate('INT_04_8', '7wCM5K4ziHmrbjGe5QFhBqBME2fH82dn4Wfx8vhKSTNK'), null, 25);
    }, (err) => err.message.includes('Position size exceeds maximum allowed'));
  });

  // 5. Risk Manager
  runTest('Risk Manager', () => {
    const validCand = makeCandidate('INT_05', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    const riskEval = evaluateTradeRisk(validCand);
    assert.strictEqual(riskEval.approved, true);

    const badCand = makeCandidate('INT_05_BAD', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', { liquidityUsd: 1000 });
    const badRiskEval = evaluateTradeRisk(badCand);
    assert.strictEqual(badRiskEval.approved, false);
  });

  // 6. Wallet validation
  await runAsyncTest('Wallet validation', async () => {
    process.env.TRADING_MODE = 'LIVE';
    global.ALLOW_LIVE_EXECUTION = true;
    process.env.SOLANA_WALLET_ADDRESS = VALID_WALLET;
    const liveEngine = new LiveExecutionEngine();

    // Valid wallet
    const connResult = await liveEngine.connectWallet();
    assert.strictEqual(connResult.connected, true);
    assert.strictEqual(connResult.publicKey, VALID_WALLET);

    // Missing wallet
    delete process.env.SOLANA_WALLET_ADDRESS;
    await assert.rejects(async () => {
      await liveEngine.executeBuy(makeCandidate('INT_06_1', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'));
    }, (err) => err.message.includes('Valid wallet public key is required'));

    // Invalid wallet address
    process.env.SOLANA_WALLET_ADDRESS = 'invalid_wallet_key';
    await assert.rejects(async () => {
      await liveEngine.executeBuy(makeCandidate('INT_06_2', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'));
    }, (err) => err.message.includes('Valid wallet public key is required'));
  });

  // 7. DEX quote validation
  await runAsyncTest('DEX quote validation', async () => {
    const dexRouter = new DEXRouter();
    const buyQuote = await dexRouter.getBuyQuote(SOL_MINT, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 10, 50);
    assert.strictEqual(buyQuote.protocol, 'Jupiter');
    assert.strictEqual(buyQuote.action, 'BUY');

    const sellQuote = await dexRouter.getSellQuote('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', SOL_MINT, 100, 50);
    assert.strictEqual(sellQuote.action, 'SELL');

    // Slippage > 100 bps
    assert.throws(() => dexRouter.validateSlippage(150), /Excessive slippage/);

    // Quote older than 3000ms
    const staleQuote = { ...buyQuote, timestamp: Date.now() - 4000 };
    assert.throws(() => dexRouter.validateQuoteFreshness(staleQuote, 3000), /Stale quote rejected/);
  });

  // 8. Transaction Builder unsigned state
  await runAsyncTest('Transaction Builder unsigned state', async () => {
    process.env.TRADING_MODE = 'LIVE';
    global.ALLOW_LIVE_EXECUTION = true;
    const dexRouter = new DEXRouter();
    const builder = new TransactionBuilder({ dexRouter });

    const quote = await dexRouter.getBuyQuote(SOL_MINT, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 10, 50);
    const tx = await builder.buildBuyTransaction(quote, VALID_WALLET);

    assert.strictEqual(tx.isSigned, false);
    assert.strictEqual(Array.isArray(tx.signatures), true);
    assert.strictEqual(tx.signatures.length, 0);
    assert.strictEqual(builder.validateTransaction(tx), true);
  });

  // 9. Read-only simulation
  await runAsyncTest('Read-only simulation', async () => {
    process.env.TRADING_MODE = 'LIVE';
    global.ALLOW_LIVE_EXECUTION = true;
    const dexRouter = new DEXRouter();
    const builder = new TransactionBuilder({ dexRouter });

    const quote = await dexRouter.getBuyQuote(SOL_MINT, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 10, 50);
    const tx = await builder.buildBuyTransaction(quote, VALID_WALLET);

    const simResult = await builder.simulateTransaction(tx);
    assert.strictEqual(simResult.status, 'SIMULATED_READ_ONLY');
    assert.strictEqual(simResult.isExecutable, false);
    assert.strictEqual(simResult.err, null);
  });

  // 10. TransactionSubmitter DRY_RUN_BLOCKED
  await runAsyncTest('TransactionSubmitter DRY_RUN_BLOCKED', async () => {
    process.env.TRADING_MODE = 'LIVE';
    global.ALLOW_LIVE_EXECUTION = true;
    global.LIVE_EXECUTION_ARMED = true;
    global.ALLOW_MAINNET_SUBMISSION = true;
    process.env.SOLANA_WALLET_ADDRESS = VALID_WALLET;
    const dexRouter = new DEXRouter();
    const builder = new TransactionBuilder({ dexRouter });
    const submitter = new TransactionSubmitter({ transactionBuilder: builder });

    const quote = await dexRouter.getBuyQuote(SOL_MINT, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 10, 50);
    const tx = await builder.buildBuyTransaction(quote, VALID_WALLET);
    tx.isSigned = true;
    tx.signatures = [{ publicKey: VALID_WALLET, signature: 'signed_mock' }];
    const simResult = await builder.simulateTransaction(tx, { allowSigned: true });

    const submitResult = await submitter.submit(tx, simResult, { allowSigned: true });
    assert.strictEqual(submitResult.submitted, false);
    assert.strictEqual(submitResult.status, 'DRY_RUN_BLOCKED');
    assert.strictEqual(submitResult.signature, null);
  });

  // 11. BUY integration flow
  await runAsyncTest('BUY integration flow', async () => {
    process.env.TRADING_MODE = 'LIVE';
    global.ALLOW_LIVE_EXECUTION = true;
    global.LIVE_EXECUTION_ARMED = true;
    global.ALLOW_MAINNET_SUBMISSION = true;
    process.env.SOLANA_WALLET_ADDRESS = VALID_WALLET;
    process.env.SOLANA_PRIVATE_KEY = VALID_PRIVATE_KEY;
    try {
      const liveEngine = new LiveExecutionEngine();
      const cand = makeCandidate('BUY_FLOW_11', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

      const result = await liveEngine.executeBuy(cand, null, 10);
      assert.strictEqual(result.executionMode, 'LIVE_PREVIEW');
      assert.strictEqual(result.action, 'BUY');
      assert.strictEqual(result.walletAddress, VALID_WALLET);
      assert.strictEqual(result.status, 'DRY_RUN_BLOCKED');
      assert.strictEqual(result.submissionResult.submitted, false);
      assert.strictEqual(result.submissionResult.signature, null);
      assert.strictEqual(result.signingResult.signed, true);
      assert.strictEqual(result.simulationResult.status, 'SIMULATED_READ_ONLY');
    } finally {
      delete process.env.SOLANA_PRIVATE_KEY;
      delete process.env.SOLANA_WALLET_ADDRESS;
      delete process.env.TRADING_MODE;
      global.ALLOW_LIVE_EXECUTION = false;
      delete global.ALLOW_MAINNET_SUBMISSION;
    }
  });

  // 12. SELL integration flow
  await runAsyncTest('SELL integration flow', async () => {
    process.env.TRADING_MODE = 'LIVE';
    global.ALLOW_LIVE_EXECUTION = true;
    global.LIVE_EXECUTION_ARMED = true;
    global.ALLOW_MAINNET_SUBMISSION = true;
    process.env.SOLANA_WALLET_ADDRESS = VALID_WALLET;
    process.env.SOLANA_PRIVATE_KEY = VALID_PRIVATE_KEY;
    try {
      const liveEngine = new LiveExecutionEngine();

      const tradeRecord = {
        tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        quantity: 500,
        entryPrice: 0.002
      };

      const result = await liveEngine.executeSell(tradeRecord, 0.0025, 120000, 'TP');
      assert.strictEqual(result.executionMode, 'LIVE_PREVIEW');
      assert.strictEqual(result.action, 'SELL');
      assert.strictEqual(result.walletAddress, VALID_WALLET);
      assert.strictEqual(result.status, 'DRY_RUN_BLOCKED');
      assert.strictEqual(result.submissionResult.submitted, false);
      assert.strictEqual(result.submissionResult.signature, null);
      assert.strictEqual(result.signingResult.signed, true);
      assert.strictEqual(result.simulationResult.status, 'SIMULATED_READ_ONLY');
    } finally {
      delete process.env.SOLANA_PRIVATE_KEY;
      delete process.env.SOLANA_WALLET_ADDRESS;
      delete process.env.TRADING_MODE;
      global.ALLOW_LIVE_EXECUTION = false;
    }
  });

  // 13. SELL position protection
  await runAsyncTest('SELL position protection', async () => {
    process.env.TRADING_MODE = 'LIVE';
    global.ALLOW_LIVE_EXECUTION = true;
    process.env.SOLANA_WALLET_ADDRESS = VALID_WALLET;
    const liveEngine = new LiveExecutionEngine();

    // Null position
    await assert.rejects(async () => {
      await liveEngine.executeSell(null, 0.001, 1000, 'TP');
    }, (err) => err.message.includes('Invalid position or token balance'));

    // Zero quantity
    await assert.rejects(async () => {
      await liveEngine.executeSell({ tokenAddress: VALID_WALLET, quantity: 0 }, 0.001, 1000, 'TP');
    }, (err) => err.message.includes('Invalid position or token balance'));

    // Negative quantity
    await assert.rejects(async () => {
      await liveEngine.executeSell({ tokenAddress: VALID_WALLET, quantity: -50 }, 0.001, 1000, 'TP');
    }, (err) => err.message.includes('Invalid position or token balance'));
  });

  // 14. No PAPER fallback
  await runAsyncTest('No PAPER fallback', async () => {
    process.env.TRADING_MODE = 'LIVE';
    global.ALLOW_LIVE_EXECUTION = true;
    delete process.env.SOLANA_WALLET_ADDRESS;
    const liveEngine = new LiveExecutionEngine();
    const cand = makeCandidate('NO_FALLBACK_14', '7wCM5K4ziHmrbjGe5QFhBqBME2fH82dn4Wfx8vhKSTNK');

    const historyCountBefore = getTradeHistory().length;
    await assert.rejects(async () => {
      await liveEngine.executeBuy(cand);
    });
    const historyCountAfter = getTradeHistory().length;
    assert.strictEqual(historyCountAfter, historyCountBefore, 'Failed LIVE execution must NOT create paper trade');
  });

  // 15. No signing/broadcast
  runTest('No signing/broadcast', async () => {
    const liveEngine = new LiveExecutionEngine();
    await assert.rejects(async () => {
      await liveEngine.signTransaction();
    }, (err) => err.message.includes('SAFETY LOCK'));
  });

  // 16. Private-key isolation
  runTest('Private-key isolation', () => {
    assert.strictEqual(process.env.SOLANA_PRIVATE_KEY, undefined);
    assert.strictEqual(process.env.PRIVATE_KEY, undefined);
    assert.strictEqual(process.env.SEED_PHRASE, undefined);
  });

  // 17. Paper history integrity
  runTest('Paper history integrity', () => {
    const currentRawHistory = fs.readFileSync(HISTORY_FILE_PATH, 'utf-8');
    const currentHash = crypto.createHash('sha256').update(currentRawHistory).digest('hex');
    const currentParsedHistory = JSON.parse(currentRawHistory);
    const currentGenuineCount = currentParsedHistory.filter(isGenuineMarketTrade).length;

    assert.strictEqual(currentHash, initialHash, 'paper_trades_history.json must be byte-for-byte identical');
    assert.strictEqual(currentParsedHistory.length, initialParsedHistory.length, 'Total records count must be unchanged');
    assert.strictEqual(currentGenuineCount, initialGenuineCount, 'Genuine trades count must remain exact');
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
  if (origSolanaWalletAddr !== undefined) {
    process.env.SOLANA_WALLET_ADDRESS = origSolanaWalletAddr;
  } else {
    delete process.env.SOLANA_WALLET_ADDRESS;
  }
}

console.log('====================================================');
console.log(`RESULT: ${passedTests} / ${totalTests} INTEGRATION TESTS PASSED`);
console.log('====================================================\n');

if (passedTests !== totalTests) {
  process.exit(1);
}
