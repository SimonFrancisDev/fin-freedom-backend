import { getAddress, isAddress, verifyMessage } from 'ethers';
import env from '../config/env.js';

const DEFAULT_WALLET_PROOF_TTL_MS = 10 * 60 * 1000;

export function normalizeWalletAddress(walletAddress) {
  const value = String(walletAddress || '').trim();
  return isAddress(value) ? getAddress(value).toLowerCase() : '';
}

export function buildWalletProofMessage(action, walletAddress, timestamp) {
  return [
    'Fin Freedom Network',
    `Action: ${action}`,
    `Wallet: ${getAddress(walletAddress)}`,
    `Timestamp: ${timestamp}`,
  ].join('\n');
}

export function requireWalletProof({ walletAddress, action, signature, timestamp }) {
  const normalized = normalizeWalletAddress(walletAddress);
  if (!normalized) {
    const error = new Error('Valid wallet address is required');
    error.status = 400;
    throw error;
  }

  const numericTimestamp = Number(timestamp);
  const ttlMs = Number(env.WALLET_PROOF_TTL_MS || DEFAULT_WALLET_PROOF_TTL_MS);
  if (!Number.isFinite(numericTimestamp) || Math.abs(Date.now() - numericTimestamp) > ttlMs) {
    const error = new Error('Wallet authorization expired. Please try again.');
    error.status = 401;
    throw error;
  }

  if (!signature) {
    const error = new Error('Wallet signature is required');
    error.status = 401;
    throw error;
  }

  let recovered;
  try {
    recovered = verifyMessage(buildWalletProofMessage(action, normalized, numericTimestamp), signature);
  } catch {
    const error = new Error('Invalid wallet signature');
    error.status = 403;
    throw error;
  }

  if (getAddress(recovered).toLowerCase() !== normalized) {
    const error = new Error('Wallet signature does not match this wallet');
    error.status = 403;
    throw error;
  }

  return normalized;
}
