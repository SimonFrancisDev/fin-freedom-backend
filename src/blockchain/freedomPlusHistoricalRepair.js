import { AbiCoder, getAddress, ZeroAddress, ZeroHash } from 'ethers';
import { freedomPlusOrbitTypeForLevel } from '../config/freedomPlusProgram.js';

export const freedomPlusHistoricalRepairAbi = [
  'event FreedomPlusHistoricalPositionRestored(address indexed account,address indexed participant,uint8 indexed level,uint256 cycle,uint8 position,bytes positionData,bytes32 originalTransaction)',
  'event FreedomPlusHistoricalOrbitRestored(address indexed account,uint8 indexed level,bytes32 indexed planHash,bytes32 beforeHash,bytes32 afterHash)',
];
const positionType = 'tuple(address participant,address structuralParent,bytes32 activationId,bytes32 placementId,uint256 amount,uint40 timestamp,uint8 kind,bool financial)';
const coder = AbiCoder.defaultAbiCoder();
const lower = value => String(value || '').toLowerCase();
const address = value => getAddress(value).toLowerCase();
function requireMatch(condition, message) {
  if (!condition) throw new Error(`Freedom-Plus historical repair: ${message}`);
}

export function historicalFreedomPlusPosition(event, original) {
  const { args } = event;
  const level = Number(args.level);
  const orbitType = freedomPlusOrbitTypeForLevel(level);
  requireMatch(level >= 1 && level <= 4 && event.contractKey === `${orbitType.toLowerCase()}Orbit`, 'wrong engine or level');
  requireMatch(original && original.chainId === event.chainId && original.contractKey === event.contractKey &&
    original.eventName === 'PositionRecorded' && lower(original.txHash) === lower(args.originalTransaction), 'original indexed placement is required');
  const [value] = coder.decode([positionType], args.positionData);
  requireMatch(address(value.participant) === address(args.participant) && value.participant !== ZeroAddress &&
    value.structuralParent !== ZeroAddress && value.activationId !== ZeroHash && value.placementId !== ZeroHash,
  'invalid participant or identifiers');
  requireMatch(lower(original.args.activationId) === lower(value.activationId) &&
    address(original.args.participant) === address(value.participant), 'original activation mismatch');
  const timestamp = new Date(Number(value.timestamp) * 1000);
  requireMatch(value.timestamp > 0n && Number.isFinite(timestamp.getTime()) &&
    timestamp.getTime() === new Date(original.timestamp).getTime() &&
    timestamp.getTime() <= new Date(event.timestamp).getTime() && original.blockNumber <= event.blockNumber,
  'invalid original date or block');
  const kind = Number(value.kind);
  requireMatch((kind === 0 && !value.financial && value.amount === 0n && Number(original.args.kind) === 0) ||
    (kind === 2 && value.financial && value.amount > 0n && original.args.financial === true),
  'repair is neither a paid appearance nor a zero-money genesis link');
  const width = ['P14', 'P6'].includes(orbitType) ? 2 : 3;
  const capacity = { P39: 39, P14: 14, P12: 12, P6: 6 }[orbitType];
  const position = Number(args.position);
  const cycle = Number(args.cycle);
  requireMatch(Number.isSafeInteger(position) && position >= 1 && position <= capacity &&
    Number.isSafeInteger(cycle) && cycle >= 0, 'invalid position or cycle');
  return {
    chainId: event.chainId, orbitType, orbitOwner: address(args.account), level, cycle, position,
    participant: address(value.participant), structuralParent: address(value.structuralParent),
    ring: position <= width ? 1 : position <= width + width * width ? 2 : 3,
    kind, financial: value.financial, amount: value.amount.toString(),
    activationId: lower(value.activationId), placementId: lower(value.placementId),
    txHash: lower(args.originalTransaction), blockNumber: original.blockNumber, timestamp,
    historicalRepair: true, repairTxHash: lower(event.txHash), repairBlockNumber: event.blockNumber,
    repairedAt: event.timestamp,
  };
}
