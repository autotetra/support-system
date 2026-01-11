import { Response } from "express";
import { CustomRequest } from "../../types/express/custom";
import { Ticket } from "../models/ticketModel";
import { User, IUser } from "../models/userModel";
import { canManageTicket } from "../utils/ticketPermissions";
import {
  emitTicketCreated,
  emitTicketUpdated,
  emitTicketDeleted,
} from "../socket/ticketSocket";
import { classifyTicket } from "../services/ai/ticketClassifier";

const AI_CATEGORY_CONFIDENCE_THRESHOLD = 0.8;

/**
 * Create new ticket
 * - Category is AI-suggested only when confidence is high
 * - Auto-assigns agent based on lowest open ticket count (same logic as before)
 * - Emits ticketCreated event
 */
export const createTicket = async (req: CustomRequest, res: Response) => {
  try {
    const { title, description, category } = req.body;
    const createdBy = req.user?.id;

    // ---------------------------
    // 1) Decide final category
    // ---------------------------
    let finalCategory = category;

    try {
      const ai = await classifyTicket({
        title,
        description,
        endpoint: "/api/tickets",
        triggeredBy: String(req.user!._id),

        // ticketId: optional — only pass if you already have one
      });

      if (ai.confidence >= AI_CATEGORY_CONFIDENCE_THRESHOLD) {
        finalCategory = ai.category;
      }
      // else: keep the user-provided category (current behavior)
    } catch (err) {
      // AI failure should never block ticket creation
      console.error("AI classification failed, using user category:", err);
      finalCategory = category;
    }

    // ---------------------------
    // 2) Agent auto-assignment (UNCHANGED logic)
    // ---------------------------
    const agentMembers: IUser[] = await User.find({
      role: "Agent",
      departments: category,
    });

    let assignee: string | null = null;

    if (agentMembers.length > 0) {
      const membersWithCounts = await Promise.all(
        agentMembers.map(async (member) => {
          const openCount = await Ticket.countDocuments({
            assignee: member._id,
            status: "Open",
          });

          return { member, openCount };
        })
      );

      membersWithCounts.sort((a, b) => a.openCount - b.openCount);
      assignee = membersWithCounts[0].member._id.toString();
    }

    // ---------------------------
    // 3) Create ticket (UNCHANGED fields, except category uses finalCategory)
    // ---------------------------
    const ticket = await Ticket.create({
      title,
      description,
      category: finalCategory,
      createdBy,
      assignee,
    });

    emitTicketCreated(ticket);

    res.status(201).json({
      message: "Ticket created successfully",
      ticket,
    });
  } catch (err) {
    console.error("Create ticket error:", err);
    res.status(500).json({ message: "Internal server error." });
  }
};

/**
 * Get tickets based on user role
 */
export const getTickets = async (req: CustomRequest, res: Response) => {
  try {
    let filter = {};

    if (req.user?.role === "User") {
      filter = { createdBy: req.user.id };
    } else if (req.user?.role === "Agent") {
      filter = { assignee: req.user.id };
    }

    const tickets = await Ticket.find(filter)
      .populate("createdBy", "firstName lastName email role")
      .populate("assignee", "firstName lastName email role")
      .populate("comments.author", "firstName lastName email role")
      .sort({ createdAt: -1 });

    res.status(200).json(tickets);
  } catch (err) {
    console.error("Get tickets error:", err);
    res.status(500).json({ message: "Internal server error." });
  }
};

/**
 * Get single ticket (permission-protected)
 */
export const getTicketById = async (req: CustomRequest, res: Response) => {
  try {
    const ticket = await Ticket.findById(req.params.id)
      .populate("createdBy", "firstName lastName email role")
      .populate("assignee", "firstName lastName email role")
      .populate("comments.author", "firstName lastName email role");

    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found." });
    }

    const { canModify } = canManageTicket(req, ticket);
    if (!canModify) {
      return res.status(403).json({ message: "Access denied." });
    }

    res.status(200).json(ticket);
  } catch (err) {
    console.error("Error fetching ticket:", err);
    res.status(500).json({ message: "Internal server error." });
  }
};

/**
 * Update ticket fields (permission-checked)
 * - Emits ticketUpdated with populated data
 */
export const updateTicket = async (req: CustomRequest, res: Response) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const ticket = await Ticket.findById(id);
    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found." });
    }

    const user = req.user;
    if (!user) {
      return res.status(401).json({ message: "Unauthorized." });
    }

    const { canModify } = canManageTicket(req, ticket);
    if (!canModify) {
      return res
        .status(403)
        .json({ message: "You are not allowed to update this ticket." });
    }

    Object.assign(ticket, updates);
    await ticket.save();

    const populatedTicket = await Ticket.findById(ticket._id)
      .populate("createdBy", "firstName lastName email role")
      .populate("assignee", "firstName lastName email role")
      .populate("comments.author", "firstName lastName email role");

    if (!populatedTicket) {
      return res.status(500).json({ message: "Failed to reload ticket." });
    }

    emitTicketUpdated(populatedTicket);
    return res.status(200).json(populatedTicket);
  } catch (err) {
    console.error("Error updating ticket:", err);
    res.status(500).json({ message: "Internal server error." });
  }
};

/**
 * Delete ticket
 * - Emits ticketDeleted event
 */
export const deleteTicket = async (req: CustomRequest, res: Response) => {
  try {
    const { id } = req.params;
    const ticket = await Ticket.findById(id);

    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found." });
    }

    const { canModify } = canManageTicket(req, ticket);
    if (!canModify) {
      return res
        .status(403)
        .json({ message: "Not authorized to delete this ticket." });
    }

    await Ticket.findByIdAndDelete(id);
    emitTicketDeleted(ticket);

    res.status(200).json({ message: "Ticket deleted successfully." });
  } catch (err) {
    console.error("Error deleting ticket:", err);
    res.status(500).json({ message: "Internal server error." });
  }
};

/**
 * Add comment to ticket
 * - Emits ticketUpdated with populated comments
 */
export const addCommentToTicket = async (req: CustomRequest, res: Response) => {
  try {
    const ticketId = req.params.id;
    const user = req.user;

    if (!user) {
      return res.status(401).json({ message: "Unauthorized." });
    }

    const { body } = req.body;
    if (!body || body.trim() === "") {
      return res.status(400).json({ message: "Comment body is required." });
    }

    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found." });
    }

    ticket.comments.push({
      author: user._id,
      body,
    } as any);

    await ticket.save();

    const updated = await Ticket.findById(ticketId)
      .populate("createdBy", "firstName lastName email role")
      .populate("assignee", "firstName lastName email role")
      .populate("comments.author", "firstName lastName email role");

    if (!updated) {
      return res
        .status(500)
        .json({ message: "Failed to reload updated ticket." });
    }

    emitTicketUpdated(updated);
    return res.status(200).json(updated);
  } catch (err) {
    console.error("Add comment error:", err);
    res.status(500).json({ message: "Internal server error." });
  }
};

export default createTicket;
