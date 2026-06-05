import { ethers } from 'ethers';
import ReferralCode from '../../models/ReferralCode.js';
import IndexedRegistrationEvent from '../../models/IndexedRegistrationEvent.js';
import { getContracts } from '../../blockchain/contracts.js';

const SYSTEM_REFERRAL_ID = 'FIN-FREEDOM';

const ADDRESS_KEYS = new Set([
  'address',
  'occupant',
  'receiver',
  'fromUser',
  'orbitOwner',
  'owner',
  'user',
  'referrer',
  'originalReferrer',
  'occupantReferrer',
  'spillover1Recipient',
  'spillover2Recipient',
  'recycleReceiver',
  'walletAddress',
  'referredByWallet',
]);

function normalizeAddress(value = '') {
  const address = String(value || '').trim();
  if (!ethers.isAddress(address)) return '';
  return address.toLowerCase();
}

function isZeroAddress(address = '') {
  return normalizeAddress(address) === ethers.ZeroAddress.toLowerCase();
}

async function getSystemWalletSet() {
  const systemWallets = new Set([ethers.ZeroAddress.toLowerCase()]);

  const contracts = getContracts();
  const id1Lookups = [
    ['registration', contracts?.registration],
    ['levelManager', contracts?.levelManager],
  ];

  for (const [source, contract] of id1Lookups) {
    if (typeof contract?.id1Wallet !== 'function') continue;

    try {
      const id1Wallet = await contract.id1Wallet();
      const normalizedId1 = normalizeAddress(id1Wallet);
      if (normalizedId1) systemWallets.add(normalizedId1);
    } catch (error) {
      console.warn('[IDENTITY_ENRICHMENT_ID1_LOOKUP_FAILED]', {
        source,
        message: error?.message || String(error),
      });
    }
  }

  return systemWallets;
}

function collectAddresses(value, addresses = new Set()) {
  if (!value || typeof value !== 'object') return addresses;

  if (Array.isArray(value)) {
    value.forEach((item) => collectAddresses(item, addresses));
    return addresses;
  }

  Object.entries(value).forEach(([key, item]) => {
    if (ADDRESS_KEYS.has(key)) {
      const normalized = normalizeAddress(item);
      if (normalized) addresses.add(normalized);
      return;
    }

    if (item && typeof item === 'object') {
      collectAddresses(item, addresses);
    }
  });

  return addresses;
}

async function buildIdentityMap(addresses) {
  const normalizedAddresses = [...addresses].filter(Boolean);
  const systemWallets = await getSystemWalletSet();
  const identityMap = new Map();

  normalizedAddresses.forEach((address) => {
    if (systemWallets.has(address) || isZeroAddress(address)) {
      identityMap.set(address, {
        walletAddress: address,
        referralId: SYSTEM_REFERRAL_ID,
        shortCode: SYSTEM_REFERRAL_ID,
        type: 'system',
        status: 'resolved',
      });
    }
  });

  const participantAddresses = normalizedAddresses.filter((address) => !identityMap.has(address));

  if (participantAddresses.length) {
    const referralRows = await ReferralCode.find({
      walletAddress: { $in: participantAddresses },
      isActive: true,
    })
      .select('walletAddress shortCode')
      .lean();

    referralRows.forEach((row) => {
      const walletAddress = normalizeAddress(row.walletAddress);
      if (!walletAddress || !row.shortCode) return;

      identityMap.set(walletAddress, {
        walletAddress,
        referralId: row.shortCode,
        shortCode: row.shortCode,
        type: 'participant',
        status: 'resolved',
      });
    });

    const missing = participantAddresses.filter((address) => !identityMap.has(address));
    if (missing.length) {
      const registeredRows = await IndexedRegistrationEvent.find({
        user: { $in: missing },
        eventName: 'Registered',
      })
        .select('user')
        .lean();

      const registeredSet = new Set(registeredRows.map((row) => normalizeAddress(row.user)).filter(Boolean));

      missing.forEach((address) => {
        identityMap.set(address, {
          walletAddress: address,
          referralId: '',
          shortCode: '',
          type: registeredSet.has(address) ? 'participant' : 'unknown',
          status: registeredSet.has(address) ? 'missing_referral_code' : 'unregistered_or_unindexed',
        });
      });
    }
  }

  return identityMap;
}

function cloneForResponse(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function attachIdentityFields(value, identityMap) {
  if (!value || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    value.forEach((item) => attachIdentityFields(item, identityMap));
    return value;
  }

  Object.entries(value).forEach(([key, item]) => {
    if (ADDRESS_KEYS.has(key)) {
      const normalized = normalizeAddress(item);
      const identity = normalized ? identityMap.get(normalized) : null;

      if (identity) {
        value[`${key}Identity`] = identity;
        value[`${key}ReferralId`] = identity.referralId || '';
      }
      return;
    }

    if (item && typeof item === 'object') {
      attachIdentityFields(item, identityMap);
    }
  });

  return value;
}

export async function enrichWalletIdentities(payload) {
  const response = cloneForResponse(payload);
  const addresses = collectAddresses(response);

  if (!addresses.size) {
    return {
      data: response,
      identities: {},
    };
  }

  const identityMap = await buildIdentityMap(addresses);
  attachIdentityFields(response, identityMap);

  return {
    data: response,
    identities: Object.fromEntries(identityMap.entries()),
  };
}
