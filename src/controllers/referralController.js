import ReferralCode from '../models/ReferralCode.js';
import { generateShortCode } from '../utils/shortCodeGenerator.js';
import { ethers } from 'ethers'; 

// Generate or get existing short code for a wallet
export const getOrCreateReferralCode = async (req, res) => {
  const { address } = req.params;

  if (!address || !ethers.isAddress(address)) {
    return res.status(400).json({ success: false, message: 'Invalid wallet address' });
  }

  try {
    // Check if code already exists
    let referral = await ReferralCode.findOne({ walletAddress: address.toLowerCase() });

    if (!referral) {
      let shortCode;
      let attempts = 0;
      const maxAttempts = 10;

      do {
        shortCode = generateShortCode(); // e.g., FFN-A7K9P2
        attempts++;
      } while (await ReferralCode.exists({ shortCode }) && attempts < maxAttempts);

      if (attempts >= maxAttempts) {
        return res.status(500).json({ success: false, message: 'Failed to generate unique code' });
      }

      referral = await ReferralCode.create({
        shortCode,
        walletAddress: address.toLowerCase(),
      });
    }

    res.json({
      success: true,
      shortCode: referral.shortCode,
      fullLink: `https://finfreedomnetwork.io/ref/${referral.shortCode}`,
      walletAddress: referral.walletAddress,
    });
  } catch (error) {
    console.error('Referral code error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Resolve short code to wallet address
export const resolveReferralCode = async (req, res) => {
  const { shortCode } = req.params;

  if (!shortCode) {
    return res.status(400).json({ success: false, message: 'Short code required' });
  }

  try {
    const referral = await ReferralCode.findOne({ 
      shortCode: shortCode.toUpperCase(),
      isActive: true 
    });

    if (!referral) {
      return res.status(404).json({ success: false, message: 'Invalid or expired referral code' });
    }

    res.json({
      success: true,
      walletAddress: referral.walletAddress,
      shortCode: referral.shortCode,
    });
  } catch (error) {
    console.error('Resolve referral error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
