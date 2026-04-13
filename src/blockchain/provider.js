import { JsonRpcProvider } from 'ethers'
import env from '../config/env.js'

let providerInstance = null

export function getProvider() {
  if (providerInstance) return providerInstance

  providerInstance = new JsonRpcProvider(env.RPC_URL, {
    chainId: env.CHAIN_ID,
    name: 'polygon-amoy',
    staticNetwork: true
  })

  return providerInstance
}

// 🔥 SAFE RPC CALL WRAPPER (GLOBAL PROTECTION)
export async function safeRpcCall(fn, retries = 3, delayMs = 1500) {
  try {
    return await fn()
  } catch (err) {
    const msg = String(err?.message || '').toLowerCase()

    const isRateLimit =
      msg.includes('429') ||
      msg.includes('rate limit') ||
      msg.includes('too many requests') ||
      msg.includes('1015')

    if (!isRateLimit || retries <= 0) {
      throw err
    }

    console.warn(`[RPC] Rate limited. Retrying in ${delayMs}ms...`)

    await new Promise(r => setTimeout(r, delayMs))

    return safeRpcCall(fn, retries - 1, Math.min(delayMs * 2, 10000))
  }
}

export async function connectBlockchain() {
  const provider = getProvider()

  const network = await safeRpcCall(() => provider.getNetwork())
  const blockNumber = await safeRpcCall(() => provider.getBlockNumber())

  return {
    chainId: Number(network.chainId),
    name: network.name,
    blockNumber,
  }
}











// import { JsonRpcProvider } from 'ethers';
// import env from '../config/env.js';

// let providerInstance = null;

// export function getProvider() {
//   if (providerInstance) return providerInstance;

//   providerInstance = new JsonRpcProvider(env.RPC_URL, {
//     chainId: env.CHAIN_ID,
//     name: 'polygon-amoy',
//   });

//   return providerInstance;
// }

// export async function connectBlockchain() {
//   const provider = getProvider();
//   const network = await provider.getNetwork();
//   const blockNumber = await provider.getBlockNumber();

//   return {
//     chainId: Number(network.chainId),
//     name: network.name,
//     blockNumber,
//   };
// }