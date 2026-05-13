import ReferralCode from '../models/ReferralCode.js'
import IndexedRegistrationEvent from '../models/IndexedRegistrationEvent.js'
import { generateShortCode } from '../utils/shortCodeGenerator.js'
import { ethers } from 'ethers'

const SYSTEM_REFERRER_CODE = 'FIN-FREEDOM'
const REFERRAL_BASE_URL = process.env.REFERRAL_BASE_URL || 'https://finfreedomnetwork.io/ref'

function normalizeWallet(address = '') {
  return String(address || '').trim().toLowerCase()
}

async function findRegistrationEvent(address) {
  const wallet = normalizeWallet(address)
  if (!ethers.isAddress(wallet)) return null

  return IndexedRegistrationEvent.findOne({
    user: wallet,
    eventName: 'Registered',
  })
    .sort({ blockNumber: 1, logIndex: 1 })
    .lean()
}

async function getCodeByWallet(walletAddress) {
  const wallet = normalizeWallet(walletAddress)

  if (!wallet || wallet === ethers.ZeroAddress.toLowerCase()) {
    return SYSTEM_REFERRER_CODE
  }

  const code = await ReferralCode.findOne({
    walletAddress: wallet,
    isActive: true,
  }).lean()

  return code?.shortCode || null
}

export const getOrCreateReferralCode = async (req, res) => {
  const { address } = req.params
  const wallet = normalizeWallet(address)

  if (!wallet || !ethers.isAddress(wallet)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid wallet address.',
    })
  }

  try {
    const registrationEvent = await findRegistrationEvent(wallet)

    if (!registrationEvent) {
      return res.status(403).json({
        success: false,
        code: 'REGISTRATION_REQUIRED',
        message: 'Referral ID and referral link become available after successful registration.',
      })
    }

    let referral = await ReferralCode.findOne({
      walletAddress: wallet,
    })

    if (!referral) {
      let shortCode
      let attempts = 0
      const maxAttempts = 10

      do {
        shortCode = generateShortCode()
        attempts += 1
      } while (await ReferralCode.exists({ shortCode }) && attempts < maxAttempts)

      if (attempts >= maxAttempts) {
        return res.status(500).json({
          success: false,
          message: 'Failed to generate a unique referral ID.',
        })
      }

      referral = await ReferralCode.create({
        shortCode,
        walletAddress: wallet,
        isActive: true,
      })
    }

    const referredByWallet = normalizeWallet(registrationEvent.referrer)
    const referredByCode = await getCodeByWallet(referredByWallet)

    return res.json({
      success: true,
      shortCode: referral.shortCode,
      referralId: referral.shortCode,
      fullLink: `${REFERRAL_BASE_URL}/${referral.shortCode}`,
      walletAddress: referral.walletAddress,
      referredByWallet: referredByWallet || ethers.ZeroAddress,
      referredByCode: referredByCode || SYSTEM_REFERRER_CODE,
      registration: {
        txHash: registrationEvent.txHash,
        blockNumber: registrationEvent.blockNumber,
        timestamp: registrationEvent.timestamp,
      },
    })
  } catch (error) {
    console.error('Referral code error:', error)
    return res.status(500).json({
      success: false,
      message: 'Server error while loading referral access.',
    })
  }
}

export const resolveReferralCode = async (req, res) => {
  const { shortCode } = req.params

  if (!shortCode) {
    return res.status(400).json({
      success: false,
      message: 'Referral ID is required.',
    })
  }

  try {
    const referral = await ReferralCode.findOne({
      shortCode: String(shortCode).toUpperCase(),
      isActive: true,
    }).lean()

    if (!referral) {
      return res.status(404).json({
        success: false,
        message: 'Invalid or inactive referral ID.',
      })
    }

    const registrationEvent = await findRegistrationEvent(referral.walletAddress)

    if (!registrationEvent) {
      return res.status(403).json({
        success: false,
        code: 'REFERRER_NOT_REGISTERED',
        message: 'This referral ID is not connected to a confirmed registered wallet.',
      })
    }

    return res.json({
      success: true,
      walletAddress: referral.walletAddress,
      shortCode: referral.shortCode,
      referralId: referral.shortCode,
    })
  } catch (error) {
    console.error('Resolve referral error:', error)
    return res.status(500).json({
      success: false,
      message: 'Server error while resolving referral ID.',
    })
  }
}







// import ReferralCode from '../models/ReferralCode.js';
// import { generateShortCode } from '../utils/shortCodeGenerator.js';
// import { ethers } from 'ethers'; 

// // Generate or get existing short code for a wallet
// export const getOrCreateReferralCode = async (req, res) => {
//   const { address } = req.params;

//   if (!address || !ethers.isAddress(address)) {
//     return res.status(400).json({ success: false, message: 'Invalid wallet address' });
//   }

//   try {
//     // Check if code already exists
//     let referral = await ReferralCode.findOne({ walletAddress: address.toLowerCase() });

//     if (!referral) {
//       let shortCode;
//       let attempts = 0;
//       const maxAttempts = 10;

//       do {
//         shortCode = generateShortCode(); // e.g., FFN-A7K9P2
//         attempts++;
//       } while (await ReferralCode.exists({ shortCode }) && attempts < maxAttempts);

//       if (attempts >= maxAttempts) {
//         return res.status(500).json({ success: false, message: 'Failed to generate unique code' });
//       }

//       referral = await ReferralCode.create({
//         shortCode,
//         walletAddress: address.toLowerCase(),
//       });
//     }

//     res.json({
//       success: true,
//       shortCode: referral.shortCode,
//       fullLink: `https://finfreedomnetwork.io/ref/${referral.shortCode}`,
//       walletAddress: referral.walletAddress,
//     });
//   } catch (error) {
//     console.error('Referral code error:', error);
//     res.status(500).json({ success: false, message: 'Server error' });
//   }
// };

// // Resolve short code to wallet address
// export const resolveReferralCode = async (req, res) => {
//   const { shortCode } = req.params;

//   if (!shortCode) {
//     return res.status(400).json({ success: false, message: 'Short code required' });
//   }

//   try {
//     const referral = await ReferralCode.findOne({ 
//       shortCode: shortCode.toUpperCase(),
//       isActive: true 
//     });

//     if (!referral) {
//       return res.status(404).json({ success: false, message: 'Invalid or expired referral code' });
//     }

//     res.json({
//       success: true,
//       walletAddress: referral.walletAddress,
//       shortCode: referral.shortCode,
//     });
//   } catch (error) {
//     console.error('Resolve referral error:', error);
//     res.status(500).json({ success: false, message: 'Server error' });
//   }
// };
