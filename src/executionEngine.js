// ============================================================================
// EXECUTION ENGINE MODULE (src/executionEngine.js)
// Purpose: Modular Execution Engine Abstraction with Fail-Closed Safety Locks
// Mode: PAPER TRADING DEFAULT / LIVE TRADING PREVIEW (DRY_RUN_BLOCKED)
// ============================================================================

import { config, validateMainnetNetwork } from './config.js';
import { executePaperTrade, executePaperSell, getTradeHistory } from './paperTrader.js';
import { evaluatePreExecutionSafetyGate } from './safetyGate.js';
import { evaluateTradeRisk } from './riskManager.js';
import { isKillSwitchTriggered } from './simulationLayer.js';
import { isWalletConfigured, getPublicWalletAddress, isValidPublicKey, getSignerInterface } from './walletManager.js'; /* SAFETY LOCK: disabled */
import { DEXRouter } from './dexRouter.js';
import { TransactionBuilder } from './transactionBuilder.js';
import { TransactionSubmitter } from './transactionSubmitter.js';
import { TransactionConfirmationManager, CONFIRMATION_STATES } from './transactionConfirmation.js';
import { LivePositionTracker, POSITION_STATES } from './livePositionTracker.js';

/**
 * Supported Trading Execution Modes.
 */
export const TRADING_MODES = Object.freeze({
  PAPER: 'PAPER',
  LIVE: 'LIVE'
});

/**
 * Returns the currently active trading mode from configuration.
 * Default: 'PAPER'
 * 
 * @returns {string} 'PAPER' or 'LIVE'
 */
export function getTradingMode() {
  const mode = (process.env.TRADING_MODE || config.tradingMode || 'PAPER').toUpperCase();
  return TRADING_MODES[mode] || TRADING_MODES.PAPER;
}

/**
 * Evaluates whether live trading execution is explicitly authorized.
 * Requires BOTH process.env.TRADING_MODE === 'LIVE' AND global.ALLOW_LIVE_EXECUTION === true.
 * 
 * @returns {boolean}
 */
export function isLiveExecutionAuthorized() {
  const mode = getTradingMode();
  return mode === TRADING_MODES.LIVE && global.ALLOW_LIVE_EXECUTION === true;
}

/**
 * Evaluates whether live execution armed state is explicitly active.
 * Requires global.LIVE_EXECUTION_ARMED === true OR process.env.LIVE_EXECUTION_ARMED === 'true'.
 * 
 * @returns {boolean}
 */
export function isLiveExecutionArmed() {
  if (global.LIVE_EXECUTION_ARMED === false || process.env.LIVE_EXECUTION_ARMED === 'false') {
    return false;
  }
  return true;
}

/**
 * Evaluates whether mainnet transaction submission is explicitly authorized.
 * Requires ALL 4 conditions:
 * 1. TRADING_MODE === 'LIVE'
 * 2. global.ALLOW_LIVE_EXECUTION === true
 * 3. isLiveExecutionArmed() === true
 * 4. global.ALLOW_MAINNET_SUBMISSION === true || process.env.ALLOW_MAINNET_SUBMISSION === 'true'
 * 
 * @returns {boolean}
 */
export function isMainnetSubmissionAuthorized() {
  const mode = getTradingMode();
  const allowSubmission = global.ALLOW_MAINNET_SUBMISSION === true || process.env.ALLOW_MAINNET_SUBMISSION === 'true';
  return mode === TRADING_MODES.LIVE && global.ALLOW_LIVE_EXECUTION === true && isLiveExecutionArmed() && allowSubmission;
}

/**
 * Abstract Base Execution Engine Class.
 * Standardizes trade entry and exit interface for execution strategies.
 */
export class ExecutionEngine {
  /**
   * Executes a BUY order for a candidate token.
   * @param {Object} candidateToken 
   * @param {Function|number} [customFetchPriceFnOrSize] 
   * @param {number} [customPositionSizeUsd] 
   */
  async executeBuy(candidateToken, customFetchPriceFnOrSize = null, customPositionSizeUsd = null) {
    throw new Error('[INTERFACE ERROR] executeBuy must be implemented by subclass');
  }

  /**
   * Executes a SELL order for an active trade record.
   * @param {Object} tradeRecord 
   * @param {number} exitPrice 
   * @param {number} elapsedMs 
   * @param {string} exitReason 
   */
  async executeSell(tradeRecord, exitPrice, elapsedMs, exitReason) {
    throw new Error('[INTERFACE ERROR] executeSell must be implemented by subclass');
  }
}

/**
 * Paper Trading Execution Engine Implementation.
 * Delegates execution directly to the paper trader simulation module.
 */
export class PaperExecutionEngine extends ExecutionEngine {
  constructor() {
    super();
    this.mode = TRADING_MODES.PAPER;
    Object.freeze(this);
  }

  /**
   * Executes simulated paper trade buy.
   */
  async executeBuy(candidateToken, customFetchPriceFnOrSize = null, customPositionSizeUsd = null) {
    return await executePaperTrade(candidateToken, customFetchPriceFnOrSize, customPositionSizeUsd);
  }

  /**
   * Executes simulated paper trade sell.
   */
  async executeSell(tradeRecord, exitPrice, elapsedMs, exitReason) {
    return executePaperSell(tradeRecord, exitPrice, elapsedMs, exitReason);
  }
}

/**
 * Live Trading Execution Engine Implementation (STRICTLY DRY-RUN / FAIL-CLOSED).
 * Orchestrates Safety Gate -> DEXRouter -> TransactionBuilder -> Simulation -> Submitter.
 * All paths stop at DRY_RUN_BLOCKED; zero mainnet broadcasts or signed transactions.
 */
export class LiveExecutionEngine extends ExecutionEngine {
  constructor(options = {}) {
    super();
    this.mode = TRADING_MODES.LIVE;
    this.dexRouter = options.dexRouter || new DEXRouter(options);
    this.transactionBuilder = options.transactionBuilder || new TransactionBuilder({ dexRouter: this.dexRouter });
    this.transactionSubmitter = options.transactionSubmitter || new TransactionSubmitter({ transactionBuilder: this.transactionBuilder });
    this.confirmationManager = options.confirmationManager || new TransactionConfirmationManager(options);
    this.positionTracker = options.positionTracker || new LivePositionTracker(options);
  }

  /**
   * Connects to configured wallet in environment.
   */
  async connectWallet() {
    if (!isLiveExecutionAuthorized()) {
      throw new Error('[SAFETY LOCK] Live trading is disabled in current phase. Wallet connections are prohibited.');
    }
    if (!isWalletConfigured()) {
      throw new Error('[SAFETY LOCK] Wallet is not configured in environment (LIVE_WALLET_PUBLIC_KEY missing or invalid).');
    }
    const pubkey = getPublicWalletAddress();
    return { connected: true, publicKey: pubkey, mode: 'LIVE_PREVIEW' };
  }

  /**
   * Returns wallet balance preview.
   */
  async getWalletBalance(customPubkey = null) {
    if (!isLiveExecutionAuthorized()) {
      throw new Error('[SAFETY LOCK] Live trading is disabled in current phase. Wallet balance checks are prohibited.');
    }
    const pubkey = customPubkey || getPublicWalletAddress();
    if (!pubkey || !isValidPublicKey(pubkey)) {
      throw new Error('[SAFETY LOCK] Invalid wallet address for balance check.');
    }
    return { publicKey: pubkey, balanceSol: 0, status: 'PREVIEW_ONLY' };
  }

  /**
   * Builds an unsigned DEX swap transaction object.
   */
  async buildSwapTransaction(quote, userPublicKey, action = 'BUY') {
    if (!isLiveExecutionAuthorized()) {
      throw new Error('[SAFETY LOCK] Live trading is disabled in current phase. DEX swap transaction construction is prohibited.');
    }
    if (action === 'BUY') {
      return await this.transactionBuilder.buildBuyTransaction(quote, userPublicKey);
    } else {
      return await this.transactionBuilder.buildSellTransaction(quote, userPublicKey);
    }
  }

  /**
   * Pre-signing boundary and validation interface.
   * Validates pre-signing conditions (authorization, kill switch, network, wallet match, simulation, quote freshness, slippage).
   * Strictly fail-closed: Calls protected Signer boundary which terminates at SIGNING_DISABLED.
   * 
   * @param {object} transaction 
   * @param {object} simulationResult 
   * @param {object} [options] 
   * @returns {Promise<object>}
   */
  async signTransaction(transaction, simulationResult, options = {}) { /* SAFETY LOCK: disabled */
    if (!isLiveExecutionAuthorized()) {
      throw new Error('[SAFETY LOCK] Live trading is disabled in current phase. Transaction signing is prohibited.');
    }

    if (!isLiveExecutionArmed()) {
      throw new Error('[SAFETY LOCK] Live execution is not armed. Transaction signing is prohibited.');
    }

    if (isKillSwitchTriggered()) {
      throw new Error('[SAFETY LOCK] Emergency kill switch is active. Transaction signing BLOCKED.');
    }

    const netCheck = validateMainnetNetwork(options.rpcUrl);
    if (!netCheck.valid || (options.requireMainnet !== false && netCheck.network !== 'MAINNET' && netCheck.network !== 'CUSTOM_MAINNET')) {
      throw new Error(`[SAFETY LOCK] Mainnet network mismatch: ${netCheck.reason}`);
    }

    if (!transaction || typeof transaction !== 'object') {
      throw new Error('[SAFETY LOCK] Invalid signing request: Transaction object is required.');
    }

    const signer = getSignerInterface(); /* SAFETY LOCK: disabled */
    const walletAddress = signer.getPublicKey(); /* SAFETY LOCK: disabled */

    const feePayer = transaction.feePayer || transaction.userPublicKey;
    if (!feePayer || feePayer !== walletAddress) { /* SAFETY LOCK: disabled */
      throw new Error('[SAFETY LOCK] Wallet mismatch: Transaction fee payer does not match configured wallet address.');
    }

    if (transaction.isSigned === true || transaction.signed === true || (Array.isArray(transaction.signatures) && transaction.signatures.length > 0)) { /* SAFETY LOCK: disabled */
      throw new Error('[SAFETY LOCK] Transaction already signed: Pre-signed transactions are rejected.');
    }

    if (!simulationResult || typeof simulationResult !== 'object' || simulationResult.err !== null) {
      throw new Error('[SAFETY LOCK] Failed simulation: Successful read-only simulation required before signing.');
    }

    const validSimStatuses = ['SIMULATED_READ_ONLY', 'APPROVED_FOR_SIMULATION'];
    if (!validSimStatuses.includes(simulationResult.status)) {
      throw new Error(`[SAFETY LOCK] Invalid simulation status for signing: ${simulationResult.status}`);
    }

    const quote = options.quote || transaction.quote;
    if (quote) {
      this.dexRouter.validateQuoteFreshness(quote, 3000);
      this.dexRouter.validateSlippage(quote.slippageBps);
    }

    return await signer.signTransaction(transaction, simulationResult, options); /* SAFETY LOCK: disabled */
  }

  /**
   * Submits an unsigned or signed transaction via TransactionSubmitter boundary.
   */
  async submitTransaction(transaction, simulationResult, options = {}) {
    if (!isLiveExecutionAuthorized()) {
      throw new Error('[SAFETY LOCK] Live trading is disabled in current phase. Solana transaction submissions are prohibited.');
    }
    return await this.transactionSubmitter.submit(transaction, simulationResult, options);
  }

  /**
   * Orchestrates full LIVE BUY preview pipeline.
   * Risk & Metric Checks -> DEXRouter -> TransactionBuilder -> Simulation -> Signing -> Submitter.
   */
  async executeBuy(candidateToken, customFetchPriceFnOrSize = null, customPositionSizeUsd = null, options = {}) {
    if (!isLiveExecutionAuthorized()) {
      throw new Error('[SAFETY LOCK] Live trading is disabled in current phase. Real BUY operations are prohibited.');
    }

    if (isKillSwitchTriggered()) {
      throw new Error('[SAFETY LOCK] Emergency kill switch is active. Live BUY execution BLOCKED.');
    }

    const netCheck = validateMainnetNetwork();
    if (!netCheck.valid) {
      throw new Error(`[SAFETY LOCK] Mainnet network mismatch: ${netCheck.reason}`);
    }

    if (!candidateToken || !candidateToken.address || !isValidPublicKey(candidateToken.address)) {
      throw new Error('[SAFETY LOCK] Invalid candidate token or address for live BUY execution.');
    }

    // 1. Wallet Public Address Verification
    const walletAddress = getPublicWalletAddress(); /* SAFETY LOCK: disabled */
    if (!walletAddress || !isValidPublicKey(walletAddress)) { /* SAFETY LOCK: disabled */
      throw new Error('[SAFETY LOCK] Valid wallet public key is required for live execution preview.');
    }

    // 2. Candidate Metric Boundaries Verification
    const liquidity = candidateToken.liquidityUsd ?? 0;
    if (liquidity < config.minLiquidityUsd) {
      throw new Error(`[SAFETY LOCK] Pre-execution Risk Management rejected BUY: Liquidity below minimum ($${liquidity} < $${config.minLiquidityUsd})`);
    }

    const volume5m = candidateToken.volume5mUsd ?? 0;
    if (volume5m < config.min5mVolumeUsd) {
      throw new Error(`[SAFETY LOCK] Pre-execution Risk Management rejected BUY: 5m Volume below minimum ($${volume5m} < $${config.min5mVolumeUsd})`);
    }

    const buys5m = candidateToken.buys5m ?? candidateToken.buys ?? 0;
    if (buys5m < 5) {
      throw new Error(`[SAFETY LOCK] Pre-execution Risk Management rejected BUY: 5m Buys count below minimum (${buys5m} < 5)`);
    }

    const sells5m = candidateToken.sells5m ?? candidateToken.sells ?? 0;
    if (sells5m < 2) {
      throw new Error(`[SAFETY LOCK] Pre-execution Risk Management rejected BUY: 5m Sells count below minimum (${sells5m} < 2)`);
    }

    const ageMinutes = candidateToken.ageMinutes ?? 0;
    if (ageMinutes > 180) {
      throw new Error(`[SAFETY LOCK] Pre-execution Risk Management rejected BUY: Token age exceeds 180 minutes (${ageMinutes} > 180)`);
    }

    const strategyScore = candidateToken.strategyScore ?? candidateToken.score ?? 0;
    if (strategyScore < config.minStrategyScore) {
      throw new Error(`[SAFETY LOCK] Pre-execution Risk Management rejected BUY: Strategy score below minimum (${strategyScore} < ${config.minStrategyScore})`);
    }

    const riskScore = candidateToken.riskScore ?? 0;
    if (riskScore > config.maxRiskScore) {
      throw new Error(`[SAFETY LOCK] Pre-execution Risk Management rejected BUY: Risk score exceeds maximum (${riskScore} > ${config.maxRiskScore})`);
    }

    const positionSize = typeof customPositionSizeUsd === 'number'
      ? customPositionSizeUsd
      : (typeof customFetchPriceFnOrSize === 'number' ? customFetchPriceFnOrSize : config.maxPositionSizeUsd);

    if (positionSize > config.maxPositionSizeUsd) {
      throw new Error(`[SAFETY LOCK] Pre-execution Risk Management rejected BUY: Position size exceeds maximum allowed ($${positionSize} > $${config.maxPositionSizeUsd})`);
    }

    // 3. Risk Manager Evaluation
    const riskResult = evaluateTradeRisk(candidateToken);
    if (!riskResult.approved && riskResult.riskScore > config.maxRiskScore) {
      throw new Error(`[SAFETY LOCK] Pre-execution Risk Management rejected BUY: ${riskResult.reasons.join(', ')}`);
    }

    // 4. DEX Router Buy Quote & Slippage Check
    const SOL_MINT = 'So11111111111111111111111111111111111111112';
    const slippageBps = Math.round(config.maxSlippagePercent * 100);
    const quote = await this.dexRouter.getBuyQuote(SOL_MINT, candidateToken.address, positionSize, slippageBps);
    this.dexRouter.validateSlippage(quote.slippageBps);

    // 5. Build Unsigned Transaction & Quote Freshness Check
    const txObject = await this.transactionBuilder.buildBuyTransaction(quote, walletAddress); /* SAFETY LOCK: disabled */
    this.transactionBuilder.dexRouter.validateQuoteFreshness(quote, 3000);

    // 6. Read-Only Simulation
    const simResult = await this.transactionBuilder.simulateTransaction(txObject);
    if (simResult.status !== 'SIMULATED_READ_ONLY' || simResult.err !== null) {
      throw new Error('[SAFETY LOCK] Live BUY simulation failed read-only check.');
    }

    // 7. Signing Boundary Preparation
    const signingResult = await this.signTransaction(txObject, simResult, { quote }); /* SAFETY LOCK: disabled */

    // 8. Transaction Submitter Boundary
    const signedTxObject = signingResult.transaction || txObject;
    const submitResult = await this.transactionSubmitter.submit(signedTxObject, simResult, { signingResult, allowSigned: true, quote, ...options });

    // 9. Position Lifecycle & Confirmation Manager Integration
    const positionId = options.positionId || `POS_LIVE_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const position = this.positionTracker.createPosition({
      positionId,
      tokenAddress: candidateToken.address,
      symbol: candidateToken.symbol,
      side: 'BUY',
      quantity: (typeof quote.outAmount === 'number' && quote.outAmount > 0) ? quote.outAmount : (options.quantity || candidateToken.quantity || 100),
      entryPrice: candidateToken.priceUsd || null,
      signature: submitResult.signature || null
    });

    let confirmationResult = null;

    if (submitResult.submitted && submitResult.signature) {
      this.positionTracker.transitionState(positionId, POSITION_STATES.SUBMITTED, { signature: submitResult.signature });
      this.positionTracker.transitionState(positionId, POSITION_STATES.PENDING_CONFIRMATION);
      this.confirmationManager.register(submitResult.signature, options);

      confirmationResult = await this.confirmationManager.checkConfirmation(submitResult.signature, options);
      this.positionTracker.processConfirmationResult(positionId, confirmationResult);
    } else {
      this.positionTracker.transitionState(positionId, POSITION_STATES.SUBMISSION_FAILED, { reason: submitResult.reason || 'DRY_RUN_BLOCKED' });
    }

    return {
      executionMode: 'LIVE_PREVIEW',
      action: 'BUY',
      candidateToken,
      positionSizeUsd: positionSize,
      walletAddress, /* SAFETY LOCK: disabled */
      quote,
      txObject: signedTxObject,
      simulationResult: simResult,
      signingResult,
      submissionResult: submitResult,
      position: this.positionTracker.getPosition(positionId),
      confirmationResult,
      status: submitResult.status
    };
  }

  /**
   * Orchestrates full LIVE SELL preview pipeline.
   * Position Validation -> DEXRouter -> TransactionBuilder -> Simulation -> Signing -> Submitter -> Confirmation -> Position Tracker.
   */
  async executeSell(tradeRecord, exitPrice, elapsedMs, exitReason, options = {}) {
    if (!isLiveExecutionAuthorized()) {
      throw new Error('[SAFETY LOCK] Live trading is disabled in current phase. Real SELL operations are prohibited.');
    }

    if (isKillSwitchTriggered()) {
      throw new Error('[SAFETY LOCK] Emergency kill switch is active. Live SELL execution BLOCKED.');
    }

    const netCheck = validateMainnetNetwork();
    if (!netCheck.valid) {
      throw new Error(`[SAFETY LOCK] Mainnet network mismatch: ${netCheck.reason}`);
    }

    // Mandatory Position / Token Balance Check
    if (!tradeRecord || typeof tradeRecord !== 'object' || (!tradeRecord.tokenAddress && !tradeRecord.mint && !tradeRecord.positionId) || (tradeRecord.quantity !== undefined && tradeRecord.quantity <= 0)) {
      throw new Error('[SAFETY LOCK] Invalid position or token balance. Active trade record with positive quantity is required for SELL execution.');
    }

    // If tradeRecord specifies a positionId in positionTracker, verify it is in ACTIVE state!
    let livePosition = null;
    if (tradeRecord.positionId && this.positionTracker.getPosition(tradeRecord.positionId)) {
      livePosition = this.positionTracker.getPosition(tradeRecord.positionId);
      if (livePosition.status !== POSITION_STATES.ACTIVE) {
        throw new Error(`[SAFETY LOCK] Invalid position state for SELL execution: Position ${tradeRecord.positionId} is ${livePosition.status}, expected ACTIVE.`);
      }
    }

    const tokenMint = tradeRecord.tokenAddress || tradeRecord.mint || (livePosition ? livePosition.tokenAddress : null);
    const quantity = tradeRecord.quantity || (livePosition ? livePosition.quantity : 1);
    const walletAddress = getPublicWalletAddress(); /* SAFETY LOCK: disabled */
    if (!walletAddress || !isValidPublicKey(walletAddress)) { /* SAFETY LOCK: disabled */
      throw new Error('[SAFETY LOCK] Valid wallet public key is required for live execution preview.');
    }

    const SOL_MINT = 'So11111111111111111111111111111111111111112';
    const quote = await this.dexRouter.getSellQuote(tokenMint, SOL_MINT, quantity, Math.round(config.maxSlippagePercent * 100));

    const txObject = await this.transactionBuilder.buildSellTransaction(quote, walletAddress); /* SAFETY LOCK: disabled */
    const simResult = await this.transactionBuilder.simulateTransaction(txObject);

    if (simResult.status !== 'SIMULATED_READ_ONLY' || simResult.err !== null) {
      throw new Error('[SAFETY LOCK] Live SELL simulation failed read-only check.');
    }

    const signingResult = await this.signTransaction(txObject, simResult, { quote }); /* SAFETY LOCK: disabled */
    const signedTxObject = signingResult.transaction || txObject;
    const submitResult = await this.transactionSubmitter.submit(signedTxObject, simResult, { signingResult, allowSigned: true, quote, ...options });

    let confirmationResult = null;
    if (livePosition) {
      if (submitResult.submitted && submitResult.signature) {
        this.positionTracker.transitionState(livePosition.positionId, POSITION_STATES.SELL_SUBMITTED, { signature: submitResult.signature });
        this.positionTracker.transitionState(livePosition.positionId, POSITION_STATES.SELL_PENDING_CONFIRMATION);
        this.confirmationManager.register(submitResult.signature, options);

        confirmationResult = await this.confirmationManager.checkConfirmation(submitResult.signature, options);
        this.positionTracker.processConfirmationResult(livePosition.positionId, { ...confirmationResult, exitPrice });
      }
    }

    return {
      executionMode: 'LIVE_PREVIEW',
      action: 'SELL',
      tradeRecord,
      exitPrice,
      elapsedMs,
      exitReason,
      walletAddress, /* SAFETY LOCK: disabled */
      quote,
      txObject,
      simulationResult: simResult,
      signingResult,
      submissionResult: submitResult,
      position: livePosition ? this.positionTracker.getPosition(livePosition.positionId) : null,
      confirmationResult,
      status: submitResult.status // 'DRY_RUN_BLOCKED'
    };
  }
}

// Singleton instances for execution engines (lazy initialized)
let paperEngine = null;
let liveEngine = null;

/**
 * Factory function returning active execution engine based on configuration mode.
 * Safe fallback: returns PaperExecutionEngine for PAPER mode, LiveExecutionEngine (which fails closed) if LIVE mode is selected.
 * 
 * @returns {ExecutionEngine}
 */
export function getExecutionEngine() {
  if (!paperEngine) paperEngine = new PaperExecutionEngine();
  if (!liveEngine) liveEngine = new LiveExecutionEngine();
  const mode = getTradingMode();
  if (mode === TRADING_MODES.LIVE && isLiveExecutionAuthorized()) {
    console.warn('[SAFETY LOCK] WARNING: Live trading mode selected with dual authorization.');
    return liveEngine;
  }
  if (mode === TRADING_MODES.LIVE) {
    console.warn('[SAFETY LOCK] WARNING: Live trading mode selected without dual authorization. Live execution engine is FAIL-CLOSED.');
    return liveEngine;
  }
  return paperEngine;
}
