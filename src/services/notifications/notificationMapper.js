import ReferralCode from '../../models/ReferralCode.js';
import env from '../../config/env.js';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const SYSTEM_REFERRAL_ID = 'FIN-FREEDOM';

function normalizeAddress(value) {
  return String(value || '').trim().toLowerCase();
}

function amountParam(value) {
  return String(value ?? '0');
}

function formatUnitsParam(value, decimals = 6) {
  const raw = amountParam(value);
  try {
    const negative = raw.startsWith('-');
    const digits = raw.replace(/^-/, '').replace(/\D/g, '') || '0';
    const padded = digits.padStart(decimals + 1, '0');
    const whole = padded.slice(0, -decimals) || '0';
    const fraction = padded.slice(-decimals).replace(/0+$/, '');
    const formatted = fraction ? `${whole}.${fraction}` : whole;
    return negative ? `-${formatted}` : formatted;
  } catch {
    return raw;
  }
}

function usdtParam(value) {
  const amount = formatUnitsParam(value, 6);
  return amount.includes('.') ? Number(amount).toFixed(2) : `${amount}.00`;
}

function tokenParam(value) {
  return formatUnitsParam(value, 6);
}

function rawAmountGtZero(value) {
  try {
    return BigInt(value ?? '0') > 0n;
  } catch {
    return false;
  }
}

function humanizeCode(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const labels = {
    NO_ELIGIBLE_UPLINE: 'No eligible upline was available',
    RECEIVER_NOT_ACTIVE: 'Receiver was not active for this level',
    ZERO_RECEIVER: 'No valid receiver was available',
    ESCROW_LOCKED: 'Amount was locked for auto-upgrade',
    AUTO_UPGRADE: 'Used for auto-upgrade',
    RECYCLE: 'Recycle flow completed',
    ACTIVATION: 'Level activation',
  };
  return labels[raw] || raw
    .replace(/_/g, ' ')
    .replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

function fallbackIdentity(address) {
  const normalized = normalizeAddress(address);
  if (!normalized || normalized === ZERO_ADDRESS) return SYSTEM_REFERRAL_ID;
  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
}

async function resolveIdentityMap(addresses = []) {
  const unique = [...new Set(
    addresses
      .map(normalizeAddress)
      .filter((address) => address && address !== ZERO_ADDRESS)
  )];

  const map = new Map([[ZERO_ADDRESS, SYSTEM_REFERRAL_ID]]);
  if (!unique.length) return map;

  const rows = await ReferralCode.find({
    walletAddress: { $in: unique },
    isActive: true,
  })
    .select('walletAddress shortCode')
    .lean();

  for (const row of rows) {
    map.set(normalizeAddress(row.walletAddress), row.shortCode);
  }

  for (const address of unique) {
    if (!map.has(address)) map.set(address, fallbackIdentity(address));
  }

  return map;
}

function orbitName(level) {
  const numeric = Number(level || 0);
  if ([1, 4, 7, 10].includes(numeric)) return 'P4';
  if ([2, 5, 8].includes(numeric)) return 'P12';
  if ([3, 6, 9].includes(numeric)) return 'P39';
  return 'Orbit';
}

function lineForPosition(level, position) {
  const numericLevel = Number(level || 0);
  const numericPosition = Number(position || 0);
  if (!numericPosition) return 0;
  const orbit = orbitName(numericLevel);
  if (orbit === 'P4') return 1;
  if (orbit === 'P12') return numericPosition <= 3 ? 1 : 2;
  if (orbit === 'P39') return numericPosition <= 3 ? 1 : (numericPosition <= 12 ? 2 : 3);
  return 0;
}

function roleLabel(value) {
  const role = Number(value || 0);
  if (role === 1) return 'Direct';
  if (role === 2) return 'Spillover 1';
  if (role === 3) return 'Spillover 2';
  if (role === 4) return 'Recycle';
  if (role === 5) return 'Founder Path';
  return 'Payout';
}

function explorerTxUrl(chainId, txHash) {
  if (!txHash) return '';
  const configuredBase = String(env.BLOCK_EXPLORER_URL || '').trim();
  if (!configuredBase) return txHash;
  const base = configuredBase.replace(/\/?$/, '/');
  return `${base}tx/${txHash}`;
}

async function receiptParams(event) {
  const identities = await resolveIdentityMap([
    event.receiver,
    event.fromUser,
    event.orbitOwner,
  ]);
  const receiver = normalizeAddress(event.receiver);
  const fromUser = normalizeAddress(event.fromUser);
  const orbitOwner = normalizeAddress(event.orbitOwner);
  const position = Number(event.mirroredPosition || event.sourcePosition || 0);

  return {
    receiverCode: identities.get(receiver) || fallbackIdentity(receiver),
    sourceCode: identities.get(fromUser) || fallbackIdentity(fromUser),
    orbitOwnerCode: identities.get(orbitOwner) || fallbackIdentity(orbitOwner),
    orbit: orbitName(event.level),
    role: roleLabel(event.routedRole),
    line: lineForPosition(event.level, position),
    position,
    sourcePosition: Number(event.sourcePosition || 0),
    mirroredPosition: Number(event.mirroredPosition || 0),
    txUrl: explorerTxUrl(event.chainId, event.txHash),
  };
}

function baseEventParams(event) {
  return {
    level: Number(event.level || event.toLevel || 0),
    txHash: event.txHash || '',
    txShort: event.txHash ? `${event.txHash.slice(0, 8)}...${event.txHash.slice(-6)}` : '',
    blockNumber: Number(event.blockNumber || 0),
  };
}

function build(chainId, event, notificationType, walletAddress, overrides = {}) {
  const normalizedWallet = normalizeAddress(walletAddress);
  if (!normalizedWallet || normalizedWallet === ZERO_ADDRESS) return null;

  return {
    walletAddress: normalizedWallet,
    chainId,
    notificationType,
    severity: overrides.severity || 'info',
    source: overrides.source || 'indexer',
    sourceEventName: event.eventName || event.rawEventName || '',
    txHash: normalizeAddress(event.txHash),
    logIndex: Number(event.logIndex ?? 0),
    blockNumber: Number(event.blockNumber || 0),
    contractAddress: normalizeAddress(event.contractAddress),
    titleKey: `notifications.${notificationType}.title`,
    messageKey: `notifications.${notificationType}.message`,
    detailKey: `notifications.${notificationType}.detail`,
    i18nParams: {
      ...baseEventParams(event),
      ...(overrides.i18nParams || {}),
    },
    route: overrides.route || 'activity',
    routeParams: overrides.routeParams || {},
  };
}

export async function mapIndexedReceiptToNotifications(event) {
  if ((event.rawEventName || event.eventName) !== 'DetailedPayoutReceiptRecorded') return [];
  const common = await receiptParams(event);
  const notifications = [];

  if (rawAmountGtZero(event.liquidPaid)) {
    notifications.push(build(event.chainId, event, 'payment_received', event.receiver, {
      severity: 'success',
      route: 'activity',
      i18nParams: {
        ...common,
        amount: usdtParam(event.liquidPaid),
        generatedAmount: usdtParam(event.grossAmount),
        escrowLocked: usdtParam(event.escrowLocked),
      },
    }));
  }

  if (rawAmountGtZero(event.escrowLocked)) {
    notifications.push(build(event.chainId, event, 'escrow_locked', event.receiver, {
      severity: 'warning',
      route: 'orbits',
      i18nParams: {
        ...common,
        amount: usdtParam(event.escrowLocked),
        generatedAmount: usdtParam(event.grossAmount),
        fromLevel: Number(event.level || 0),
        toLevel: Math.min(Number(event.level || 0) + 1, 10),
      },
    }));
  }

  return notifications.filter(Boolean);
}

export async function mapIndexedEscrowEventToNotifications(event) {
  const eventName = event.eventName;
  if (eventName === 'EscrowLocked') return [];

  const types = {
    EscrowUsedForUpgrade: ['escrow_used', 'success'],
    EscrowReleasedToUser: ['escrow_released', 'info'],
  };
  const [type, severity] = types[eventName] || [];
  if (!type) return [];

  const identities = await resolveIdentityMap([event.user]);
  const user = normalizeAddress(event.user);

  return [
    build(event.chainId, event, type, event.user, {
      severity,
      route: 'orbits',
      i18nParams: {
        receiverCode: identities.get(user) || fallbackIdentity(user),
        amount: usdtParam(event.amount),
        fromLevel: Number(event.fromLevel || 0),
        toLevel: Number(event.toLevel || 0),
        txUrl: explorerTxUrl(event.chainId, event.txHash),
      },
    }),
  ].filter(Boolean);
}

export async function mapIndexedFinancialEventToNotifications(event) {
  const eventName = event.eventName;

  if (eventName === 'PayoutNotDelivered') {
    const identities = await resolveIdentityMap([event.affectedUser]);
    const affectedUser = normalizeAddress(event.affectedUser);
    return [
      build(event.chainId, event, 'payment_skipped', event.affectedUser, {
        severity: 'warning',
        route: 'activity',
        i18nParams: {
          receiverCode: identities.get(affectedUser) || fallbackIdentity(affectedUser),
          expectedAmount: usdtParam(event.expectedAmount),
          actualAmount: usdtParam(event.actualAmount),
          reasonCode: event.reasonCode || '',
          reason: humanizeCode(event.reasonCode),
          txUrl: explorerTxUrl(event.chainId, event.txHash),
        },
      }),
    ].filter(Boolean);
  }

  if (eventName === 'RecycleCompletedDetailed') {
    return [
      build(event.chainId, event, 'recycle_completed', event.orbitOwner || event.recycleReceiver, {
        severity: 'success',
        route: 'orbits',
        i18nParams: {
          amount: usdtParam(event.recycleLiquidPaid || event.recycleGross),
          escrowLocked: usdtParam(event.recycleEscrowLocked),
        },
      }),
    ].filter(Boolean);
  }

  if (eventName === 'AutoUpgradeCompleted') {
    return [
      build(event.chainId, event, 'auto_upgrade_completed', event.user, {
        severity: 'success',
        route: 'dashboard',
        i18nParams: {
          fromLevel: Number(event.fromLevel || 0),
          toLevel: Number(event.toLevel || 0),
          usedAmount: usdtParam(event.usedAmount),
        },
      }),
    ].filter(Boolean);
  }

  if (eventName === 'TokenRewardEligibility') {
    return [
      build(event.chainId, event, 'token_reward_eligibility', event.user, {
        severity: event.eligible ? 'success' : 'info',
        route: 'my-tokens',
        i18nParams: {
          amount: tokenParam(event.tokenAmount),
          rewardType: event.rewardType || '',
          eligible: Boolean(event.eligible),
          reasonCode: event.reasonCode || '',
          reason: humanizeCode(event.reasonCode),
        },
      }),
    ].filter(Boolean);
  }

  return [];
}

export function mapIndexedTokenEventToNotifications(event) {
  if (event.eventName !== 'UtilityMinted') return [];
  return [
    build(event.chainId, event, 'token_reward_minted', event.userAddress, {
      severity: 'success',
      route: 'my-tokens',
      i18nParams: {
        amount: tokenParam(event.amount),
        tokenSymbol: event.tokenSymbol || '',
        reason: humanizeCode(event.reason),
      },
    }),
  ].filter(Boolean);
}
