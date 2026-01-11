import mongoose, { Schema, Types } from "mongoose";

export type AiLogType = "ticket_classify" | "suggest_reply";

export interface AiLog {
  type: AiLogType;

  ticketId?: Types.ObjectId;
  triggeredBy: Types.ObjectId;

  aiModel: string;
  endpoint: string;

  inputPreview?: string;

  success: boolean;
  error?: string;

  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };

  latencyMs?: number;

  createdAt: Date;
  updatedAt: Date;
}

const aiLogSchema = new Schema<AiLog>(
  {
    type: {
      type: String,
      enum: ["ticket_classify", "suggest_reply"],
      required: true,
    },

    ticketId: { type: Schema.Types.ObjectId, ref: "Ticket" },
    triggeredBy: { type: Schema.Types.ObjectId, ref: "User", required: true },

    aiModel: { type: String, required: true },
    endpoint: { type: String, required: true },

    inputPreview: { type: String },

    success: { type: Boolean, required: true },
    error: { type: String },

    usage: {
      inputTokens: Number,
      outputTokens: Number,
      totalTokens: Number,
    },

    latencyMs: Number,
  },
  { timestamps: true }
);

export const AiLogModel = mongoose.model<AiLog>("AiLog", aiLogSchema);
