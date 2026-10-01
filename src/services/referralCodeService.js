import ReferralCode from '../models/ReferralCode.js';
import { generateShortCode } from '../utils/shortCodeGenerator.js';

export async function ensureReferralCodeIndexes() {
  await ReferralCode.collection.createIndex({ shortCode: 1 }, { unique: true, background: true });
  await ReferralCode.collection.createIndex({ walletAddress: 1 }, { unique: true, background: true });
}

export async function getOrCreateReferralCodeForWallet(walletAddress) {
  const wallet = String(walletAddress || '').trim().toLowerCase();
  if (!wallet) return null;

  const existing = await ReferralCode.findOne({ walletAddress: wallet }).lean();
  if (existing) return existing;

  const maxAttempts = 20;

  for (let attempts = 0; attempts < maxAttempts; attempts += 1) {
    const shortCode = generateShortCode();

    try {
      const referral = await ReferralCode.findOneAndUpdate(
        { walletAddress: wallet },
        {
          $setOnInsert: {
            shortCode,
            walletAddress: wallet,
            isActive: true,
          },
        },
        {
          upsert: true,
          returnDocument: 'after',
          setDefaultsOnInsert: true,
        }
      ).lean();

      if (referral) return referral;
    } catch (error) {
      if (Number(error?.code) === 11000) {
        const raced = await ReferralCode.findOne({ walletAddress: wallet }).lean();
        if (raced) return raced;
        continue;
      }

      throw error;
    }
  }

  throw new Error(`[REFERRAL_CODE_GENERATION_FAILED] ${wallet}`);
}
