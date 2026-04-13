import express from 'express';
import {
  getFaqs,
  createFaq,
  updateFaq,
  deleteFaq,
  getTickets,
  getTicketsByWallet,
  createTicket,
  updateTicketStatus,
  addAdminNote
} from '../controllers/supportController.js';
import { requireAdmin } from '../middleware/requireAdmin.js';

const router = express.Router();

// Public routes
router.get('/faqs', getFaqs);
router.post('/tickets', createTicket);
router.get('/tickets/:wallet', getTicketsByWallet);

// Admin routes
router.use(requireAdmin);
router.get('/admin/tickets', getTickets);
router.post('/faqs', createFaq);
router.patch('/faqs/:id', updateFaq);
router.delete('/faqs/:id', deleteFaq);
router.patch('/tickets/:id/status', updateTicketStatus);
router.patch('/tickets/:id/notes', addAdminNote);

export default router;