import 'dotenv/config';
import { Contract, Interface, JsonRpcProvider, zeroPadValue } from 'ethers';

const provider = new JsonRpcProvider(process.env.RPC_URL_1, 137, { staticNetwork: true });
const registration = new Contract(
  process.env.REGISTRATION_ADDRESS,
  ['function isLevelActivated(address user,uint8 level) view returns (bool)'],
  provider
);
const levelManager = new Contract(
  process.env.LEVEL_MANAGER_ADDRESS,
  ['function userLevelActivated(address user,uint8 level) view returns (bool)'],
  provider
);
const activationInterface = new Interface([
  'event LevelActivated(address indexed user,uint8 level,uint256 amount)',
]);
const activationTopic = activationInterface.getEvent('LevelActivated').topicHash;
const startBlock = Number(process.env.START_BLOCK || 87490069);

async function activationLogs(address, wallet, payoutBlock) {
  const logs = [];
  const userTopic = zeroPadValue(wallet, 32);
  for (let fromBlock = startBlock; fromBlock <= payoutBlock; fromBlock += 9000) {
    const toBlock = Math.min(payoutBlock, fromBlock + 8999);
    const chunk = await provider.getLogs({
      address,
      topics: [activationTopic, userTopic],
      fromBlock,
      toBlock,
    });
    logs.push(...chunk);
  }
  return logs.map((log) => ({
    blockNumber: log.blockNumber,
    txHash: log.transactionHash,
    level: Number(activationInterface.parseLog(log).args.level),
  }));
}

const suspects = [
  {
    wallet: '0x5b511a2b0e4db2ca73b276969f3a52661aef12f1',
    level: 6,
    block: 87548415,
    tx: '0xc6cf2f03f0bd5101679f191dc4a7fae3d23044f0be6eb1e39dae2aa8a55093c3',
    amount: '64',
  },
  {
    wallet: '0xc0545331e20587208d4b27b2a3e4920cc481133a',
    level: 6,
    block: 90065956,
    tx: '0x7e00b766b89e80621f917378e4d83c52c57ab35e56c4e576c878a75448354cb4',
    amount: '64',
  },
  {
    wallet: '0xc0545331e20587208d4b27b2a3e4920cc481133a',
    level: 6,
    block: 90069107,
    tx: '0x03ffc96ad0d200bf5d2d4fe57325cdef76a030ea7650f946bd94c63d19c40975',
    amount: '160',
  },
];

for (const suspect of suspects) {
  const [registrationLogs, managerLogs, registrationNow, managerNow, receipt] = await Promise.all([
    activationLogs(process.env.REGISTRATION_ADDRESS, suspect.wallet, suspect.block),
    activationLogs(process.env.LEVEL_MANAGER_ADDRESS, suspect.wallet, suspect.block),
    registration.isLevelActivated(suspect.wallet, suspect.level),
    levelManager.userLevelActivated(suspect.wallet, suspect.level),
    provider.getTransactionReceipt(suspect.tx),
  ]);
  console.log(JSON.stringify({
    ...suspect,
    transactionStatus: receipt?.status ?? null,
    registrationLevelActivationBeforePayout: registrationLogs.filter((row) => row.level === suspect.level),
    managerLevelActivationBeforePayout: managerLogs.filter((row) => row.level === suspect.level),
    registrationNow,
    managerNow,
  }));
}
