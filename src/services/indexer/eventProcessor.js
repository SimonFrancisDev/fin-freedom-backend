import { RawEvent } from '../../models/index.js';
import { processReceiptEvent } from './receiptProcessor.js';
import { processPositionEvent } from './positionProcessor.js';
import { processUserEvent } from './userProcessor.js';

export const processEvent = async (event) => {
  try {
    // 1. Deduplicate (CRITICAL)
    const exists = await RawEvent.exists({
      transactionHash: event.transactionHash,
      logIndex: event.logIndex
    });

    if (exists) {
      return; // already processed
    }

    // 2. Store raw event (AUDIT LAYER)
    await RawEvent.create({
      chainId: event.chainId,
      contractName: event.contractName,
      contractAddress: event.address.toLowerCase(),
      eventName: event.eventName,
      blockNumber: event.blockNumber,
      blockHash: event.blockHash,
      transactionHash: event.transactionHash,
      transactionIndex: event.transactionIndex,
      logIndex: event.logIndex,
      removed: event.removed || false,
      args: event.args
    });

    // 3. Route event
    await routeEvent(event);

  } catch (error) {
    console.error('Event processing error:', error);
    throw error;
  }
};

const routeEvent = async (event) => {
  const name = event.eventName;

  // RECEIPTS (MOST IMPORTANT)
  if (
    name === 'DetailedPayoutReceiptRecorded' ||
    name === 'PayoutReceiptRecorded'
  ) {
    return processReceiptEvent(event);
  }

  // POSITIONS
  if (
    name === 'PositionFilled' ||
    name === 'OrbitReset' ||
    name === 'EscrowUpdated'
  ) {
    return processPositionEvent(event);
  }

  // USERS
  if (
    name === 'LevelActivated' ||
    name === 'FounderRepActivated'
  ) {
    return processUserEvent(event);
  }

  // ignore others safely
};