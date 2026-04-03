import { z } from "zod/v4";

// ─── Agent command validation ───────────────────────────────────────────────

export const AgentCommandSchema = z.object({
  command: z.string().min(1, "Command cannot be empty").max(5000, "Command too long (max 5000 chars)"),
  sessionId: z.string().max(100).optional(),
  chatHistory: z
    .array(z.object({ role: z.string(), text: z.string().max(5000) }))
    .max(50)
    .optional(),
  resumeData: z.record(z.string(), z.unknown()).optional(),
});

export type AgentCommand = z.infer<typeof AgentCommandSchema>;

// ─── Email send validation ──────────────────────────────────────────────────

export const EmailSendSchema = z.object({
  to_email: z.email("Invalid email address"),
  to_name: z.string().max(200).optional(),
  subject: z.string().min(1, "Subject required").max(500, "Subject too long"),
  body: z.string().min(1, "Body required").max(10000, "Body too long (max 10000 chars)"),
  company: z.string().max(200).optional(),
});

export type EmailSend = z.infer<typeof EmailSendSchema>;

// ─── Extension confirm-submit validation ────────────────────────────────────

export const ExtensionConfirmSchema = z.object({
  company: z.string().max(200).optional(),
  jobTitle: z.string().max(300).optional(),
  jobUrl: z.string().max(2000).optional(),
  sessionId: z.string().max(100).optional(),
  fieldsFilledCount: z.number().int().min(0).max(200).optional(),
  resumeUploaded: z.boolean().optional(),
});

export type ExtensionConfirm = z.infer<typeof ExtensionConfirmSchema>;

// ─── Extension push validation ──────────────────────────────────────────────

export const ExtensionPushSchema = z.object({
  profile: z.record(z.string(), z.unknown()).optional(),
  resumeBlob: z.string().max(10_000_000).nullable().optional(), // Max 10MB base64
  packs: z.array(z.record(z.string(), z.unknown())).max(50).optional(),
});

export type ExtensionPush = z.infer<typeof ExtensionPushSchema>;

// ─── Validation helper ──────────────────────────────────────────────────────

export function validateRequest<T>(
  schema: z.ZodType<T>,
  data: unknown
): { success: true; data: T } | { success: false; error: Response } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    error: Response.json(
      { error: "Validation failed", details: result.error.issues.map((i) => i.message) },
      { status: 400 }
    ),
  };
}

// ─── Sanitization ───────────────────────────────────────────────────────────

export function sanitizeHtml(input: string): string {
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<[^>]*>/g, "")
    .trim();
}
