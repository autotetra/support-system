import { Router } from "express";
import requireAuth from "../middleware/requireAuth";
import requireRole from "../middleware/requireRole";
import { suggestReply } from "../services/ai/replySuggester";
import { CustomRequest } from "../../types/express/custom";

const router = Router();

/**
 * POST /api/ai/suggest-reply
 * body: { ticketId: string, maxComments?: number }
 */

router.post(
  "/suggest-reply",
  requireAuth,
  requireRole("Admin", "Agent"),
  async (req: CustomRequest, res) => {
    try {
      const { ticketId, maxComments } = req.body;

      if (!ticketId) {
        return res.status(400).json({ message: "ticketId is required." });
      }

      const result = await suggestReply({
        ticketId,
        maxComments: typeof maxComments === "number" ? maxComments : undefined,
        triggeredBy: String(req.user!._id),
        endpoint: "/api/ai/suggest-reply",
      });

      return res.json(result);
    } catch (err) {
      console.error("AI suggest-reply error:", err);
      return res.status(500).json({ message: "Internal server error." });
    }
  }
);

export default router;
