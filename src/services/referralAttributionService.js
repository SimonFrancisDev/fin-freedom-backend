import { ethers } from 'ethers'
import ReferralAttribution from '../models/ReferralAttribution.js'

// Adjust this import to your existing referral-code model/service.
// You already have /api/referral/resolve/:ref working, so reuse that same resolver if you have one.
import ReferralCode from '../models/ReferralCode.js'

const REFERRAL_LOCK_DAYS = 60
const REFERRAL_LOCK_MS = REFERRAL_LOCK_DAYS * 24 * 60 * 60 * 1000

function normalizeText(value = '') {
  return String(value).trim()
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
  }).lean()

  if (!record?.walletAddress || !ethers.isAddress(record.walletAddress)) {
    return null
  }

  return {
    referrerCode: record.shortCode || cleanRef,
    referrerWallet: record.walletAddress.toLowerCase(),
  }
}

async function findActiveLock({ visitorId, walletAddress }) {
  const or = []

  if (visitorId) {
    or.push({ visitorId })
  }

  if (walletAddress) {
    or.push({ walletAddress: normalizeWallet(walletAddress) })
  }

  if (!or.length) return null

  return ReferralAttribution.findOne({
    $or: or,
    expiresAt: { $gt: new Date() },
  })
    .sort({ createdAt: 1 })
    .lean()
}

export async function getActiveReferralLock({ visitorId, walletAddress }) {
  const lock = await findActiveLock({ visitorId, walletAddress })

  if (!lock) {
    return {
      locked: false,
      canOverride: true,
    }
  }

  return {
    locked: true,
    canOverride: false,
    restored: true,
    daysLeft: daysLeft(lock.expiresAt),
    referrerCode: lock.referrerCode,
    referrerWallet: lock.referrerWallet,
    expiresAt: lock.expiresAt,
  }
}

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

  const existingLock = await findActiveLock({
    visitorId: cleanVisitorId,
    walletAddress: cleanWallet,
  })

  if (existingLock) {
    // If wallet connected later, bind same lock to wallet if missing.
    if (cleanWallet && !existingLock.walletAddress) {
      await ReferralAttribution.updateOne(
        { _id: existingLock._id },
        { $set: { walletAddress: cleanWallet } }
      )

      existingLock.walletAddress = cleanWallet
    }

    return {
      locked: true,
      restored: true,
      canOverride: false,
      daysLeft: daysLeft(existingLock.expiresAt),
      referrerCode: existingLock.referrerCode,
      referrerWallet: existingLock.referrerWallet,
      expiresAt: existingLock.expiresAt,
      message: 'Existing referral lock restored.',
    }
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
    walletAddress: cleanWallet || undefined,
    referrerCode: resolved.referrerCode,
    referrerWallet: resolved.referrerWallet,
    source,
    expiresAt,
  })

  return {
    locked: true,
    restored: false,
    canOverride: false,
    daysLeft: REFERRAL_LOCK_DAYS,
    referrerCode: created.referrerCode,
    referrerWallet: created.referrerWallet,
    expiresAt: created.expiresAt,
    message: 'Referral locked successfully.',
  }
}