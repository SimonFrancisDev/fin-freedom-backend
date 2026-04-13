import { ethers } from 'ethers';
import IndexedOrbitEvent from '../../models/IndexedOrbitEvent.js';

function normalizeAddress(address) {
  if (!ethers.isAddress(address)) {
    const error = new Error('Invalid wallet address');
    error.status = 400;
    throw error;
  }

  return address.toLowerCase();
}

function toPositiveInt(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

export async function fetchOrbitEventsByAddress(address, query = {}) {
  const normalizedAddress = normalizeAddress(address);

  const page = toPositiveInt(query.page, 1);
  const limit = Math.min(toPositiveInt(query.limit, 50), 200);
  const skip = (page - 1) * limit;

  const mongoQuery = {
    $or: [
      { orbitOwner: normalizedAddress },
      { user: normalizedAddress },
    ],
  };

  if (query.level) {
    mongoQuery.level = Number(query.level);
  }

  if (query.orbitType) {
    mongoQuery.orbitType = String(query.orbitType).toUpperCase();
  }

  if (query.eventName) {
    mongoQuery.eventName = String(query.eventName);
  }

  const [items, total] = await Promise.all([
    IndexedOrbitEvent.find(mongoQuery)
      .sort({ timestamp: -1, blockNumber: -1, logIndex: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    IndexedOrbitEvent.countDocuments(mongoQuery),
  ]);

  return {
    data: items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}