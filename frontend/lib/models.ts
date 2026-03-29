import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

// ─── Provider clients (lazy-initialized) ───────────────────────────────────

let _anthropic: Anthropic | null = null;
let _openai: OpenAI | null = null;
let _gemini: GoogleGenerativeAI | null = null;

function getAnthropic(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic();
  return _anthropic;
}

function getOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI();
  return _openai;
}

function getGemini(): GoogleGenerativeAI {
  if (!_gemini) _gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  return _gemini;
}

// ─── Types ──────────────────────────────────────────────────────────────────

export type ModelProvider = "claude" | "openai" | "gemini" | "ollama";

export interface ModelConfig {
  provider: ModelProvider;
  model: string;
  maxTokens: number;
}

export interface CompletionRequest {
  system: string;
  userMessage: string;
  maxTokens?: number;
}

export interface CompletionResponse {
  text: string;
  provider: ModelProvider;
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
}

// ─── Model presets ──────────────────────────────────────────────────────────

export const MODELS = {
  // Mother agent — primary orchestration, complex reasoning
  mother: { provider: "claude" as ModelProvider, model: "claude-sonnet-4-20250514", maxTokens: 4096 },

  // Secondary — cheap tasks: scoring, classification, email drafts
  secondary: { provider: "openai" as ModelProvider, model: "gpt-4o-mini", maxTokens: 4096 },

  // Backup — fallback if Claude + OpenAI both fail
  backup: { provider: "gemini" as ModelProvider, model: "gemini-1.5-flash", maxTokens: 4096 },

  // Local — offline fallback, privacy-sensitive tasks
  local: { provider: "ollama" as ModelProvider, model: "llama3.2", maxTokens: 2048 },
} as const;

// Convenience export — use instead of hardcoding "claude-sonnet-4-20250514"
export const CLAUDE_MODEL = MODELS.mother.model;

// ─── Task → Model routing ───────────────────────────────────────────────────
// Distributes work across ALL 4 providers based on their strengths:
// Claude Sonnet  → complex reasoning, orchestration
// GPT-4o mini    → fast structured JSON (scoring, form mapping)
// Gemini Flash   → natural writing (emails, cover letters) — free tier
// Ollama local   → simple extraction (resume parse, classification) — free & private

export type TaskType =
  | "mother_agent"       // Main orchestration — Claude Sonnet
  | "apply_pack"         // Full apply pack — Claude Sonnet (quality matters)
  | "job_match"          // Scoring/ranking — GPT-4o mini (fast JSON)
  | "form_fill"          // Field mapping — GPT-4o mini (structured output)
  | "cover_letter"       // Cover letter — Gemini Flash (great writing, free)
  | "email_draft"        // Cold email/follow-up — Gemini Flash (natural tone)
  | "document_prep"      // Document tailoring — Gemini Flash (writing)
  | "resume_parse"       // Structured extraction — Ollama (simple, private, free)
  | "email_classify";    // Gmail classification — Ollama (simple labeling, free)

const TASK_ROUTING: Record<TaskType, ModelConfig> = {
  // Claude Sonnet — the brain (complex reasoning)
  mother_agent:   MODELS.mother,
  apply_pack:     MODELS.mother,

  // GPT-4o mini — the calculator (fast structured JSON)
  job_match:      MODELS.secondary,
  form_fill:      MODELS.secondary,

  // Gemini Flash — the writer (natural emails & letters, free tier)
  cover_letter:   MODELS.backup,
  email_draft:    MODELS.backup,
  document_prep:  MODELS.backup,

  // Ollama local — the workhorse (simple extraction, free & private)
  resume_parse:   MODELS.local,
  email_classify: MODELS.local,
};

export function getModelForTask(task: TaskType): ModelConfig {
  return TASK_ROUTING[task];
}

// ─── Fallback chain ─────────────────────────────────────────────────────────

const FALLBACK_CHAIN: ModelConfig[] = [
  MODELS.mother,     // 1st: Claude Sonnet
  MODELS.secondary,  // 2nd: GPT-4o mini
  MODELS.backup,     // 3rd: Gemini Flash
  MODELS.local,      // 4th: Ollama local
];

function getFallbackChain(startProvider: ModelProvider): ModelConfig[] {
  const startIdx = FALLBACK_CHAIN.findIndex((m) => m.provider === startProvider);
  return [
    ...FALLBACK_CHAIN.slice(startIdx),
    ...FALLBACK_CHAIN.slice(0, startIdx),
  ];
}

// ─── Provider-specific completion functions ─────────────────────────────────

async function completeClaude(req: CompletionRequest, config: ModelConfig): Promise<CompletionResponse> {
  const client = getAnthropic();
  const response = await client.messages.create({
    model: config.model,
    max_tokens: req.maxTokens || config.maxTokens,
    system: req.system,
    messages: [{ role: "user", content: req.userMessage }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as Anthropic.TextBlock).text)
    .join("\n");

  return {
    text,
    provider: "claude",
    model: config.model,
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
  };
}

async function completeOpenAI(req: CompletionRequest, config: ModelConfig): Promise<CompletionResponse> {
  const client = getOpenAI();
  const response = await client.chat.completions.create({
    model: config.model,
    max_tokens: req.maxTokens || config.maxTokens,
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.userMessage },
    ],
  });

  return {
    text: response.choices[0]?.message?.content || "",
    provider: "openai",
    model: config.model,
    usage: response.usage
      ? { inputTokens: response.usage.prompt_tokens, outputTokens: response.usage.completion_tokens || 0 }
      : undefined,
  };
}

async function completeGemini(req: CompletionRequest, config: ModelConfig): Promise<CompletionResponse> {
  const client = getGemini();
  const model = client.getGenerativeModel({
    model: config.model,
    systemInstruction: req.system,
  });

  const result = await model.generateContent(req.userMessage);
  const text = result.response.text();

  return {
    text,
    provider: "gemini",
    model: config.model,
    usage: result.response.usageMetadata
      ? { inputTokens: result.response.usageMetadata.promptTokenCount || 0, outputTokens: result.response.usageMetadata.candidatesTokenCount || 0 }
      : undefined,
  };
}

async function completeOllama(req: CompletionRequest, config: ModelConfig): Promise<CompletionResponse> {
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      stream: false,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.userMessage },
      ],
    }),
  });

  if (!response.ok) throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
  const data = await response.json();

  return {
    text: data.message?.content || "",
    provider: "ollama",
    model: config.model,
    usage: data.prompt_eval_count
      ? { inputTokens: data.prompt_eval_count, outputTokens: data.eval_count || 0 }
      : undefined,
  };
}

// ─── Dispatch to provider ───────────────────────────────────────────────────

async function completeWithProvider(req: CompletionRequest, config: ModelConfig): Promise<CompletionResponse> {
  switch (config.provider) {
    case "claude":  return completeClaude(req, config);
    case "openai":  return completeOpenAI(req, config);
    case "gemini":  return completeGemini(req, config);
    case "ollama":  return completeOllama(req, config);
  }
}

// ─── Main completion function with automatic fallback ───────────────────────

export async function complete(
  req: CompletionRequest,
  task: TaskType
): Promise<CompletionResponse> {
  const primaryModel = getModelForTask(task);
  const chain = getFallbackChain(primaryModel.provider);

  let lastError: Error | null = null;

  for (const config of chain) {
    try {
      const result = await completeWithProvider(req, config);
      if (config.provider !== primaryModel.provider) {
        console.log(`[models] ${task}: fell back from ${primaryModel.provider} to ${config.provider}`);
      }
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[models] ${config.provider}/${config.model} failed for ${task}: ${lastError.message}`);
    }
  }

  throw new Error(`All providers failed for task "${task}". Last error: ${lastError?.message}`);
}

// ─── Direct completion (skip routing, specify provider) ─────────────────────

export async function completeDirect(
  req: CompletionRequest,
  config: ModelConfig
): Promise<CompletionResponse> {
  return completeWithProvider(req, config);
}

// Re-export the Anthropic client for backward compat (mother agent tools)
export { getAnthropic as anthropicClient };
