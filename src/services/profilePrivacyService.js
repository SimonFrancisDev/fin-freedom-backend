import { ethers } from 'ethers';
import ProfilePrivacy from '../models/ProfilePrivacy.js';
import { normalizeWalletAddress, requireWalletProof } from '../utils/walletProof.js';

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

export async function canReadLockedProfile(address) {
  const target = normalizeTarget(address);
  const privacy = await getProfilePrivacy(target);

  if (!privacy.isLocked) {
    return { allowed: true, privacy };
  }

  return { allowed: false, privacy };
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
