import SupportFaq from '../models/SupportFaq.js';
import SupportTicket from '../models/SupportTicket.js';

// ========== FAQs ==========
export const getFaqs = async (req, res, next) => {
  try {
    const faqs = await SupportFaq.find({ isActive: true })
      .sort({ category: 1, order: 1, createdAt: -1 });
    
    res.status(200).json({
      ok: true,
      data: faqs
    });
  } catch (error) {
    next(error);
  }
};

export const createFaq = async (req, res, next) => {
  try {
    const faq = await SupportFaq.create(req.body);
    res.status(201).json({ ok: true, data: faq });
  } catch (error) {
    next(error);
  }
};

export const updateFaq = async (req, res, next) => {
  try {
    const faq = await SupportFaq.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.status(200).json({ ok: true, data: faq });
  } catch (error) {
    next(error);
  }
};

export const deleteFaq = async (req, res, next) => {
  try {
    await SupportFaq.findByIdAndDelete(req.params.id);
    res.status(200).json({ ok: true, message: 'FAQ deleted' });
  } catch (error) {
    next(error);
  }
};

// ========== Tickets ==========
export const createTicket = async (req, res, next) => {
  try {
    const { wallet, category, subject, message, txHash } = req.body;
    
    if (!wallet || !category || !subject || !message) {
      return res.status(400).json({
        ok: false,
        message: 'Missing required fields'
      });
    }
    
    const ticket = await SupportTicket.create({
      wallet: wallet.toLowerCase(),
      category,
      subject,
      message,
      txHash: txHash || ''
    });
    
    res.status(201).json({
      ok: true,
      data: ticket,
      message: 'Ticket submitted successfully'
    });
  } catch (error) {
    next(error);
  }
};

export const getTicketsByWallet = async (req, res, next) => {
  try {
    const { wallet } = req.params;
    
    const tickets = await SupportTicket.find({ wallet: wallet.toLowerCase() })
      .sort({ createdAt: -1 })
      .limit(10);
    
    res.status(200).json({
      ok: true,
      data: tickets
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
      .sort({ createdAt: -1 });
    
    res.status(200).json({
      ok: true,
      data: tickets
    });
  } catch (error) {
    next(error);
  }
};

export const updateTicketStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    const ticket = await SupportTicket.findByIdAndUpdate(
      id,
      { status },
      { new: true }
    );
    
    res.status(200).json({ ok: true, data: ticket });
  } catch (error) {
    next(error);
  }
};

export const addAdminNote = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { adminNotes } = req.body;
    
    const ticket = await SupportTicket.findByIdAndUpdate(
      id,
      { adminNotes },
      { new: true }
    );
    
    res.status(200).json({ ok: true, data: ticket });
  } catch (error) {
    next(error);
  }
};