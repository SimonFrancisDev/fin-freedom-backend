import { ethers } from 'ethers';

function raw(value) {
  try {
    return BigInt(value || '0');
  } catch {
    return 0n;
  }
}

function normalizeWallet(value) {
  const wallet = String(value || '').toLowerCase();
  return ethers.isAddress(wallet) ? wallet : '';
}

function emptyProgram() {
  return {
    totalEarnedRaw: 0n,
    walletCreditedRaw: 0n,
    escrowReservedRaw: 0n,
    escrowReleasedRaw: 0n,
    founderAttributionRaw: 0n,
    activityCount: 0,
  };
}

function ensureWallet(rows, address) {
  const wallet = normalizeWallet(address);
  if (!wallet) return null;
  if (!rows.has(wallet)) {
    rows.set(wallet, {
      address: wallet,
      totalEarnedRaw: 0n,
      walletCreditedRaw: 0n,
      escrowReservedRaw: 0n,
      activityCount: 0,
      fFreedom: emptyProgram(),
      freedomPlus: emptyProgram(),
      freedomNft: emptyProgram(),
    });
  }
  return rows.get(wallet);
}

function creditEarned(row, program, amount, { walletCredited = true } = {}) {
  row.totalEarnedRaw += amount;
  row[program].totalEarnedRaw += amount;
  if (walletCredited) {
    row.walletCreditedRaw += amount;
    row[program].walletCreditedRaw += amount;
  }
  row.activityCount += 1;
  row[program].activityCount += 1;
}

export function buildEcosystemEarningsMap({
  receipts = [],
  escrowReleases = [],
  freedomPlusPayments = [],
  founderIncome = [],
  nftClaims = [],
} = {}) {
  const rows = new Map();

  for (const receipt of receipts) {
    const row = ensureWallet(rows, receipt.receiver);
    if (!row) continue;
    const liquid = raw(receipt.liquidPaid);
    const escrow = raw(receipt.escrowLocked);
    const recordedGross = raw(receipt.grossAmount);
    const earned = recordedGross > 0n ? recordedGross : liquid + escrow;
    creditEarned(row, 'fFreedom', earned, { walletCredited: false });
    row.walletCreditedRaw += liquid;
    row.fFreedom.walletCreditedRaw += liquid;
    row.escrowReservedRaw += escrow;
    row.fFreedom.escrowReservedRaw += escrow;
  }

  for (const release of escrowReleases) {
    const row = ensureWallet(rows, release.user);
    if (!row) continue;
    const amount = raw(release.amount);
    row.walletCreditedRaw += amount;
    row.fFreedom.walletCreditedRaw += amount;
    row.fFreedom.escrowReleasedRaw += amount;
  }

  for (const payment of freedomPlusPayments) {
    const row = ensureWallet(rows, payment.recipient);
    if (!row) continue;
    const amount = raw(payment.amount);
    if (payment.distributedToFounders) {
      creditEarned(row, 'freedomPlus', amount, { walletCredited: false });
      row.freedomPlus.founderAttributionRaw += amount;
    } else {
      creditEarned(row, 'freedomPlus', amount);
    }
  }

  for (const entry of founderIncome) {
    const row = ensureWallet(rows, entry.wallet);
    if (row) creditEarned(row, 'freedomPlus', raw(entry.amount));
  }

  for (const entry of nftClaims) {
    const row = ensureWallet(rows, entry.wallet);
    if (row) creditEarned(row, 'freedomNft', raw(entry.amount));
  }

  return rows;
}

function formatUsdt(value) {
  return Number(ethers.formatUnits(value || 0n, 6)).toFixed(2);
}

function serializeProgram(program) {
  return {
    totalEarned: formatUsdt(program.totalEarnedRaw),
    walletCredited: formatUsdt(program.walletCreditedRaw),
    escrowReserved: formatUsdt(program.escrowReservedRaw),
    escrowReleased: formatUsdt(program.escrowReleasedRaw),
    founderAttribution: formatUsdt(program.founderAttributionRaw),
    activityCount: program.activityCount,
  };
}

export function serializeEcosystemEarnings(row, address = '') {
  const value = row || {
    address: normalizeWallet(address),
    totalEarnedRaw: 0n,
    walletCreditedRaw: 0n,
    escrowReservedRaw: 0n,
    activityCount: 0,
    fFreedom: emptyProgram(),
    freedomPlus: emptyProgram(),
    freedomNft: emptyProgram(),
  };
  return {
    address: value.address,
    totalEarned: formatUsdt(value.totalEarnedRaw),
    walletCredited: formatUsdt(value.walletCreditedRaw),
    escrowReserved: formatUsdt(value.escrowReservedRaw),
    activityCount: value.activityCount,
    byProgram: {
      fFreedom: serializeProgram(value.fFreedom),
      freedomPlus: serializeProgram(value.freedomPlus),
      freedomNft: serializeProgram(value.freedomNft),
    },
    financialTruthSource: {
      fFreedom: 'indexed_receipt_gross_and_escrow_events',
      freedomPlus: 'indexed_non_founder_payments_and_founder_income',
      freedomNft: 'indexed_nft_reward_claims',
      founderAttribution: 'indexed_founder_component_settlements',
    },
  };
}
