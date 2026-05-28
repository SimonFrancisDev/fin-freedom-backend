import { ethers } from 'ethers';
import ProfilePrivacy from '../models/ProfilePrivacy.js';
import { normalizeWalletAddress, requireWalletProof } from '../utils/walletProof.js';

export const PROFILE_PRIVACY_READ_ACTION = 'profile_privacy_read';
export const PROFILE_PRIVACY_UPDATE_ACTION = 'profile_privacy_update';

export const LOCKED_PROFILE_MESSAGE = 'This profile is locked. You cannot view this profile.';

function normalizeTarget(address) {
  const normalized = normalizeWalletAddress(address);
  if (!normalized) {
    const error = new Error('Valid wallet address is required');
    error.status = 400;
    throw error;
  }
  return normalized;
}

function readProofFromRequest(req) {
  return {
    walletAddress:
      req.query.proofWallet ||
      req.query.walletAddress ||
      req.body?.walletAddress ||
      req.body?.wallet,
    signature: req.query.signature || req.body?.signature,
    timestamp: req.query.timestamp || req.body?.timestamp,
  };
}

export async function getProfilePrivacy(address) {
  const walletAddress = normalizeTarget(address);
  const row = await ProfilePrivacy.findOne({ walletAddress }).lean();

  return {
    walletAddress: ethers.getAddress(walletAddress),
    isLocked: Boolean(row?.isLocked),
    lockedAt: row?.lockedAt || null,
    updatedAt: row?.updatedAt || null,
  };
}

export async function updateProfilePrivacy({ walletAddress, isLocked, signature, timestamp }) {
  const normalized = requireWalletProof({
    walletAddress,
    action: PROFILE_PRIVACY_UPDATE_ACTION,
    signature,
    timestamp,
  });

  const locked = Boolean(isLocked);
  const row = await ProfilePrivacy.findOneAndUpdate(
    { walletAddress: normalized },
    {
      $set: {
        isLocked: locked,
        lockedAt: locked ? new Date() : null,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();

  return {
    walletAddress: ethers.getAddress(normalized),
    isLocked: Boolean(row?.isLocked),
    lockedAt: row?.lockedAt || null,
    updatedAt: row?.updatedAt || null,
  };
}

export async function canReadLockedProfile(address, req) {
  const target = normalizeTarget(address);
  const privacy = await getProfilePrivacy(target);

  if (!privacy.isLocked) {
    return { allowed: true, privacy };
  }

  const proof = readProofFromRequest(req);
  if (!proof.signature || !proof.timestamp || !proof.walletAddress) {
    return { allowed: false, privacy };
  }

  try {
    const proofWallet = requireWalletProof({
      walletAddress: proof.walletAddress,
      action: PROFILE_PRIVACY_READ_ACTION,
      signature: proof.signature,
      timestamp: proof.timestamp,
    });

    return {
      allowed: proofWallet === target,
      privacy,
    };
  } catch {
    return { allowed: false, privacy };
  }
}

export function buildLockedProfileResponse(address) {
  const walletAddress = normalizeTarget(address);
  return {
    locked: true,
    message: LOCKED_PROFILE_MESSAGE,
    data: {
      address: ethers.getAddress(walletAddress),
      isLocked: true,
      message: LOCKED_PROFILE_MESSAGE,
    },
  };
}
