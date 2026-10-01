import test from 'node:test';
import assert from 'node:assert/strict';
import { Interface } from 'ethers';
import registrationAbi from '../src/blockchain/freedomPlusRegistrationAbi.js';

for (const count of [3, 4]) {
  test('decodes genesis with ' + count + ' representatives', () => {
    const decoder = new Interface(registrationAbi);
    const signature = 'GenesisInitialized(address,address[' + count + '])';
    const id1 = '0x0000000000000000000000000000000000000001';
    const reps = Array.from({ length: count }, (_, i) => '0x' + (i + 2).toString(16).padStart(40, '0'));
    const log = decoder.encodeEventLog(decoder.getEvent(signature), [id1, reps]);
    const decoded = decoder.parseLog(log);
    assert.equal(decoded.name, 'GenesisInitialized');
    assert.equal(decoded.args.id1Wallet, id1);
    assert.deepEqual(Array.from(decoded.args.representatives), reps);
  });
}
