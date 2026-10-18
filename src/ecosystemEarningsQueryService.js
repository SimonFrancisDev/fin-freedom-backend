import env from './config/env.js';
import IndexedReceipt from './models/IndexedReceipt.js';
import IndexedEscrowEvent from './models/IndexedEscrowEvent.js';
import FreedomPlusPayment from './models/FreedomPlusPayment.js';
import FreedomPlusLedgerEntry from './models/FreedomPlusLedgerEntry.js';
import {
  buildEcosystemEarningsMap,
  serializeEcosystemEarnings,
} from './ecosystemEarnings.js';

async function fetchRows(wallet = '') {
  const receiptFilter = { chainId: env.CHAIN_ID };
  const releaseFilter = { chainId: env.CHAIN_ID, eventName: 'EscrowReleasedToUser' };
  const paymentFilter = { chainId: env.CHAIN_ID };
  const founderFilter = { chainId: env.CHAIN_ID, category: 'founder_income' };
  const nftFilter = { chainId: env.CHAIN_ID, category: 'nft_claim' };

  if (wallet) {
    receiptFilter.receiver = wallet;
    releaseFilter.user = wallet;
    paymentFilter.recipient = wallet;
    founderFilter.wallet = wallet;
    nftFilter.wallet = wallet;
  }

  const [receipts, escrowReleases, freedomPlusPayments, founderIncome, nftClaims] = await Promise.all([
    IndexedReceipt.find(receiptFilter).select('receiver liquidPaid grossAmount escrowLocked').lean(),
    IndexedEscrowEvent.find(releaseFilter).select('user amount').lean(),
    FreedomPlusPayment.find(paymentFilter).select('recipient amount distributedToFounders').lean(),
    FreedomPlusLedgerEntry.find(founderFilter).select('wallet amount').lean(),
    FreedomPlusLedgerEntry.find(nftFilter).select('wallet amount').lean(),
  ]);

  return { receipts, escrowReleases, freedomPlusPayments, founderIncome, nftClaims };
}

export async function fetchWalletEcosystemEarnings(address) {
  const wallet = String(address || '').toLowerCase();
  const rows = buildEcosystemEarningsMap(await fetchRows(wallet));
  return serializeEcosystemEarnings(rows.get(wallet), wallet);
}

export async function fetchAllEcosystemEarnings() {
  return buildEcosystemEarningsMap(await fetchRows());
}
