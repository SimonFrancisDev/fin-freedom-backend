import { getContracts } from '../src/blockchain/contracts.js';
import { safeRpcCall } from '../src/blockchain/provider.js';

const TX_HASH = process.argv[2];

if (!TX_HASH) {
  console.error('Usage: node scripts/debugTxReceipt.js <txHash>');
  process.exit(1);
}

async function main() {
  const contracts = getContracts();
  const provider = contracts.registration.runner?.provider || contracts.levelManager.runner?.provider;

  const receipt = await safeRpcCall((p) => p.getTransactionReceipt(TX_HASH));
  if (!receipt) {
    console.log('No receipt found for tx:', TX_HASH);
    return;
  }

  console.log('\n=== TX RECEIPT ===');
  console.log('txHash:', receipt.hash);
  console.log('blockNumber:', receipt.blockNumber);
  console.log('status:', receipt.status);
  console.log('logs:', receipt.logs.length);

  const targets = [
    ['registration', contracts.registration],
    ['levelManager', contracts.levelManager],
    ['p4Orbit', contracts.p4Orbit],
    ['p12Orbit', contracts.p12Orbit],
    ['p39Orbit', contracts.p39Orbit],
  ];

  for (const log of receipt.logs) {
    console.log('\n--- LOG ---');
    console.log('address:', log.address);
    console.log('logIndex:', log.index);
    console.log('topic0:', log.topics?.[0]);

    let matched = false;

    for (const [key, contract] of targets) {
      try {
        const parsed = contract.interface.parseLog(log);
        console.log('matchedContract:', key);
        console.log('eventName:', parsed.name);
        console.log('args:', parsed.args);
        matched = true;
        break;
      } catch {
        // keep trying
      }
    }

    if (!matched) {
      console.log('matchedContract: NONE');
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});