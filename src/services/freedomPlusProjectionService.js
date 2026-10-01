import FreedomPlusParticipant from '../models/FreedomPlusParticipant.js';
import FreedomPlusLevelState from '../models/FreedomPlusLevelState.js';
import FreedomPlusPosition from '../models/FreedomPlusPosition.js';
import FreedomPlusPayment from '../models/FreedomPlusPayment.js';
import FreedomPlusLedgerEntry from '../models/FreedomPlusLedgerEntry.js';
import FreedomPlusRewardSnapshot from '../models/FreedomPlusRewardSnapshot.js';

const orbitTypes = {
  p39Orbit: 'P39',
  p14Orbit: 'P14',
  p12Orbit: 'P12',
  p6Orbit: 'P6',
  p4Orbit: 'P4',
  p3Orbit: 'P3',
};

export async function projectFreedomPlusEvent(event) {
  const { chainId, contractKey, eventName, args, txHash, blockNumber, timestamp } = event;

  if (contractKey === 'registration' && eventName === 'GenesisInitialized') {
    await FreedomPlusParticipant.updateOne(
      { chainId, wallet: args.id1Wallet },
      {
        $set: {
          sponsor: args.id1Wallet,
          participantNumber: 1,
          registered: true,
          registeredAtBlock: blockNumber,
          registeredAt: timestamp,
        },
      },
      { upsert: true }
    );
    return;
  }

  if (contractKey === 'registration' && eventName === 'ParticipantRegistered') {
    await FreedomPlusParticipant.updateOne(
      { chainId, wallet: args.participant },
      {
        $set: {
          sponsor: args.sponsor,
          participantNumber: Number(args.participantNumber),
          registered: true,
          registeredAtBlock: blockNumber,
          registeredAt: timestamp,
        },
      },
      { upsert: true }
    );
    return;
  }

  if (contractKey === 'registration' && eventName === 'LevelActivated') {
    await FreedomPlusLevelState.updateOne(
      { chainId, wallet: args.participant, level: Number(args.level) },
      {
        $set: {
          active: true,
          activationId: args.activationId,
          activatedAtBlock: blockNumber,
          activatedAt: timestamp,
        },
      },
      { upsert: true }
    );
    await FreedomPlusLedgerEntry.updateMany(
      {
        chainId,
        activationId: String(args.activationId || '').toLowerCase(),
        category: 'system_charge',
        wallet: '',
      },
      { $set: { wallet: String(args.participant || '').toLowerCase() } }
    );
    return;
  }

  if (contractKey === 'levelManager' && eventName === 'GenesisActivationRecorded') {
    await FreedomPlusLevelState.updateOne(
      { chainId, wallet: args.participant, level: Number(args.level) },
      {
        $set: {
          active: true,
          genesis: true,
          activationId: args.activationId,
          activatedAtBlock: blockNumber,
          activatedAt: timestamp,
        },
      },
      { upsert: true }
    );
    return;
  }

  if (orbitTypes[contractKey] && eventName === 'PositionRecorded') {
    await FreedomPlusPosition.updateOne(
      {
        chainId,
        orbitType: orbitTypes[contractKey],
        orbitOwner: args.orbitOwner,
        level: Number(args.level),
        cycle: Number(args.cycle),
        position: Number(args.position),
      },
      {
        $setOnInsert: {
          participant: args.participant,
          structuralParent: args.structuralParent,
          ring: Number(args.ring),
          kind: Number(args.kind),
          financial: Boolean(args.financial),
          amount: args.amount,
          activationId: args.activationId,
          placementId: args.placementId,
          txHash,
          blockNumber,
          timestamp,
        },
      },
      { upsert: true }
    );
    return;
  }

  if (contractKey === 'settlementRouter' && ['ComponentSettled', 'FounderComponentSettled'].includes(eventName)) {
    await FreedomPlusPayment.updateOne(
      { chainId, activationId: args.activationId, role: Number(args.role) },
      {
        $setOnInsert: {
          level: Number(args.level),
          recipient: args.recipient,
          originalCandidate: args.originalCandidate,
          bps: Number(args.bps),
          amount: args.amount,
          id1Fallback: Boolean(args.id1Fallback),
          distributedToFounders: eventName === 'FounderComponentSettled',
          placementId: args.placementId,
          txHash,
          blockNumber,
          timestamp,
        },
      },
      { upsert: true }
    );
    return;
  }

  if (contractKey === 'nftRewardDistributor' && eventName === 'PeriodCreated') {
    const periodId = Number(args.periodId);
    const roots = Array.from(args.eligibleRoots || []).map((value) => String(value).toLowerCase());
    const counts = Array.from(args.eligibleCounts || []).map(Number);
    let snapshot = await FreedomPlusRewardSnapshot.findOne({ chainId, periodId });
    if (!snapshot) {
      const year = Math.floor(periodId / 100);
      const month = periodId % 100;
      snapshot = await FreedomPlusRewardSnapshot.create({
        chainId,
        periodId,
        year,
        month,
        cutoff: new Date(Number(args.cutoff) * 1000),
        cutoffBlock: blockNumber,
        roots,
        counts,
        eligibility: [],
        sourceEventCount: 0,
        proofDataAvailable: false,
        status: 'published',
        publishedTxHash: txHash,
      });
      return;
    }
    const rootMismatch = roots.length !== 3 || snapshot.roots.some((value, index) => value !== roots[index]);
    const countMismatch = counts.length !== 3 || snapshot.counts.some((value, index) => value !== counts[index]);
    if (rootMismatch || countMismatch) {
      throw new Error(`On-chain Freedom-Plus reward period ${periodId} does not match its audited snapshot`);
    }
    snapshot.status = 'published';
    snapshot.proofDataAvailable = true;
    snapshot.publishedTxHash = txHash;
    await snapshot.save();
  }

  const ledger = ledgerFields(contractKey, eventName, args);
  if (ledger) {
    await FreedomPlusLedgerEntry.updateOne(
      { chainId, txHash, logIndex: event.logIndex },
      {
        $setOnInsert: {
          ...ledger,
          activationId: String(args.activationId || args.recycleActivationId || ''),
          contractKey,
          eventName,
          txHash,
          logIndex: event.logIndex,
          blockNumber,
          timestamp,
          details: args,
        },
      },
      { upsert: true }
    );
  }
}

function ledgerFields(contractKey, eventName, args) {
  if (contractKey === 'settlementRouter' && eventName === 'FounderPaymentDistributed') {
    return { category: 'founder_income', wallet: args.founder, level: Number(args.level), amount: args.amount };
  }
  if (contractKey === 'settlementRouter' && eventName === 'SystemChargeSettled') {
    return { category: 'system_charge', wallet: '', level: Number(args.level), amount: args.grossCharge };
  }
  if (contractKey === 'settlementRouter' && eventName === 'RecycleReserveUpdated') {
    return { category: 'recycle_reserve', wallet: args.orbitOwner, level: Number(args.level), amount: args.added };
  }
  if (contractKey === 'settlementRouter' && eventName === 'RecycleCompleted') {
    return { category: 'recycle', wallet: args.orbitOwner, level: Number(args.level), amount: args.repurchasePrice };
  }
  if (contractKey === 'tokenController' && eventName === 'FPTIssued') {
    return { category: 'fpt', wallet: args.participant, level: Number(args.level), amount: args.amount };
  }
  if (contractKey === 'tokenController' && eventName === 'FPTrIssued') {
    return { category: 'fptr', wallet: args.participant, level: Number(args.level), amount: args.amount };
  }
  if ((contractKey === 'fpt' || contractKey === 'fptr') && eventName === 'UtilityLocked') {
    return { category: 'token_lock', wallet: args.user, level: 0, amount: args.amount };
  }
  if ((contractKey === 'fpt' || contractKey === 'fptr') && eventName === 'UtilityUnlocked') {
    return { category: 'token_unlock', wallet: args.user, level: 0, amount: args.amount };
  }
  if ((contractKey === 'fpt' || contractKey === 'fptr') && eventName === 'UtilityBurned') {
    return { category: 'token_burn', wallet: args.from, level: 0, amount: args.amount };
  }
  if (contractKey === 'nftMembership' && ['MembershipMinted', 'MembershipTierChanged'].includes(eventName)) {
    return { category: 'nft_membership', wallet: args.member, level: 0, amount: '0' };
  }
  if (contractKey === 'nftMembership' && ['QualificationUnlocked', 'EligibilityRestored'].includes(eventName)) {
    return { category: 'nft_eligibility', wallet: args.member, level: 0, amount: '0' };
  }
  if (contractKey === 'nftRewardDistributor' && eventName === 'PeriodCreated') {
    return { category: 'nft_period', wallet: '', level: 0, amount: args.reservedAmount };
  }
  if (contractKey === 'nftRewardDistributor' && eventName === 'RewardClaimed') {
    return { category: 'nft_claim', wallet: args.member, level: 0, amount: args.amount };
  }
  if (orbitTypes[contractKey] && eventName === 'CycleClosed') {
    return { category: 'cycle_close', wallet: args.orbitOwner, level: Number(args.level), amount: '0' };
  }
  return null;
}
export async function reconcileFreedomPlusLedgerWallets(chainId) {
  const pending = await FreedomPlusLedgerEntry.find({
    chainId,
    category: 'system_charge',
    wallet: '',
    activationId: { $ne: '' },
  }).select('_id activationId').lean();
  if (!pending.length) return 0;

  const activationIds = [...new Set(pending.map((entry) => entry.activationId).filter(Boolean))];
  const levels = await FreedomPlusLevelState.find({
    chainId,
    activationId: { $in: activationIds },
  }).select('activationId wallet').lean();
  const walletByActivation = new Map(
    levels.map((level) => [String(level.activationId || '').toLowerCase(), String(level.wallet || '').toLowerCase()])
  );
  const updates = pending
    .map((entry) => ({
      entry,
      wallet: walletByActivation.get(String(entry.activationId || '').toLowerCase()) || '',
    }))
    .filter(({ wallet }) => wallet);

  if (!updates.length) return 0;
  await FreedomPlusLedgerEntry.bulkWrite(
    updates.map(({ entry, wallet }) => ({
      updateOne: {
        filter: { _id: entry._id, wallet: '' },
        update: { $set: { wallet } },
      },
    })),
    { ordered: false }
  );
  return updates.length;
}
