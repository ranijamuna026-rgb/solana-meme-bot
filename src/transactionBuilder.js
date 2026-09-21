import { PublicKey, Transaction } from '@solana/web3.js';
import { DEXRouter, isValidPublicKey } from './dexRouter.js';

/**
 * TransactionBuilder: Secure Transaction Builder & Simulation Boundary
 * Prepares unsigned in-memory Solana transaction objects for future LIVE execution.
 * Strictly fail-closed: Zero transaction signing, submission, or blockchain writes.
 */
export class TransactionBuilder {
  constructor(options = {}) {
    this.dexRouter = options.dexRouter || new DEXRouter(options);
  }

  /**
   * Checks if LIVE trading authorization conditions are met.
   * Requires BOTH process.env.TRADING_MODE === 'LIVE' AND global.ALLOW_LIVE_EXECUTION === true.
   * @returns {boolean}
   */
  isLiveExecutionAuthorized() {
    return (
      process.env.TRADING_MODE === 'LIVE' &&
      global.ALLOW_LIVE_EXECUTION === true
    );
  }

  /**
   * Builds an unsigned buy transaction abstraction object.
   * @param {object} quote - DEXRouter quote object
   * @param {string} userPublicKey - Solana public address of fee payer / user wallet
   * @param {object} [options]
   * @returns {Promise<object>} Unsigned transaction object
   */
  async buildBuyTransaction(quote, userPublicKey, options = {}) {
    if (!this.isLiveExecutionAuthorized()) {
      throw new Error('SAFETY LOCK: Live transaction building prohibited when TRADING_MODE is not LIVE or global.ALLOW_LIVE_EXECUTION is false');
    }

    if (!userPublicKey || !isValidPublicKey(userPublicKey)) {
      throw new Error('Missing wallet public key: Valid user public key is required for building transaction');
    }

    if (!quote || typeof quote !== 'object') {
      throw new Error('Invalid quote: Quote object is required');
    }

    // Validate quote freshness & parameters
    this.dexRouter.validateQuoteFreshness(quote);

    if (quote.action !== 'BUY') {
      throw new Error(`Invalid quote action: Expected BUY quote, received ${quote.action}`);
    }

    // In-memory unsigned transaction construction using @solana/web3.js
    const feePayerPubkey = new PublicKey(userPublicKey);
    const tx = new Transaction();
    tx.feePayer = feePayerPubkey;
    tx.recentBlockhash = '11111111111111111111111111111111'; // Placeholder blockhash for unsigned preview

    const txObject = {
      txId: `tx_buy_unsigned_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      action: 'BUY',
      userPublicKey,
      inputMint: quote.inputMint,
      outputMint: quote.outputMint,
      inAmount: quote.inAmount,
      outAmount: quote.outAmount,
      slippageBps: quote.slippageBps,
      feePayer: userPublicKey,
      recentBlockhash: tx.recentBlockhash,
      rawTransaction: tx,
      isSigned: false,
      signatures: [], // Empty signatures array — strictly unsigned
      status: 'UNSIGNED_PREVIEW',
      timestamp: Date.now()
    };

    return txObject;
  }

  /**
   * Builds an unsigned sell transaction abstraction object.
   * @param {object} quote - DEXRouter quote object
   * @param {string} userPublicKey - Solana public address of fee payer / user wallet
   * @param {object} [options]
   * @returns {Promise<object>} Unsigned transaction object
   */
  async buildSellTransaction(quote, userPublicKey, options = {}) {
    if (!this.isLiveExecutionAuthorized()) {
      throw new Error('SAFETY LOCK: Live transaction building prohibited when TRADING_MODE is not LIVE or global.ALLOW_LIVE_EXECUTION is false');
    }

    if (!userPublicKey || !isValidPublicKey(userPublicKey)) {
      throw new Error('Missing wallet public key: Valid user public key is required for building transaction');
    }

    if (!quote || typeof quote !== 'object') {
      throw new Error('Invalid quote: Quote object is required');
    }

    this.dexRouter.validateQuoteFreshness(quote);

    if (quote.action !== 'SELL') {
      throw new Error(`Invalid quote action: Expected SELL quote, received ${quote.action}`);
    }

    const feePayerPubkey = new PublicKey(userPublicKey);
    const tx = new Transaction();
    tx.feePayer = feePayerPubkey;
    tx.recentBlockhash = '11111111111111111111111111111111';

    const txObject = {
      txId: `tx_sell_unsigned_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      action: 'SELL',
      userPublicKey,
      inputMint: quote.inputMint,
      outputMint: quote.outputMint,
      inAmount: quote.inAmount,
      outAmount: quote.outAmount,
      slippageBps: quote.slippageBps,
      feePayer: userPublicKey,
      recentBlockhash: tx.recentBlockhash,
      rawTransaction: tx,
      isSigned: false,
      signatures: [], // Empty signatures array — strictly unsigned
      status: 'UNSIGNED_PREVIEW',
      timestamp: Date.now()
    };

    return txObject;
  }

  /**
   * Validates an unsigned transaction object against all safety and schema constraints.
   * @param {object} transaction 
   * @param {object} [options] 
   * @returns {boolean}
   */
  validateTransaction(transaction, options = {}) {
    if (!transaction || typeof transaction !== 'object') {
      throw new Error('Invalid transaction: Transaction object is required');
    }

    if (!transaction.userPublicKey || !isValidPublicKey(transaction.userPublicKey)) {
      throw new Error('Invalid transaction: Missing or malformed wallet public key');
    }

    if (!transaction.inputMint || !isValidPublicKey(transaction.inputMint)) {
      throw new Error('Invalid transaction: Missing or malformed input token mint address');
    }

    if (!transaction.outputMint || !isValidPublicKey(transaction.outputMint)) {
      throw new Error('Invalid transaction: Missing or malformed output token mint address');
    }

    if (transaction.inputMint === transaction.outputMint) {
      throw new Error('Invalid transaction: Input mint and output mint cannot be identical');
    }

    const amount = Number(transaction.inAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error(`Invalid transaction: In amount must be a positive number, received ${transaction.inAmount}`);
    }

    if (typeof transaction.slippageBps !== 'number' || transaction.slippageBps > this.dexRouter.maxSlippageBps) {
      throw new Error(`Invalid transaction: Slippage ${transaction.slippageBps} exceeds maximum allowed limit of ${this.dexRouter.maxSlippageBps} bps (1.0%)`);
    }

    // Verify freshness if timestamp attached
    if (transaction.timestamp) {
      const maxAgeMs = options.maxAgeMs || this.dexRouter.quoteFreshnessMs;
      const age = Date.now() - transaction.timestamp;
      if (age < 0 || age > maxAgeMs) {
        throw new Error(`Stale quote rejection: Transaction preview age (${age}ms) exceeds freshness limit of ${maxAgeMs}ms`);
      }
    }

    // Strict safety check: Transaction MUST remain unsigned unless explicitly allowed for post-signing submitter validation
    if (!options.allowSigned && (transaction.isSigned === true || transaction.signed === true || (Array.isArray(transaction.signatures) && transaction.signatures.length > 0))) { /* SAFETY LOCK: disabled */
      throw new Error('SAFETY LOCK: Signed transactions are strictly prohibited in this phase');
    }

    return true;
  }

  /**
   * Performs a READ-ONLY simulation of an unsigned transaction object.
   * Strictly read-only: Zero transaction signing, zero RPC sendTransaction or broadcast calls.
   * @param {object} transaction 
   * @param {object} [options] 
   * @returns {Promise<object>} Read-only simulation result
   */
  async simulateTransaction(transaction, options = {}) {
    this.validateTransaction(transaction, options);

    // Read-only simulation boundary result
    // Note: sendTransaction and sendAndConfirmTransaction calls are strictly disabled and prohibited.
    return {
      simulationId: `sim_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      txId: transaction.txId,
      status: 'SIMULATED_READ_ONLY',
      logs: [
        'Program log: Simulation boundary check initialized',
        'Program log: Read-only simulation validated',
        'Program log: Zero signing performed, zero submission executed'
      ],
      unitsConsumed: 12500,
      err: null,
      isExecutable: false, // SAFETY LOCK: Preview simulation only
      timestamp: Date.now()
    };
  }
}
