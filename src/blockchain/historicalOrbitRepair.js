import { AbiCoder, Interface, ZeroAddress, formatUnits } from 'ethers';

export const historicalOrbitRepairAbi = [
  'event HistoricalOrbitSlotRepaired(address indexed account,uint8 indexed level,uint256 indexed cycle,uint8 position,bytes previousState,bytes correctedState,bytes previousArchive)',
  'event HistoricalOrbitRepaired(address indexed account,uint8 indexed level,bytes32 indexed planHash,bytes32 beforeHash)',
  'event HistoricalAncestryRestored(address indexed account,uint8 indexed level,address indexed user,uint8 position,uint256 activationId)',
];
export const historicalOrbitRepairEventNames = historicalOrbitRepairAbi.map(
  (fragment) => new Interface([fragment]).fragments[0].name
);

const slotType = 'tuple(tuple(address user,uint256 amount,uint256 timestamp,address referrer,bool isActive) position,address above,uint8 arrival,uint256 activationId,bool isMirror,tuple(bool exists,uint8 line,uint8 linePaymentNumber,bool autoUpgradeEnabled,bool isFounderNoReferrerPath,uint256 toOwner,uint256 toSpillover1,uint256 toSpillover2,uint256 toEscrow,uint256 toRecycle,address spillover1Recipient,address spillover2Recipient) rule)';
const lower = (address) => String(address || '').toLowerCase();
const point = (a, b) => Number(a.blockNumber) - Number(b.blockNumber) || Number(a.logIndex) - Number(b.logIndex);

export function decodeHistoricalOrbitSlot(bytes) {
  return AbiCoder.defaultAbiCoder().decode([slotType], bytes)[0];
}

export function historicalOrbitEventFields(parsed) {
  if (!historicalOrbitRepairEventNames.includes(parsed.name)) return null;
  const a = parsed.args;
  const slot = parsed.name === 'HistoricalOrbitSlotRepaired'
    ? decodeHistoricalOrbitSlot(a.correctedState ?? a[5]) : null;
  return {
    orbitOwner: lower(a.account ?? a[0]),
    level: Number(a.level ?? a[1]),
    position: Number(a.position ?? (slot ? a[3] : parsed.name === 'HistoricalAncestryRestored' ? a[3] : 0)),
    cycleNumber: slot ? Number(a.cycle ?? a[2]) : 0,
    user: slot ? lower(slot.position.user) : parsed.name === 'HistoricalAncestryRestored' ? lower(a.user ?? a[2]) : '',
    // Embedded historical amounts are not new payments.
    amount: '0', line: 0, linePaymentNumber: 0,
  };
}

export function applyHistoricalOrbitRepair({ snapshot, position, cycleNumber, events, receipts,
  viewedAddress, summarizeReceipts, shapeReceipts = (rows) => rows }) {
  const updates = events.filter((event) =>
    Number(event.position) === Number(position) &&
    ['PositionFilled', 'HistoricalOrbitSlotRepaired'].includes(event.eventName) &&
    (Number(event.cycleNumber) === Number(cycleNumber) || Number(event.cycleNumber) === 0)
  ).sort(point);
  const latest = updates.at(-1);
  if (latest?.eventName !== 'HistoricalOrbitSlotRepaired') return snapshot;
  if (events.some(event => event.eventName === 'OrbitReset' && point(event, latest) > 0)) return snapshot;
  const slot = decodeHistoricalOrbitSlot(latest.raw?.correctedState ?? latest.raw?.['5']);
  const occupant = slot.position.user === ZeroAddress ? null : lower(slot.position.user);
  const ancestryOnly = occupant && slot.position.amount === 0n && slot.isMirror;
  const actualReceipts = occupant && !ancestryOnly
    ? receipts.filter(receipt => String(receipt.activationId) === String(slot.activationId)).sort(point) : [];
  const summary = summarizeReceipts(actualReceipts, viewedAddress);
  const rule = slot.rule;
  return {
    ...snapshot,
    occupant,
    amount: formatUnits(slot.position.amount, 6),
    timestamp: Number(slot.position.timestamp),
    activationId: Number(slot.activationId),
    activationCycleNumber: Number(cycleNumber),
    isMirrorActivation: slot.isMirror,
    truthLabel: ancestryOnly ? 'STRUCTURAL_REPAIR' : summary.truthLabel,
    indexedEventCount: updates.length,
    indexedReceiptCount: actualReceipts.length,
    receiptTotals: summary.totals,
    viewerReceiptBreakdown: summary.viewerBreakdown,
    indexedReceipts: shapeReceipts(actualReceipts),
    indexedEvents: events.filter(event => Number(event.position) === Number(position)),
    ruleView: occupant ? {
      position: Number(position), line: Number(rule.line), linePaymentNumber: Number(rule.linePaymentNumber),
      autoUpgradeEnabled: rule.autoUpgradeEnabled, isFounderNoReferrerPath: rule.isFounderNoReferrerPath,
      hasStoredRuleData: rule.exists,
      ...Object.fromEntries(['toOwner', 'toSpillover1', 'toSpillover2', 'toEscrow', 'toRecycle']
        .map(key => [key, formatUnits(rule[key], 6)])),
      spillover1Recipient: lower(rule.spillover1Recipient), spillover2Recipient: lower(rule.spillover2Recipient),
    } : null,
  };
}
