import { AbiCoder, ZeroHash, keccak256, solidityPacked } from 'ethers';

export function rewardLeaf(wallet, tier) {
  const inner = keccak256(AbiCoder.defaultAbiCoder().encode(['address', 'uint8'], [wallet, tier]));
  return keccak256(inner);
}

export function pairHash(left, right) {
  const [a, b] = left.toLowerCase() <= right.toLowerCase() ? [left, right] : [right, left];
  return keccak256(solidityPacked(['bytes32', 'bytes32'], [a, b]));
}

export function buildTree(entries) {
  if (entries.length === 0) return { root: ZeroHash, proofs: new Map() };
  let layer = entries.map((entry) => entry.leaf);
  const layers = [layer];
  while (layer.length > 1) {
    const next = [];
    for (let index = 0; index < layer.length; index += 2) {
      next.push(index + 1 < layer.length ? pairHash(layer[index], layer[index + 1]) : layer[index]);
    }
    layer = next;
    layers.push(layer);
  }
  const proofs = new Map();
  entries.forEach((entry, entryIndex) => {
    const proof = [];
    let index = entryIndex;
    for (let depth = 0; depth < layers.length - 1; depth += 1) {
      const sibling = index % 2 === 0 ? index + 1 : index - 1;
      if (sibling < layers[depth].length) proof.push(layers[depth][sibling]);
      index = Math.floor(index / 2);
    }
    proofs.set(entry.wallet, proof);
  });
  return { root: layers.at(-1)[0], proofs };
}
