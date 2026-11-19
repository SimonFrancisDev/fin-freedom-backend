const lower = (value) => String(value || '').toLowerCase();
const point = (a, b) => Number(a.blockNumber || 0) - Number(b.blockNumber || 0)
  || Number(a.logIndex || 0) - Number(b.logIndex || 0);

export const ORBIT_RECEIPT_SNAPSHOT_VERSIONS = { level: 5, position: 4, cycle: 7 };

export function orbitReceiptQuery(address, level, { position, cycleNumber } = {}) {
  const source = { orbitOwner: lower(address) };
  const mirror = { receiver: lower(address), mirroredPosition: { $gt: 0 } };
  if (position !== undefined) {
    source.sourcePosition = Number(position);
    mirror.mirroredPosition = Number(position);
  }
  if (cycleNumber !== undefined) {
    source.sourceCycle = Number(cycleNumber);
    mirror.mirroredCycle = Number(cycleNumber);
  }
  return { level: Number(level), $or: [source, mirror] };
}

function linksFor(receipt, address) {
  const links = [];
  if (lower(receipt.orbitOwner) === lower(address)) {
    links.push({ position: Number(receipt.sourcePosition || 0),
      cycle: Number(receipt.sourceCycle || 0), isMirror: false });
  }
  if (lower(receipt.receiver) === lower(address) && Number(receipt.mirroredPosition) > 0) {
    links.push({ position: Number(receipt.mirroredPosition),
      cycle: Number(receipt.mirroredCycle || 0), isMirror: true });
  }
  return links;
}

function matchesLink(link, receipt, { position, cycleNumber, afterReset, beforeReset }) {
  if (position !== undefined && link.position !== Number(position)) return false;
  if (cycleNumber === undefined) return true;
  // Tagged source and destination cycles are independent. A final payout can
  // be emitted after its source orbit's reset in the very same transaction.
  if (link.cycle > 0) return link.cycle === Number(cycleNumber);
  if (Number(cycleNumber) !== 1 && !afterReset && !beforeReset) return false;
  return (!afterReset || point(receipt, afterReset) > 0)
    && (!beforeReset || point(receipt, beforeReset) < 0);
}

export function selectOrbitReceipts(receipts, context) {
  const seen = new Set();
  return receipts.filter((receipt) => {
    if (Number(receipt.level) !== Number(context.level)) return false;
    if (!linksFor(receipt, context.address).some((link) => matchesLink(link, receipt, context))) {
      return false;
    }
    if (receipt.txHash && receipt.logIndex !== undefined) {
      const key = `${receipt.chainId || ''}:${lower(receipt.txHash)}:${receipt.logIndex}`;
      if (seen.has(key)) return false;
      seen.add(key);
    }
    return true;
  });
}

export function orbitReceiptMetadata(receipts, context) {
  const receipt = [...selectOrbitReceipts(receipts, context)]
    .sort(point).reverse().find((row) => BigInt(row.activationId || 0) > 0n);
  const link = receipt && linksFor(receipt, context.address)
    .find((candidate) => matchesLink(candidate, receipt, context));
  return {
    activationId: Number(receipt?.activationId || 0),
    isMirrorActivation: Boolean(link?.isMirror),
  };
}
