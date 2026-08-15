import 'dotenv/config';
import mongoose from 'mongoose';
import OrbitLevelSnapshot from '../src/models/OrbitLevelSnapshot.js';
import IndexedFinancialEvent from '../src/models/IndexedFinancialEvent.js';

const chainId = Number(process.env.CHAIN_ID || 137);

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  const snapshots = await OrbitLevelSnapshot.find({
    isLevelActive: true,
    orbitType: { $in: ['P12', 'P39'] },
  }).sort({ orbitType: 1, level: 1, address: 1 }).lean();

  const rows = [];
  for (const snapshot of snapshots) {
    const line2 = Number(snapshot.linePaymentCounts?.line2 || 0);
    const line3 = Number(snapshot.linePaymentCounts?.line3 || 0);
    const recycleArrivals = snapshot.orbitType === 'P12' ? line2 : line3;
    const firstWindow = snapshot.orbitType === 'P12' ? 8 : 26;
    const secondWindow = snapshot.orbitType === 'P12' ? 9 : 27;
    if (recycleArrivals < firstWindow) continue;

    const oldRecycleEvents = await IndexedFinancialEvent.find({
      chainId,
      eventName: 'RecycleCompletedDetailed',
      orbitOwner: snapshot.address,
      level: snapshot.level,
    }).sort({ blockNumber: 1, logIndex: 1 }).lean();

    rows.push({
      address: snapshot.address,
      level: snapshot.level,
      orbitType: snapshot.orbitType,
      currentPosition: snapshot.orbitSummary?.currentPosition || 0,
      totalCycles: snapshot.orbitSummary?.totalCycles || 0,
      line1Arrivals: snapshot.linePaymentCounts?.line1 || 0,
      line2Arrivals: line2,
      line3Arrivals: line3,
      recycleArrivals,
      transitionClass: recycleArrivals === firstWindow
        ? 'OLD_FIRST_RECYCLE_ALREADY_REACHED'
        : recycleArrivals >= secondWindow
          ? 'OLD_SECOND_RECYCLE_REACHED_OR_CYCLE_BOUNDARY'
          : 'PRE_RECYCLE_WINDOW',
      oldRecycleEvents: oldRecycleEvents.map((event) => ({
        blockNumber: event.blockNumber,
        txHash: event.txHash,
        activationId: event.activationId,
        sourcePosition: event.sourcePosition,
        sourceCycle: event.sourceCycle,
        recycleReceiver: event.recycleReceiver,
        recycleGross: event.recycleGross,
        recycleLiquidPaid: event.recycleLiquidPaid,
        recycleEscrowLocked: event.recycleEscrowLocked,
      })),
      positions: snapshot.positions
        .filter((position) => position.occupant)
        .map((position) => ({
          number: position.number,
          line: position.line,
          parentPosition: position.parentPosition,
          occupant: position.occupant,
          amount: position.amount,
          activationId: position.activationId,
          isMirrorActivation: position.isMirrorActivation,
          toRecycle: position.receiptTotals?.recycleGross || '0',
        })),
    });
  }

  console.log(JSON.stringify({ chainId, candidateCount: rows.length, rows }, null, 2));
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
