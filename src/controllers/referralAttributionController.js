import {
  getActiveReferralLock,
  lockReferralAttribution,
} from '../services/referralAttributionService.js'

export async function lockReferral(req, res, next) {
  try {
    const result = await lockReferralAttribution({
      visitorId: req.body.visitorId,
      walletAddress: req.body.walletAddress,
      ref: req.body.ref,
      source: req.body.source || 'referral_link',
    })

    res.status(result.restored ? 200 : 201).json({
      success: true,
      ...result,
    })
  } catch (error) {
    next(error)
  }
}

export async function getReferralLock(req, res, next) {
  try {
    const result = await getActiveReferralLock({
      visitorId: req.query.visitorId,
      walletAddress: req.query.walletAddress,
    })

    res.status(200).json({
      success: true,
      ...result,
    })
  } catch (error) {
    next(error)
  }
}