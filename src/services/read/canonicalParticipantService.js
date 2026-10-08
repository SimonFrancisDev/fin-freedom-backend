import { getContracts } from '../../blockchain/contracts.js';
import { safeRpcCall } from '../../blockchain/provider.js';
import IndexedRegistrationEvent from '../../models/IndexedRegistrationEvent.js';
import env from '../../config/env.js';

function normalize(address) {
  return String(address || '').toLowerCase();
}

export async function fetchCanonicalParticipantCounts(contracts = getContracts()) {
  const registeredWalletList = await IndexedRegistrationEvent.distinct('user', {
    chainId: env.CHAIN_ID,
    eventName: 'Registered',
    user: { $nin: [null, ''] },
  }).catch(() => []);

  const registeredWallets = new Set(
    registeredWalletList.map(normalize).filter(Boolean)
  );

  const [totalResult, registeredResult, id1Result] = await Promise.allSettled([
    safeRpcCall((provider) =>
      contracts.registration.connect(provider).totalParticipants()
    ),
    safeRpcCall((provider) =>
      contracts.registration.connect(provider).registeredCount()
    ),
    safeRpcCall((provider) =>
      contracts.levelManager.connect(provider).id1Wallet()
    ),
  ]);

  const chainTotal =
    totalResult.status === 'fulfilled' ? Number(totalResult.value || 0) : 0;
  const chainRegistered =
    registeredResult.status === 'fulfilled'
      ? Number(registeredResult.value || 0)
      : null;
  const id1Wallet =
    id1Result.status === 'fulfilled' ? normalize(id1Result.value) : '';
  const id1AlreadyRegistered = Boolean(
    id1Wallet && registeredWallets.has(id1Wallet)
  );

  const indexedRegisteredWallets = registeredWallets.size;
  const fallbackTotal =
    indexedRegisteredWallets + (id1AlreadyRegistered ? 0 : 1);
  const totalParticipants = chainTotal > 0 ? chainTotal : fallbackTotal;

  return {
    totalParticipants,
    registeredWallets: indexedRegisteredWallets,
    systemParticipants: Math.max(0, totalParticipants - indexedRegisteredWallets),
    chainRegisteredWallets: chainRegistered,
    chainAndIndexMatch:
      chainRegistered === null
        ? null
        : chainRegistered === indexedRegisteredWallets,
    id1CountedOnce: totalParticipants === indexedRegisteredWallets + 1,
    truthSource:
      chainTotal > 0
        ? 'f_freedom_registration_total_participants'
        : 'indexed_registered_wallets_plus_id1',
  };
}
