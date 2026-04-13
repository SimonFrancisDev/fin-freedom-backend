import 'dotenv/config';
import { JsonRpcProvider, Interface } from 'ethers';

import levelManagerAbi from '../src/blockchain/abis/levelManager.abi.json' with { type: 'json' };
import p4OrbitAbi from '../src/blockchain/abis/p4Orbit.abi.json' with { type: 'json' };
import p12OrbitAbi from '../src/blockchain/abis/p12Orbit.abi.json' with { type: 'json' };
import p39OrbitAbi from '../src/blockchain/abis/p39Orbit.abi.json' with { type: 'json' };

const TX_HASH = process.argv[2];

if (!TX_HASH) {
  console.error('Usage: node scripts/debugTx.js <txHash>');
  process.exit(1);
}

const provider = new JsonRpcProvider(process.env.RPC_URL);

const contracts = [
  {
    name: 'LevelManager',
    address: process.env.LEVEL_MANAGER_ADDRESS.toLowerCase(),
    iface: new Interface(levelManagerAbi),
  },
  {
    name: 'P4Orbit',
    address: process.env.P4_ORBIT_ADDRESS.toLowerCase(),
    iface: new Interface(p4OrbitAbi),
  },
  {
    name: 'P12Orbit',
    address: process.env.P12_ORBIT_ADDRESS.toLowerCase(),
    iface: new Interface(p12OrbitAbi),
  },
  {
    name: 'P39Orbit',
    address: process.env.P39_ORBIT_ADDRESS.toLowerCase(),
    iface: new Interface(p39OrbitAbi),
  },
];

function safeToString(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(safeToString);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (!Number.isNaN(Number(k))) continue;
      out[k] = safeToString(v);
    }
    return out;
  }
  return value;
}

async function main() {
  const receipt = await provider.getTransactionReceipt(TX_HASH);

  if (!receipt) {
    console.error('Transaction receipt not found.');
    process.exit(1);
  }

  console.log(`\nTX: ${TX_HASH}`);
  console.log(`Status: ${receipt.status}`);
  console.log(`Block: ${receipt.blockNumber}`);
  console.log(`Logs count: ${receipt.logs.length}\n`);

  for (let i = 0; i < receipt.logs.length; i++) {
    const log = receipt.logs[i];
    const logAddress = log.address.toLowerCase();

    console.log(`LOG #${i}`);
    console.log(`Address: ${log.address}`);
    console.log(`Topic0 : ${log.topics?.[0] || 'N/A'}`);

    let matched = false;

    for (const contract of contracts) {
      if (contract.address !== logAddress) continue;

      try {
        const parsed = contract.iface.parseLog(log);
        if (parsed) {
          matched = true;
          console.log(`Matched Contract: ${contract.name}`);
          console.log(`Event: ${parsed.name}`);
          console.log('Args:', safeToString(parsed.args));
          break;
        }
      } catch {
        // ignore and continue
      }
    }

    if (!matched) {
      console.log('Matched Contract: NONE');
      console.log('Raw topics:', log.topics);
      console.log('Raw data  :', log.data);
    }

    console.log('-----------------------------------\n');
  }
}

main().catch((err) => {
  console.error('debugTx failed:', err);
  process.exit(1);
});