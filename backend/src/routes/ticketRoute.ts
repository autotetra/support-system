import express from "express";
import {
  createTicket,
  getTickets,
  getTicketById,
  updateTicket,
  deleteTicket,
  addCommentToTicket,
} from "../controllers/ticketController";
import requireAuth from "../middleware/requireAuth";
import validateBody from "../middleware/validateBody";
import { createTicketSchema } from "../validators/ticketValidation";

/**
 * Ticket routes
 * - All routes require authentication
 * - Validation is applied only where needed
 */
const router = express.Router();

// Create ticket
router.post("/", requireAuth, validateBody(createTicketSchema), createTicket);

// Get tickets (role-based filtering in controller)
router.get("/", requireAuth, getTickets);

// Get single ticket (permission checked in controller)
router.get("/:id", requireAuth, getTicketById);

// Update ticket (permission checked in controller)
router.patch("/:id", requireAuth, updateTicket);

// Delete ticket
router.delete("/:id", requireAuth, deleteTicket);

// Add comment to ticket
router.post("/:id/comments", requireAuth, addCommentToTicket);

export default router;