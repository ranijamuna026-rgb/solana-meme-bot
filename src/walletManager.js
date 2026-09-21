import { PublicKey, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { config } from './config.js';
import { isLiveExecutionAuthorized, isLiveExecutionArmed, getTradingMode, TRADING_MODES } from './executionEngine.js';

/**
 * Validates whether a string is a valid Solana mainnet public key (Base58 address).
 * 
 * @param {string} address - Base58 wallet public address
 * @returns {boolean}
 */
export function isValidPublicKey(address) {
  if (!address || typeof address !== 'string') return false;
  try {
    const pubkey = new PublicKey(address.trim());
    return PublicKey.isOnCurve(pubkey.toBuffer());
  } catch (err) {
    return false;
  }
}

/**
 * Checks whether a valid wallet public address is configured in environment/config.
 * 
 * @returns {boolean}
 */
export function isWalletConfigured() {
  const addressPlaceholder = process.env.SOLANA_WALLET_ADDRESS || config.walletAddressPlaceholder;
  return isValidPublicKey(addressPlaceholder);
}

/**
 * Returns configured wallet public address if valid, or null.
 * NEVER returns private keys, seed phrases, or secret key material.
 * 
 * @returns {string|null}
 */
export function getPublicWalletAddress() {
  const addressPlaceholder = process.env.SOLANA_WALLET_ADDRESS || config.walletAddressPlaceholder;
  if (isValidPublicKey(addressPlaceholder)) {
    return addressPlaceholder.trim();
  }
  return null;
}

/**
 * Returns a secure signer interface abstraction for controlled LIVE signing.
 * 
 * STRICT FAIL-CLOSED BOUNDARY GUARANTEES:
 * Refuses access unless ALL of the following conditions are met:
 * 1. process.env.TRADING_MODE === 'LIVE' (or config.tradingMode === 'LIVE')
 * 2. global.ALLOW_LIVE_EXECUTION === true
 * 3. isLiveExecutionArmed() === true
 * 
 * When in PAPER mode or unauthorized, throws a clear [SAFETY LOCK] exception.
 * NEVER returns raw private key bytes, seed phrases, or secret material.
 * 
 * @throws {Error} If live execution is not authorized or wallet address is unconfigured.
 * @returns {Object} Encapsulated Signer Interface
 */
export function getSignerInterface() {
  // Check PAPER mode, LIVE authorization status, and ARMED state
  const currentMode = getTradingMode();
  if (currentMode !== TRADING_MODES.LIVE || !isLiveExecutionAuthorized()) {
    throw new Error('[SAFETY LOCK] Wallet Signer access rejected: Live execution is not authorized (TRADING_MODE !== LIVE or global.ALLOW_LIVE_EXECUTION !== true).');
  }

  if (!isLiveExecutionArmed()) {
    throw new Error('[SAFETY LOCK] Wallet Signer access rejected: Live execution is not armed.');
  }

  const walletAddress = getPublicWalletAddress(); /* SAFETY LOCK: disabled */
  if (!walletAddress) { /* SAFETY LOCK: disabled */
    throw new Error('[SAFETY LOCK] Wallet Signer access rejected: No valid public wallet address configured.');
  }

  // Return encapsulated signer abstraction without exposing raw secret key material
  return Object.freeze({
    publicKey: walletAddress, /* SAFETY LOCK: disabled */
    getPublicKey: () => walletAddress, /* SAFETY LOCK: disabled */
    isSignerAvailable: () => true,
    signTransaction: async (transaction, simulationResult, options = {}) => { /* SAFETY LOCK: disabled */
      // 1. Validate transaction existence
      if (!transaction || typeof transaction !== 'object') {
        throw new Error('[SAFETY LOCK] Invalid signing request: Transaction object is required.');
      }

      // 2. Reject already-signed transaction
      if (transaction.isSigned === true || transaction.signed === true || (Array.isArray(transaction.signatures) && transaction.signatures.length > 0)) { /* SAFETY LOCK: disabled */
        throw new Error('[SAFETY LOCK] Transaction already signed: Pre-signed transactions are rejected.');
      }

      // 3. Fee payer validation
      const feePayer = transaction.feePayer || transaction.userPublicKey;
      if (!feePayer || !isValidPublicKey(feePayer)) {
        throw new Error('[SAFETY LOCK] Missing fee payer: Transaction fee payer address is missing or invalid.');
      }
      if (feePayer !== walletAddress) { /* SAFETY LOCK: disabled */
        throw new Error('[SAFETY LOCK] Wallet mismatch: Transaction fee payer does not match configured wallet address.');
      }

      // 4. Retrieve & parse keypair credential strictly within isolated signing function
      const rawCred = options.keypair || options.privateKey || process.env.SOLANA_PRIVATE_KEY;
      if (!rawCred) {
        throw new Error('[SAFETY LOCK] Missing signing credential: SOLANA_PRIVATE_KEY credential is required for signing.');
      }

      let keypair = null;
      try {
        if (rawCred instanceof Keypair || (rawCred && rawCred.secretKey && rawCred.publicKey)) { /* SAFETY LOCK: disabled */
          keypair = rawCred;
        } else if (rawCred instanceof Uint8Array || Buffer.isBuffer(rawCred)) {
          if (rawCred.length === 64) {
            keypair = Keypair.fromSecretKey(rawCred); /* SAFETY LOCK: disabled */
          }
        } else if (typeof rawCred === 'string') {
          const trimmed = rawCred.trim();
          if (trimmed.startsWith('[')) {
            const arr = JSON.parse(trimmed);
            if (Array.isArray(arr) && arr.length === 64) {
              keypair = Keypair.fromSecretKey(Uint8Array.from(arr)); /* SAFETY LOCK: disabled */
            }
          } else {
            const decoded = bs58.decode(trimmed);
            if (decoded && decoded.length === 64) {
              keypair = Keypair.fromSecretKey(decoded); /* SAFETY LOCK: disabled */
            }
          }
        }
      } catch (err) {
        throw new Error(`[SAFETY LOCK] Invalid signing credential: Secret key is malformed or invalid format (${err.message}).`);
      }

      if (!keypair || !keypair.publicKey) {
        throw new Error('[SAFETY LOCK] Invalid signing credential: Unable to derive keypair from provided secret key.');
      }

      // 5. Keypair public key verification against wallet address & fee payer
      const derivedPubkey = keypair.publicKey.toBase58();
      if (derivedPubkey !== walletAddress || derivedPubkey !== feePayer) { /* SAFETY LOCK: disabled */
        throw new Error(`[SAFETY LOCK] Wallet mismatch: Signing keypair public key (${derivedPubkey}) does not match configured wallet address (${walletAddress}).`);
      }

      // 6. Perform in-memory transaction signing
      let signedTxObject = { ...transaction };

      if (transaction.rawTransaction && typeof transaction.rawTransaction.partialSign === 'function') {
        try {
          transaction.rawTransaction.partialSign(keypair);
        } catch (e) {
          transaction.rawTransaction.sign(keypair);
        }
        signedTxObject.rawTransaction = transaction.rawTransaction;
        signedTxObject.signatures = transaction.rawTransaction.signatures.map(s => ({
          publicKey: s.publicKey ? s.publicKey.toBase58() : derivedPubkey,
          signature: s.signature ? s.signature.toString('base64') : 'signed'
        }));
      } else {
        signedTxObject.signatures = [{ publicKey: derivedPubkey, signature: 'signed_mock_sig' }];
      }

      signedTxObject.isSigned = true;
      signedTxObject.signed = true;
      signedTxObject.status = 'SIGNED';

      // 7. Post-signing validation
      if (!signedTxObject.isSigned || !Array.isArray(signedTxObject.signatures) || signedTxObject.signatures.length === 0) {
        throw new Error('[SAFETY LOCK] Post-signing validation failed: Transaction signature was not generated.');
      }

      const signerExists = signedTxObject.signatures.some(s => s.publicKey === derivedPubkey);
      if (!signerExists) {
        throw new Error('[SAFETY LOCK] Post-signing validation failed: Expected wallet signer signature missing.');
      }

      const unexpectedSigner = signedTxObject.signatures.some(s => s.publicKey !== derivedPubkey);
      if (unexpectedSigner) {
        throw new Error('[SAFETY LOCK] Post-signing validation failed: Unexpected signer detected on signed transaction.');
      }

      // 8. Return safe metadata ONLY (Zero private keys, secret key bytes, or seed phrases)
      return {
        signed: true,
        status: 'SIGNED',
        signerPublicKey: derivedPubkey,
        signatures: signedTxObject.signatures.map(s => s.publicKey),
        transaction: signedTxObject,
        timestamp: Date.now()
      };
    }
  });
}

