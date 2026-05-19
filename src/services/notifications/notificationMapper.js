const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

function normalizeAddress(value) {
  return String(value || '').trim().toLowerCase();
}

function amountParam(value) {
  return String(value ?? '0');
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
  return [
    build(event.chainId, event, 'payment_received', event.receiver, {
      severity: 'success',
      route: 'activity',
      i18nParams: {
        amount: amountParam(event.liquidPaid || event.grossAmount),
        generatedAmount: amountParam(event.grossAmount),
        escrowLocked: amountParam(event.escrowLocked),
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
        amount: amountParam(event.amount),
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
          expectedAmount: amountParam(event.expectedAmount),
          actualAmount: amountParam(event.actualAmount),
          reasonCode: event.reasonCode || '',
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
          amount: amountParam(event.recycleLiquidPaid || event.recycleGross),
          escrowLocked: amountParam(event.recycleEscrowLocked),
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
          usedAmount: amountParam(event.usedAmount),
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
          amount: amountParam(event.tokenAmount),
          rewardType: event.rewardType || '',
          eligible: Boolean(event.eligible),
          reasonCode: event.reasonCode || '',
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
        amount: amountParam(event.amount),
        tokenSymbol: event.tokenSymbol || '',
        reason: event.reason || '',
      },
    }),
  ].filter(Boolean);
}
