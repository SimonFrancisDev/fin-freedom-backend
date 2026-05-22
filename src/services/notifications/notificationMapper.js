const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

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

export function mapIndexedReceiptToNotifications(event) {
  if ((event.rawEventName || event.eventName) !== 'DetailedPayoutReceiptRecorded') return [];
  if (!rawAmountGtZero(event.liquidPaid)) return [];

  return [
    build(event.chainId, event, 'payment_received', event.receiver, {
      severity: 'success',
      route: 'activity',
      i18nParams: {
        amount: usdtParam(event.liquidPaid),
        generatedAmount: usdtParam(event.grossAmount),
        escrowLocked: usdtParam(event.escrowLocked),
      },
    }),
  ].filter(Boolean);
}

export function mapIndexedEscrowEventToNotifications(event) {
  const eventName = event.eventName;
  const types = {
    EscrowLocked: ['escrow_locked', 'warning'],
    EscrowUsedForUpgrade: ['escrow_used', 'success'],
    EscrowReleasedToUser: ['escrow_released', 'info'],
  };
  const [type, severity] = types[eventName] || [];
  if (!type) return [];

  return [
    build(event.chainId, event, type, event.user, {
      severity,
      route: 'orbits',
      i18nParams: {
        amount: usdtParam(event.amount),
        fromLevel: Number(event.fromLevel || 0),
        toLevel: Number(event.toLevel || 0),
      },
    }),
  ].filter(Boolean);
}

export function mapIndexedFinancialEventToNotifications(event) {
  const eventName = event.eventName;

  if (eventName === 'PayoutNotDelivered') {
    return [
      build(event.chainId, event, 'payment_skipped', event.affectedUser, {
        severity: 'warning',
        route: 'activity',
        i18nParams: {
          expectedAmount: usdtParam(event.expectedAmount),
          actualAmount: usdtParam(event.actualAmount),
          reasonCode: event.reasonCode || '',
          reason: humanizeCode(event.reasonCode),
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
