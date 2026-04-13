import { JsonRpcProvider } from 'ethers';
import env from '../config/env.js';

let providerInstance = null;

export function getProvider() {
  if (providerInstance) return providerInstance;

  providerInstance = new JsonRpcProvider(env.RPC_URL, {
    chainId: env.CHAIN_ID,
    name: 'polygon-amoy',
  });

  return providerInstance;
}

export async function connectBlockchain() {
  const provider = getProvider();
  const network = await provider.getNetwork();
  const blockNumber = await provider.getBlockNumber();

  return {
    chainId: Number(network.chainId),
    name: network.name,
    blockNumber,
  };
}