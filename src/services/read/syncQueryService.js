import SyncState from '../../models/SyncState.js';
import { getProvider } from '../../blockchain/provider.js';

export async function fetchIndexerStatus() {
  const provider = getProvider();
  const latestBlock = await provider.getBlockNumber();

  const syncStates = await SyncState.find({})
    .sort({ key: 1 })
    .lean();

  return {
    latestBlock,
    syncStates,
  };
}