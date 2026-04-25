import { ethers } from 'ethers';
import SupportFaq from '../models/SupportFaq.js';
import SupportTicket from '../models/SupportTicket.js';

function setNoStore(res) {
  res.set('Cache-Control', 'no-store');
}

function setReadCache(res, maxAgeSeconds = 15) {
  res.set('Cache-Control', `public, max-age=${maxAgeSeconds}, stale-while-revalidate=${maxAgeSeconds}`);
}

function requireNonEmptyString(value, fieldName) {
  if (!value || typeof value !== 'string' || !value.trim()) {
    const error = new Error(`${fieldName} is required`);
    error.status = 400;
    throw error;
  }

  return value.trim();
}

function normalizeWallet(wallet) {
  if (!ethers.isAddress(wallet)) {
    const error = new Error('Invalid wallet address');
    error.status = 400;
    throw error;
  }

  return wallet.toLowerCase();
}

// ========== FAQs ==========
export const getFaqs = async (req, res, next) => {
  try {
    const faqs = await SupportFaq.find({ isActive: true })
      .sort({ category: 1, order: 1, createdAt: -1 })
      .lean();

    setReadCache(res, 30);

    res.status(200).json({
      ok: true,
      data: faqs,
    });
  } catch (error) {
    next(error);
  }
};

export const createFaq = async (req, res, next) => {
  try {
    const faq = await SupportFaq.create(req.body);
    setNoStore(res);
    res.status(201).json({ ok: true, data: faq });
  } catch (error) {
    next(error);
  }
};

export const updateFaq = async (req, res, next) => {
  try {
    const faq = await SupportFaq.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!faq) {
      const error = new Error('FAQ not found');
      error.status = 404;
      throw error;
    }

    setNoStore(res);
    res.status(200).json({ ok: true, data: faq });
  } catch (error) {
    next(error);
  }
};

export const deleteFaq = async (req, res, next) => {
  try {
    const faq = await SupportFaq.findByIdAndDelete(req.params.id);

    if (!faq) {
      const error = new Error('FAQ not found');
      error.status = 404;
      throw error;
    }

    setNoStore(res);
    res.status(200).json({ ok: true, message: 'FAQ deleted' });
  } catch (error) {
    next(error);
  }
};

// ========== Tickets ==========
export const createTicket = async (req, res, next) => {
  try {
    const wallet = normalizeWallet(req.body.wallet);
    const category = requireNonEmptyString(req.body.category, 'category');
    const subject = requireNonEmptyString(req.body.subject, 'subject');
    const message = requireNonEmptyString(req.body.message, 'message');
    const txHash = typeof req.body.txHash === 'string' ? req.body.txHash.trim() : '';

    const ticket = await SupportTicket.create({
      wallet,
      category,
      subject,
      message,
      txHash,
    });

    setNoStore(res);

    res.status(201).json({
      ok: true,
      data: ticket,
      message: 'Ticket submitted successfully',
    });
  } catch (error) {
    next(error);
  }
};

export const getTicketsByWallet = async (req, res, next) => {
  try {
    const wallet = normalizeWallet(req.params.wallet);

    const tickets = await SupportTicket.find({ wallet })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    setReadCache(res, 15);

    res.status(200).json({
      ok: true,
      data: tickets,
    });
  } catch (error) {
    next(error);
  }
};

export const getTickets = async (req, res, next) => {
  try {
    const { status } = req.query;
    const query = status ? { status } : {};

    const tickets = await SupportTicket.find(query)
      .sort({ createdAt: -1 })
      .lean();

    setReadCache(res, 10);

    res.status(200).json({
      ok: true,
      data: tickets,
    });
  } catch (error) {
    next(error);
  }
};

export const updateTicketStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const status = requireNonEmptyString(req.body.status, 'status');

    const ticket = await SupportTicket.findByIdAndUpdate(
      id,
      { status },
      { new: true, runValidators: true }
    );

    if (!ticket) {
      const error = new Error('Ticket not found');
      error.status = 404;
      throw error;
    }

    setNoStore(res);
    res.status(200).json({ ok: true, data: ticket });
  } catch (error) {
    next(error);
  }
};

export const addAdminNote = async (req, res, next) => {
  try {
    const { id } = req.params;
    const adminNotes = typeof req.body.adminNotes === 'string' ? req.body.adminNotes.trim() : '';

    const ticket = await SupportTicket.findByIdAndUpdate(
      id,
      { adminNotes },
      { new: true, runValidators: true }
    );

    if (!ticket) {
      const error = new Error('Ticket not found');
      error.status = 404;
      throw error;
    }

    setNoStore(res);
    res.status(200).json({ ok: true, data: ticket });
  } catch (error) {
    next(error);
  }
};













// import SupportFaq from '../models/SupportFaq.js';
// import SupportTicket from '../models/SupportTicket.js';

// // ========== FAQs ==========
// export const getFaqs = async (req, res, next) => {
//   try {
//     const faqs = await SupportFaq.find({ isActive: true })
//       .sort({ category: 1, order: 1, createdAt: -1 });
    
//     res.status(200).json({
//       ok: true,
//       data: faqs
//     });
//   } catch (error) {
//     next(error);
//   }
// };

// export const createFaq = async (req, res, next) => {
//   try {
//     const faq = await SupportFaq.create(req.body);
//     res.status(201).json({ ok: true, data: faq });
//   } catch (error) {
//     next(error);
//   }
// };

// export const updateFaq = async (req, res, next) => {
//   try {
//     const faq = await SupportFaq.findByIdAndUpdate(req.params.id, req.body, { new: true });
//     res.status(200).json({ ok: true, data: faq });
//   } catch (error) {
//     next(error);
//   }
// };

// export const deleteFaq = async (req, res, next) => {
//   try {
//     await SupportFaq.findByIdAndDelete(req.params.id);
//     res.status(200).json({ ok: true, message: 'FAQ deleted' });
//   } catch (error) {
//     next(error);
//   }
// };

// // ========== Tickets ==========
// export const createTicket = async (req, res, next) => {
//   try {
//     const { wallet, category, subject, message, txHash } = req.body;
    
//     if (!wallet || !category || !subject || !message) {
//       return res.status(400).json({
//         ok: false,
//         message: 'Missing required fields'
//       });
//     }
    
//     const ticket = await SupportTicket.create({
//       wallet: wallet.toLowerCase(),
//       category,
//       subject,
//       message,
//       txHash: txHash || ''
//     });
    
//     res.status(201).json({
//       ok: true,
//       data: ticket,
//       message: 'Ticket submitted successfully'
//     });
//   } catch (error) {
//     next(error);
//   }
// };

// export const getTicketsByWallet = async (req, res, next) => {
//   try {
//     const { wallet } = req.params;
    
//     const tickets = await SupportTicket.find({ wallet: wallet.toLowerCase() })
//       .sort({ createdAt: -1 })
//       .limit(10);
    
//     res.status(200).json({
//       ok: true,
//       data: tickets
//     });
//   } catch (error) {
//     next(error);
//   }
// };

// export const getTickets = async (req, res, next) => {
//   try {
//     const { status } = req.query;
//     const query = status ? { status } : {};
    
//     const tickets = await SupportTicket.find(query)
//       .sort({ createdAt: -1 });
    
//     res.status(200).json({
//       ok: true,
//       data: tickets
//     });
//   } catch (error) {
//     next(error);
//   }
// };

// export const updateTicketStatus = async (req, res, next) => {
//   try {
//     const { id } = req.params;
//     const { status } = req.body;
    
//     const ticket = await SupportTicket.findByIdAndUpdate(
//       id,
//       { status },
//       { new: true }
//     );
    
//     res.status(200).json({ ok: true, data: ticket });
//   } catch (error) {
//     next(error);
//   }
// };

// export const addAdminNote = async (req, res, next) => {
//   try {
//     const { id } = req.params;
//     const { adminNotes } = req.body;
    
//     const ticket = await SupportTicket.findByIdAndUpdate(
//       id,
//       { adminNotes },
//       { new: true }
//     );
    
//     res.status(200).json({ ok: true, data: ticket });
//   } catch (error) {
//     next(error);
//   }
// };