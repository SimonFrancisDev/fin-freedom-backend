import { ActivationReceipt, UserReceiptSummary } from '../../models/index.js';

export const processReceiptEvent = async (event) => {
  const args = event.args;

  // normalize
  const receiver = args.receiver?.toLowerCase();

  if (!receiver) return;

  // 1. Store receipt
  await ActivationReceipt.create({
    activationId: Number(args.activationId || 0),
    receiver,
    level: Number(args.level || 0),
    receiptType: Number(args.receiptType || 0),
    fromUser: args.fromUser?.toLowerCase(),
    orbitOwner: args.orbitOwner?.toLowerCase(),
    sourcePosition: Number(args.sourcePosition || 0),
    sourceCycle: Number(args.sourceCycle || 0),
    mirroredPosition: Number(args.mirroredPosition || 0),
    mirroredCycle: Number(args.mirroredCycle || 0),
    routedRole: Number(args.routedRole || 0),
    grossAmount: args.grossAmount?.toString() || '0',
    escrowLocked: args.escrowLocked?.toString() || '0',
    liquidPaid: args.liquidPaid?.toString() || '0',
    blockNumber: event.blockNumber,
    blockHash: event.blockHash,
    transactionHash: event.transactionHash,
    logIndex: event.logIndex,
    timestamp: Number(args.timestamp || Date.now())
  });

  // 2. Update summary (FAST QUERIES)
  await updateUserSummary(receiver, args);
};

const updateUserSummary = async (user, args) => {
  const level = Number(args.level || 0);

  const update = {
    $inc: {
      receiptCount: 1
    }
  };

  const gross = BigInt(args.grossAmount || 0);
  const escrow = BigInt(args.escrowLocked || 0);
  const liquid = BigInt(args.liquidPaid || 0);

  update.$inc['totals.gross'] = Number(gross);
  update.$inc['totals.escrow'] = Number(escrow);
  update.$inc['totals.liquid'] = Number(liquid);

  await UserReceiptSummary.findOneAndUpdate(
    { userAddress: user, level },
    update,
    { upsert: true, new: true }
  );
};