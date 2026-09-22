import { PublicKey } from '@solana/web3.js';

export const MAX_ALLOWED_SLIPPAGE_BPS = 100; // 1.0% maximum slippage limit
export const DEFAULT_SLIPPAGE_BPS = 50; // 0.5% default slippage
export const DEFAULT_QUOTE_FRESHNESS_MS = 3000; // 3000ms quote freshness limit

/**
 * Validates whether a given string is a valid base58 Solana public key address.
 * @param {string} address 
 * @returns {boolean}
 */
export function isValidPublicKey(address) {
  if (!address || typeof address !== 'string') return false;
  try {
    const pubkey = new PublicKey(address);
    return PublicKey.isOnCurve(pubkey.toBuffer());
  } catch {
    return false;
  }
}

/**
 * DEXRouter: Secure DEX Router abstraction for future LIVE execution.
 * Isolated boundary for Jupiter swap quotes and transaction preparation.
 * Strictly fail-closed: Zero real transaction creation, signing, or submission.
 */
export class DEXRouter {
  constructor(options = {}) {
    this.maxSlippageBps = options.maxSlippageBps || MAX_ALLOWED_SLIPPAGE_BPS;
    this.quoteFreshnessMs = options.quoteFreshnessMs || DEFAULT_QUOTE_FRESHNESS_MS;
    // Jupiter integration adapter boundary (placeholder for future Jupiter SDK/REST integration)
    this.jupiterAdapter = options.jupiterAdapter || null;
  }

  /**
   * Checks if LIVE trading authorization conditions are strictly met.
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
   * Validates token address.
   * @param {string} mintAddress 
   * @param {string} label 
   */
  validateMint(mintAddress, label = 'Token address') {
    if (!mintAddress || typeof mintAddress !== 'string' || !isValidPublicKey(mintAddress)) {
      throw new Error(`Invalid ${label}: '${mintAddress}' is not a valid Solana public address`);
    }
    return true;
  }

  /**
   * Validates swap amount (must be positive finite number).
   * @param {number} amount 
   */
  validateAmount(amount) {
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      throw new Error(`Invalid swap amount: Must be a positive finite number, received ${amount}`);
    }
    return true;
  }

  /**
   * Validates slippage BPS (max 100 bps / 1.0%).
   * @param {number} slippageBps 
   */
  validateSlippage(slippageBps = DEFAULT_SLIPPAGE_BPS) {
    if (typeof slippageBps !== 'number' || !Number.isFinite(slippageBps) || slippageBps < 0) {
      throw new Error(`Invalid slippage: Must be a non-negative number, received ${slippageBps}`);
    }
    if (slippageBps > this.maxSlippageBps) {
      throw new Error(`Excessive slippage: ${slippageBps} bps exceeds maximum allowed limit of ${this.maxSlippageBps} bps (1.0%)`);
    }
    return true;
  }

  /**
   * Checks whether a quote is fresh within specified maxAgeMs (default 3000ms).
   * @param {object} quote 
   * @param {number} maxAgeMs 
   * @returns {boolean}
   */
  isQuoteFresh(quote, maxAgeMs = this.quoteFreshnessMs) {
    if (!quote || typeof quote !== 'object' || typeof quote.timestamp !== 'number') {
      return false;
    }
    const age = Date.now() - quote.timestamp;
    return age >= 0 && age <= maxAgeMs;
  }

  /**
   * Validates quote freshness, throwing if stale.
   * @param {object} quote 
   * @param {number} maxAgeMs 
   */
  validateQuoteFreshness(quote, maxAgeMs = this.quoteFreshnessMs) {
    if (!quote || typeof quote !== 'object') {
      throw new Error('Invalid quote: Quote object is required');
    }
    if (typeof quote.timestamp !== 'number') {
      throw new Error('Invalid quote: Missing timestamp field');
    }
    const age = Date.now() - quote.timestamp;
    if (age < 0 || age > maxAgeMs) {
      throw new Error(`Stale quote rejected: Quote age (${age}ms) exceeds maximum freshness limit of ${maxAgeMs}ms`);
    }
    return true;
  }

  /**
   * Validates a complete swap quote object against all safety constraints.
   * Checks token pair, quote freshness, output amount, and slippage limits.
   * 
   * @param {object} quote 
   * @returns {boolean}
   */
  validateQuote(quote) {
    if (!quote || typeof quote !== 'object') {
      throw new Error('Invalid quote: Quote object is required');
    }
    this.validateMint(quote.inputMint, 'input token mint');
    this.validateMint(quote.outputMint, 'output token mint');
    if (quote.inputMint === quote.outputMint) {
      throw new Error('Invalid mint pair: input mint and output mint cannot be identical');
    }
    const outAmountNum = Number(quote.outAmount);
    if (!Number.isFinite(outAmountNum) || outAmountNum <= 0) {
      throw new Error(`Invalid output amount: Expected positive output amount, received '${quote.outAmount}'`);
    }
    this.validateSlippage(quote.slippageBps);
    this.validateQuoteFreshness(quote);
    return true;
  }

  /**
   * Obtains a buy swap quote abstraction suitable for future Jupiter integration.
   * @param {string} inputMint 
   * @param {string} outputMint 
   * @param {number} amount 
   * @param {number} slippageBps 
   * @returns {Promise<object>}
   */
  async getBuyQuote(inputMint, outputMint, amount, slippageBps = DEFAULT_SLIPPAGE_BPS) {
    this.validateMint(inputMint, 'input token mint');
    this.validateMint(outputMint, 'output token mint');
    if (inputMint === outputMint) {
      throw new Error('Invalid mint pair: input mint and output mint cannot be identical');
    }
    this.validateAmount(amount);
    this.validateSlippage(slippageBps);

    // Jupiter integration adapter boundary: Structured quote abstraction
    const quote = {
      protocol: 'Jupiter',
      action: 'BUY',
      inputMint,
      outputMint,
      inAmount: String(amount),
      outAmount: String(amount * 1000), // Estimated out amount calculation preview
      slippageBps,
      priceImpactPct: 0.05,
      routePlan: [
        {
          swapInfo: {
            ammKey: 'JupiterRoutePlaceholder',
            label: 'Jupiter DEX'
          }
        }
      ],
      timestamp: Date.now(),
      quoteId: `jup_quote_buy_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      isExecutable: false // SAFETY LOCK: Preview quote only
    };

    return quote;
  }

  /**
   * Obtains a sell swap quote abstraction suitable for future Jupiter integration.
   * @param {string} inputMint 
   * @param {string} outputMint 
   * @param {number} amount 
   * @param {number} slippageBps 
   * @returns {Promise<object>}
   */
  async getSellQuote(inputMint, outputMint, amount, slippageBps = DEFAULT_SLIPPAGE_BPS) {
    this.validateMint(inputMint, 'input token mint');
    this.validateMint(outputMint, 'output token mint');
    if (inputMint === outputMint) {
      throw new Error('Invalid mint pair: input mint and output mint cannot be identical');
    }
    this.validateAmount(amount);
    this.validateSlippage(slippageBps);

    const quote = {
      protocol: 'Jupiter',
      action: 'SELL',
      inputMint,
      outputMint,
      inAmount: String(amount),
      outAmount: String(amount / 1000),
      slippageBps,
      priceImpactPct: 0.05,
      routePlan: [
        {
          swapInfo: {
            ammKey: 'JupiterRoutePlaceholder',
            label: 'Jupiter DEX'
          }
        }
      ],
      timestamp: Date.now(),
      quoteId: `jup_quote_sell_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      isExecutable: false // SAFETY LOCK: Preview quote only
    };

    return quote;
  }

  /**
   * Build buy swap transaction interface for future LIVE execution.
   * Strictly fail-closed in Step 2 preview mode.
   * @param {object} quote 
   * @param {string} userPublicKey 
   */
  async buildBuySwapTransaction(quote, userPublicKey) {
    if (!this.isLiveExecutionAuthorized()) {
      throw new Error('SAFETY LOCK: Live swap execution prohibited. TRADING_MODE must be LIVE and global.ALLOW_LIVE_EXECUTION must be true');
    }
    if (!userPublicKey || !isValidPublicKey(userPublicKey)) {
      throw new Error('Missing wallet public key: Valid user public key is required for building swap transaction');
    }
    this.validateQuoteFreshness(quote);

    // Step 2 safety lock: Transaction building and signing disabled in Step 2.
    throw new Error('SAFETY LOCK: Transaction building and signing disabled in Step 2 preview mode. No live transaction created');
  }

  /**
   * Build sell swap transaction interface for future LIVE execution.
   * Strictly fail-closed in Step 2 preview mode.
   * @param {object} quote 
   * @param {string} userPublicKey 
   */
  async buildSellSwapTransaction(quote, userPublicKey) {
    if (!this.isLiveExecutionAuthorized()) {
      throw new Error('SAFETY LOCK: Live swap execution prohibited. TRADING_MODE must be LIVE and global.ALLOW_LIVE_EXECUTION must be true');
    }
    if (!userPublicKey || !isValidPublicKey(userPublicKey)) {
      throw new Error('Missing wallet public key: Valid user public key is required for building swap transaction');
    }
    this.validateQuoteFreshness(quote);

    // Step 2 safety lock: Transaction building and signing disabled in Step 2.
    throw new Error('SAFETY LOCK: Transaction building and signing disabled in Step 2 preview mode. No live transaction created');
  }
}
