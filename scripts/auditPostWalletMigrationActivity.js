import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import IndexedRegistrationEvent from '../src/models/IndexedRegistrationEvent.js';
import IndexedActivationSummary from '../src/models/IndexedActivationSummary.js';
import IndexedOrbitEvent from '../src/models/IndexedOrbitEvent.js';
import IndexedReceipt from '../src/models/IndexedReceipt.js';
import IndexedEscrowEvent from '../src/models/IndexedEscrowEvent.js';
import IndexedFinancialEvent from '../src/models/IndexedFinancialEvent.js';

const START_BLOCK = Number(process.env.START_BLOCK || 91453954);

async function rows(Model, fields) {
  return Model.find({ chainId: 137, blockNumber: { $gte: START_BLOCK } })
    .sort({ blockNumber: 1, logIndex: 1 })
    .select(fields)
    .lean();
}

async function main() {
  await connectDB();
  const [registrations, activations, orbits, receipts, escrow, financial] = await Promise.all([
    rows(IndexedRegistrationEvent, '-_id blockNumber txHash logIndex eventName user referrer level timestamp raw'),
    rows(IndexedActivationSummary, '-_id blockNumber txHash logIndex activationId user level activationAmount systemCharge totalLiquidPaid totalEscrowLocked totalRecycleAllocated isAutoUpgrade timestamp raw'),
    rows(IndexedOrbitEvent, '-_id blockNumber txHash logIndex orbitType eventName orbitOwner user level position cycleNumber line linePaymentNumber amount timestamp raw'),
    rows(IndexedReceipt, '-_id blockNumber txHash logIndex receiver activationId receiptType level fromUser orbitOwner sourcePosition sourceCycle mirroredPosition mirroredCycle routedRole grossAmount liquidPaid escrowLocked timestamp'),
    rows(IndexedEscrowEvent, '-_id blockNumber txHash logIndex eventName user fromLevel toLevel amount newLockedTotal recipient timestamp raw'),
    rows(IndexedFinancialEvent, '-_id blockNumber txHash logIndex eventName activationId user sourceUser affectedUser actualReceiver orbitOwner recycleReceiver founderWallet level fromLevel toLevel orbitType sourcePosition sourceCycle mirrorPosition mirrorCycle receiptType expectedAmount actualAmount systemChargeTotal nftPoolAmount operationsAmount founderAmount recycleGross recycleLiquidPaid recycleEscrowLocked requiredAmount usedAmount escrowBefore escrowAfter routedRole reasonCode actionCode eligible triggeredOrbitReset timestamp raw'),
  ]);

  const sets = { registrations, activations, orbits, receipts, escrow, financial };
  const txHashes = [...new Set(Object.values(sets).flatMap((items) => items.map((item) => item.txHash)))];
  const transactions = txHashes.map((txHash) => {
    const grouped = {};
    for (const [name, items] of Object.entries(sets)) {
      grouped[name] = items.filter((item) => item.txHash === txHash);
    }
    return grouped;
  }).sort((a, b) => {
    const blockA = Object.values(a).flat()[0]?.blockNumber || 0;
    const blockB = Object.values(b).flat()[0]?.blockNumber || 0;
    return blockA - blockB;
  });

  const maxBlock = Math.max(0, ...Object.values(sets).flatMap((items) => items.map((item) => item.blockNumber)));
  console.log(JSON.stringify({
    startBlock: START_BLOCK,
    maxIndexedActivityBlock: maxBlock,
    counts: Object.fromEntries(Object.entries(sets).map(([name, items]) => [name, items.length])),
    transactionCount: transactions.length,
    transactions,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => mongoose.disconnect());
