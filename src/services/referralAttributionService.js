import { ethers } from 'ethers'
import ReferralAttribution from '../models/ReferralAttribution.js'
import ReferralCode from '../models/ReferralCode.js'

const REFERRAL_LOCK_DAYS = 60
const REFERRAL_LOCK_MS = REFERRAL_LOCK_DAYS * 24 * 60 * 60 * 1000

function normalizeText(value = '') {
  return String(value || '').trim()
}

function normalizeWallet(value = '') {
  return String(value || '').trim().toLowerCase()
}

function daysLeft(expiresAt) {
  return Math.max(
    0,
    Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
  )
}

function serializeLock(lock, extra = {}) {
  return {
    locked: true,
    canOverride: false,
    restored: true,
    daysLeft: daysLeft(lock.expiresAt),
    referrerCode: lock.referrerCode,
    referrerWallet: lock.referrerWallet,
    expiresAt: lock.expiresAt,
    scope: lock.walletAddress ? 'wallet' : 'visitor',
    pendingWalletBinding: false,
    ...extra,
  }
}

async function resolveReferralToWallet(ref) {
  const cleanRef = normalizeText(ref)

  if (!cleanRef) {
    return null
  }

  if (cleanRef.toUpperCase() === 'FIN-FREEDOM') {
    return {
      referrerCode: 'FIN-FREEDOM',
      referrerWallet: ethers.ZeroAddress,
    }
  }

  if (ethers.isAddress(cleanRef)) {
    return {
      referrerCode: cleanRef,
      referrerWallet: cleanRef.toLowerCase(),
    }
  }

  const record = await ReferralCode.findOne({
    shortCode: cleanRef.toUpperCase(),
    isActive: true,
  }).lean()

  if (!record?.walletAddress || !ethers.isAddress(record.walletAddress)) {
    return null
  }

  return {
    referrerCode: record.shortCode || cleanRef,
    referrerWallet: record.walletAddress.toLowerCase(),
  }
}

async function findActiveWalletLock(walletAddress) {
  const cleanWallet = normalizeWallet(walletAddress)
  if (!cleanWallet) return null

  return ReferralAttribution.findOne({
    walletAddress: cleanWallet,
    expiresAt: { $gt: new Date() },
  })
    .sort({ createdAt: 1 })
    .lean()
}

async function findActiveVisitorLock(visitorId) {
  const cleanVisitorId = normalizeText(visitorId)
  if (!cleanVisitorId) return null

  return ReferralAttribution.findOne({
    visitorId: cleanVisitorId,
    walletAddress: { $exists: false },
    expiresAt: { $gt: new Date() },
  })
    .sort({ createdAt: 1 })
    .lean()
}

/**
 * Read current referral status.
 *
 * Important:
 * - If walletAddress is provided, wallet lock has priority.
 * - Visitor lock is returned only as pending/suggested for that wallet.
 * - Visitor lock must not automatically become a wallet lock here.
 */
export async function getActiveReferralLock({ visitorId, walletAddress }) {
  const cleanVisitorId = normalizeText(visitorId)
  const cleanWallet = normalizeWallet(walletAddress)

  if (cleanWallet) {
    const walletLock = await findActiveWalletLock(cleanWallet)

    if (walletLock) {
      return serializeLock(walletLock, {
        scope: 'wallet',
        pendingWalletBinding: false,
        message: 'Wallet referral lock restored.',
      })
    }

    const visitorLock = await findActiveVisitorLock(cleanVisitorId)

    if (visitorLock) {
      return serializeLock(visitorLock, {
        scope: 'visitor',
        pendingWalletBinding: true,
        canOverride: false,
        message:
          'A referral was found for this browser. It is pending for this wallet and will be locked only if this wallet registers.',
      })
    }

    return {
      locked: false,
      canOverride: true,
      scope: 'wallet',
      pendingWalletBinding: false,
      message: 'No wallet referral lock found.',
    }
  }

  const visitorLock = await findActiveVisitorLock(cleanVisitorId)

  if (visitorLock) {
    return serializeLock(visitorLock, {
      scope: 'visitor',
      pendingWalletBinding: false,
      message: 'Visitor referral lock restored.',
    })
  }

  return {
    locked: false,
    canOverride: true,
    scope: 'visitor',
    pendingWalletBinding: false,
    message: 'No visitor referral lock found.',
  }
}

/**
 * Lock referral attribution.
 *
 * Default behavior:
 * - If source is referral_link and walletAddress exists, we DO NOT bind to wallet immediately.
 *   We only create/restore visitor lock.
 *
 * Final registration behavior:
 * - If source is registration, we bind the referral to the wallet permanently for 60 days.
 */
export async function lockReferralAttribution({
  visitorId,
  walletAddress,
  ref,
  source = 'referral_link',
}) {
  const cleanVisitorId = normalizeText(visitorId)
  const cleanWallet = normalizeWallet(walletAddress)
  const cleanRef = normalizeText(ref)

  if (!cleanVisitorId && !cleanWallet) {
    const error = new Error('visitorId or walletAddress is required.')
    error.statusCode = 400
    throw error
  }

  const isRegistrationLock = source === 'registration'
  const isManualInput = source === 'manual_input'
  const isSystem = source === 'system'

  /**
   * 1. Wallet always has priority.
   * If this wallet already has a lock, return it.
   */
  if (cleanWallet) {
    const walletLock = await findActiveWalletLock(cleanWallet)

    if (walletLock) {
      return serializeLock(walletLock, {
        scope: 'wallet',
        pendingWalletBinding: false,
        message: 'Existing wallet referral lock restored.',
      })
    }
  }

  /**
   * 2. If this is only a referral link visit, do NOT lock the wallet.
   * Create/restore visitor lock only.
   */
  if (!isRegistrationLock && !isManualInput && !isSystem) {
    const visitorLock = await findActiveVisitorLock(cleanVisitorId)

    if (visitorLock) {
      return serializeLock(visitorLock, {
        scope: 'visitor',
        pendingWalletBinding: Boolean(cleanWallet),
        message: cleanWallet
          ? 'Visitor referral restored as pending for this wallet.'
          : 'Existing visitor referral lock restored.',
      })
    }

    if (!cleanRef) {
      const error = new Error('Referral value is required.')
      error.statusCode = 400
      throw error
    }

    const resolved = await resolveReferralToWallet(cleanRef)

    if (!resolved) {
      const error = new Error('Referral code could not be resolved.')
      error.statusCode = 404
      throw error
    }

    const expiresAt = new Date(Date.now() + REFERRAL_LOCK_MS)

    const created = await ReferralAttribution.create({
      visitorId: cleanVisitorId || undefined,
      // Important: do not set walletAddress here.
      // The wallet is only bound during registration.
      referrerCode: resolved.referrerCode,
      referrerWallet: resolved.referrerWallet,
      source: 'referral_link',
      expiresAt,
    })

    return serializeLock(created.toObject(), {
      restored: false,
      scope: 'visitor',
      pendingWalletBinding: Boolean(cleanWallet),
      daysLeft: REFERRAL_LOCK_DAYS,
      message: cleanWallet
        ? 'Referral saved for this browser and pending for this wallet.'
        : 'Referral locked for this browser.',
    })
  }

  /**
   * 3. Registration/manual/system lock.
   * This is when the referrer becomes permanently attached to the wallet.
   */
  if (!cleanWallet) {
    const error = new Error('Wallet address is required to lock referral for registration.')
    error.statusCode = 400
    throw error
  }

  let finalRef = cleanRef

  /**
   * If registration did not send a ref directly,
   * use the visitor lock as the pending referrer.
   */
  if (!finalRef && cleanVisitorId) {
    const visitorLock = await findActiveVisitorLock(cleanVisitorId)
    if (visitorLock?.referrerCode) {
      finalRef = visitorLock.referrerCode
    }
  }

  if (!finalRef) {
    finalRef = 'FIN-FREEDOM'
  }

  const resolved = await resolveReferralToWallet(finalRef)

  if (!resolved) {
    const error = new Error('Referral code could not be resolved for registration.')
    error.statusCode = 404
    throw error
  }

  const expiresAt = new Date(Date.now() + REFERRAL_LOCK_MS)

  const created = await ReferralAttribution.create({
    visitorId: cleanVisitorId || undefined,
    walletAddress: cleanWallet,
    referrerCode: resolved.referrerCode,
    referrerWallet: resolved.referrerWallet,
    // source: isSystem ? 'system' : isManualInput ? 'manual_input' : 'referral_link',
    source: isSystem
        ? 'system'
        : isManualInput
            ? 'manual_input'
            : isRegistrationLock
            ? 'registration'
            : 'referral_link',
    expiresAt,
  })

  return serializeLock(created.toObject(), {
    restored: false,
    scope: 'wallet',
    pendingWalletBinding: false,
    daysLeft: REFERRAL_LOCK_DAYS,
    message: 'Referral locked securely for this wallet.',
  })
}