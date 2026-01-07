import { Ticket } from "../../models/ticketModel";
import { openai } from "./aiClient";

export async function suggestReply(params: {
  ticketId: string;
  maxComments?: number; // how many recent comments to include
}): Promise<{ suggestion: string }> {
  const { ticketId } = params;
  // clamp 0..10 and default to 5
  const maxCommentsRaw =
    typeof params.maxComments === "number" &&
    Number.isFinite(params.maxComments)
      ? params.maxComments
      : 5;

  const maxComments = Math.min(Math.max(maxCommentsRaw, 0), 10);

  // 1) Load ticket (lean for speed)
  const ticket = await Ticket.findById(ticketId)
    .populate("comments.author", "email")
    .lean();
  if (!ticket) throw new Error("Ticket not found");

  // 2) Build context (ticket + last comments if exist)
  const title = String(ticket.title ?? "");
  const description = String(ticket.description ?? "");
  const category = String(ticket.category ?? "");
  const priority = String(ticket.priority ?? "");
  const status = String(ticket.status ?? "");

  const comments = Array.isArray(ticket.comments) ? ticket.comments : [];
  const lastComments = comments.slice(-maxComments).map((c: any) => ({
    body: c.body,
    createdAt: c.createdAt,
    author: c.author?.email ?? "Unknown",
  }));

  const input = `
  You are a support agent assistant.
  Write a helpful reply draft to the user.
  Rules:
  - Do NOT claim actions you didn't do.
  - Ask 1-2 clarifying questions if needed.
  - Keep it concise and professional.
  - Output ONLY the reply text (no JSON).
  
  Ticket:
  Title: ${title}
  Description: ${description}
  Category: ${category}
  Priority: ${priority}
  Status: ${status}
  
  Recent comments (if any):
  ${lastComments.length ? JSON.stringify(lastComments, null, 2) : "(none)"}
  `.trim();

  // 3) Call OpenAI
  const resp = await openai.responses.create({
    model: process.env.AI_MODEL || "gpt-4.1-mini",
    input,
  });

  const suggestion = resp.output_text?.trim();
  if (!suggestion) throw new Error("No suggestion returned");

  return { suggestion };
}
