import assert from 'node:assert/strict';
import test from 'node:test';
import { Wallet } from 'ethers';
import { buildTree, pairHash, rewardLeaf } from '../src/services/freedomPlusMerkle.js';

function verify(leaf, proof) {
  return proof.reduce((hash, sibling) => pairHash(hash, sibling), leaf);
}

test('Freedom-Plus reward trees produce deterministic OpenZeppelin-compatible proofs', () => {
  const entries = [1, 2, 3, 4, 5].map((index) => {
    const wallet = Wallet.createRandom().address.toLowerCase();
    return { wallet, tier: 1, leaf: rewardLeaf(wallet, 1), index };
  }).sort((a, b) => a.wallet.localeCompare(b.wallet));
  const first = buildTree(entries);
  const second = buildTree(entries);
  assert.equal(first.root, second.root);
  for (const entry of entries) {
    const proof = first.proofs.get(entry.wallet);
    assert.equal(verify(entry.leaf, proof), first.root);
  }
});

test('empty reward tiers use the zero root and one member needs no proof', () => {
  const empty = buildTree([]);
  assert.equal(empty.root, `0x${'0'.repeat(64)}`);
  const wallet = Wallet.createRandom().address.toLowerCase();
  const entry = { wallet, tier: 3, leaf: rewardLeaf(wallet, 3) };
  const single = buildTree([entry]);
  assert.equal(single.root, entry.leaf);
  assert.deepEqual(single.proofs.get(wallet), []);
});
