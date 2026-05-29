import { ethers } from 'ethers';
import crypto from 'crypto';
import ProfilePrivacy from '../models/ProfilePrivacy.js';
import { normalizeWalletAddress, requireWalletProof } from '../utils/walletProof.js';
import env from '../config/env.js';

export const PROFILE_PRIVACY_UPDATE_ACTION = 'profile_privacy_update';
export const PROFILE_PRIVACY_SESSION_ACTION = 'profile_privacy_session';

export const LOCKED_PROFILE_MESSAGE = 'This profile is locked. You cannot view this profile.';

const SESSION_VERSION = 'v1';

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

function getSessionSecret() {
  return env.PROFILE_SESSION_SECRET || env.ADMIN_API_KEY || env.MONGODB_URI;
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlJson(value) {
  return base64UrlEncode(JSON.stringify(value));
}

function signSessionPayload(encodedPayload) {
  return crypto
    .createHmac('sha256', getSessionSecret())
    .update(encodedPayload)
    .digest('base64url');
}

function getBearerToken(req) {
  const header = String(req?.headers?.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function getViewerAddress(req) {
  return normalizeWalletAddress(
    req?.headers?.['x-profile-viewer-address'] ||
      req?.query?.viewer ||
      req?.query?.viewerAddress
  );
}

export function verifyProfileSessionToken(token) {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== SESSION_VERSION) return null;

  const [, encodedPayload, signature] = parts;
  const expected = signSessionPayload(encodedPayload);
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);

  if (
    expectedBuffer.length !== signatureBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)
  ) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  const walletAddress = normalizeWalletAddress(payload?.walletAddress);
  const expiresAt = Number(payload?.expiresAt || 0);

  if (!walletAddress || !Number.isFinite(expiresAt) || Date.now() > expiresAt) {
    return null;
  }

  return {
    walletAddress,
    issuedAt: Number(payload.issuedAt || 0),
    expiresAt,
  };
}

export function getProfileSessionFromRequest(req) {
  return verifyProfileSessionToken(getBearerToken(req));
}

export function createProfileSession({ walletAddress, signature, timestamp }) {
  const normalized = requireWalletProof({
    walletAddress,
    action: PROFILE_PRIVACY_SESSION_ACTION,
    signature,
    timestamp,
  });

  const issuedAt = Date.now();
  const expiresAt = issuedAt + Number(env.PROFILE_SESSION_TTL_MS || 1800000);
  const payload = base64UrlJson({
    walletAddress: normalized,
    issuedAt,
    expiresAt,
  });
  const token = `${SESSION_VERSION}.${payload}.${signSessionPayload(payload)}`;

  return {
    walletAddress: ethers.getAddress(normalized),
    token,
    issuedAt,
    expiresAt,
  };
}

export async function canReadLockedProfile(address, req = null) {
  const target = normalizeTarget(address);
  const privacy = await getProfilePrivacy(target);

  if (!privacy.isLocked) {
    return { allowed: true, privacy };
  }

  const viewerAddress = getViewerAddress(req);
  if (viewerAddress === target) {
    return { allowed: true, privacy, ownerView: true };
  }

  const session = getProfileSessionFromRequest(req);
  if (session?.walletAddress === target) {
    return { allowed: true, privacy, ownerView: true };
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
