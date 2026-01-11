import { Ticket } from "../../models/ticketModel";
import { openai } from "./aiClient";
import { Types } from "mongoose";
import { AiLogModel } from "../../models/aiLogModel";

export async function suggestReply(params: {
  ticketId: string;
  maxComments?: number; // how many recent comments to include
  triggeredBy?: string; // user ID who triggered this
  endpoint: string; // API endpoint
}): Promise<{ suggestion: string }> {
  const startedAt = Date.now();
  const { ticketId, triggeredBy, endpoint } = params;
  const aiModel = process.env.OPENAI_MODEL || "gpt-4.1-mini";

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

  try {
    // 3) Call OpenAI
    const resp = await openai.responses.create({
      model: aiModel,
      input,
    });

    const suggestion = resp.output_text?.trim();
    if (!suggestion) throw new Error("No suggestion returned");

    // 4) Log success
    await AiLogModel.create({
      type: "suggest_reply",
      ticketId: new Types.ObjectId(ticketId),
      triggeredBy: new Types.ObjectId(triggeredBy),
      aiModel,
      endpoint,
      inputPreview: input.slice(0, 800),
      success: true,
      usage: {
        inputTokens: (resp as any)?.usage?.input_tokens,
        outputTokens: (resp as any)?.usage?.output_tokens,
        totalTokens: (resp as any)?.usage?.total_tokens,
      },
      latencyMs: Date.now() - startedAt,
    });

    return { suggestion };
  } catch (err: any) {
    // Log failure (don’t block the request if logging fails)
    try {
      await AiLogModel.create({
        type: "suggest_reply",
        ticketId: new Types.ObjectId(ticketId),
        triggeredBy: new Types.ObjectId(triggeredBy),
        aiModel,
        endpoint,
        inputPreview: input.slice(0, 800),
        success: false,
        error: err?.message || "Unknown error",
        latencyMs: Date.now() - startedAt,
      });
    } catch {}

    throw err;
  }
}
