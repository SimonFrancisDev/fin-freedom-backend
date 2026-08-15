import 'dotenv/config';
import mongoose from 'mongoose';
import IndexedFinancialEvent from '../src/models/IndexedFinancialEvent.js';
import IndexedReceipt from '../src/models/IndexedReceipt.js';

const chainId = Number(process.env.CHAIN_ID || 137);
const usdt = (value) => Number(BigInt(value || '0')) / 1e6;

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  const recycleEvents = await IndexedFinancialEvent.find({
    chainId,
    eventName: 'RecycleCompletedDetailed',
  }).sort({ blockNumber: 1, logIndex: 1 }).lean();

  const rows = [];
  for (const event of recycleEvents) {
    const receipts = await IndexedReceipt.find({
      chainId,
      txHash: event.txHash,
      activationId: event.activationId,
      receiptType: 4,
    }).sort({ logIndex: 1 }).lean();

    rows.push({
      blockNumber: event.blockNumber,
      txHash: event.txHash,
      activationId: event.activationId,
      orbitOwner: event.orbitOwner,
      level: event.level,
      orbitType: event.orbitType,
      sourceUser: event.sourceUser,
      sourcePosition: event.sourcePosition,
      sourceCycle: event.sourceCycle,
      recycleReceiver: event.recycleReceiver,
      recycleGross: usdt(event.recycleGross),
      recycleLiquidPaid: usdt(event.recycleLiquidPaid),
      recycleEscrowLocked: usdt(event.recycleEscrowLocked),
      triggeredOrbitReset: event.triggeredOrbitReset,
      receipts: receipts.map((receipt) => ({
        receiver: receipt.receiver,
        gross: usdt(receipt.grossAmount),
        liquid: usdt(receipt.liquidPaid),
        escrow: usdt(receipt.escrowLocked),
        mirroredPosition: receipt.mirroredPosition,
        mirroredCycle: receipt.mirroredCycle,
      })),
    });
  }

  const summary = rows.reduce((result, row) => {
    const key = `P${row.orbitType}-L${row.level}`;
    result[key] ||= { count: 0, gross: 0, liquid: 0, escrow: 0, resetCount: 0, sourcePositions: {} };
    const group = result[key];
    group.count += 1;
    group.gross += row.recycleGross;
    group.liquid += row.recycleLiquidPaid;
    group.escrow += row.recycleEscrowLocked;
    if (row.triggeredOrbitReset) group.resetCount += 1;
    group.sourcePositions[row.sourcePosition] = (group.sourcePositions[row.sourcePosition] || 0) + 1;
    return result;
  }, {});

  console.log(JSON.stringify({ chainId, count: rows.length, summary, rows }, null, 2));
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
