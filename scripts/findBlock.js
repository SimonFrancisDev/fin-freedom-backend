import 'dotenv/config';
import { JsonRpcProvider } from 'ethers';

const provider = new JsonRpcProvider(process.env.RPC_URL);

const contracts = [
  { name: 'LEVEL_MANAGER', address: process.env.LEVEL_MANAGER_ADDRESS },
  { name: 'P4_ORBIT', address: process.env.P4_ORBIT_ADDRESS },
  { name: 'P12_ORBIT', address: process.env.P12_ORBIT_ADDRESS },
  { name: 'P39_ORBIT', address: process.env.P39_ORBIT_ADDRESS },
];

async function findDeploymentBlock(address) {
  let low = 0;
  let high = await provider.getBlockNumber();
  let answer = high;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);

    const code = await provider.getCode(address, mid);

    if (code && code !== '0x') {
      answer = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return answer;
}

async function main() {
  console.log('Finding deployment blocks...\n');

  for (const c of contracts) {
    if (!c.address) {
      console.log(`${c.name}: address missing`);
      continue;
    }

    const block = await findDeploymentBlock(c.address);
    console.log(`${c.name}: ${block}`);
  }

  process.exit(0);
}

main();