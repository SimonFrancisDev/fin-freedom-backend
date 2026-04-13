import { ethers } from 'ethers';
import IndexedReceipt from '../../models/IndexedReceipt.js';

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

export async function fetchReceiptsByAddress(address, query = {}) {
  const normalizedAddress = normalizeAddress(address);

  const page = toPositiveInt(query.page, 1);
  const limit = Math.min(toPositiveInt(query.limit, 25), 100);
  const skip = (page - 1) * limit;

  const mongoQuery = {
    receiver: normalizedAddress,
  };

  if (query.level) {
    mongoQuery.level = Number(query.level);
  }

  if (query.receiptType) {
    mongoQuery.receiptType = Number(query.receiptType);
  }

  if (query.activationId) {
    mongoQuery.activationId = String(query.activationId);
  }

  const [items, total] = await Promise.all([
    IndexedReceipt.find(mongoQuery)
      .sort({ timestamp: -1, blockNumber: -1, logIndex: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    IndexedReceipt.countDocuments(mongoQuery),
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

export async function fetchReceiptsByActivationId(activationId, query = {}) {
  const page = toPositiveInt(query.page, 1);
  const limit = Math.min(toPositiveInt(query.limit, 50), 200);
  const skip = (page - 1) * limit;

  const mongoQuery = {
    activationId: String(activationId),
  };

  const [items, total] = await Promise.all([
    IndexedReceipt.find(mongoQuery)
      .sort({ timestamp: 1, blockNumber: 1, logIndex: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    IndexedReceipt.countDocuments(mongoQuery),
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