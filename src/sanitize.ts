import { basename } from "node:path";

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,59}(?:\/[A-Za-z0-9][A-Za-z0-9._-]{0,59})?$/;
const PRIVATE_MARKER = /(?:api[-_]?key|auth|credential|password|secret|token)/i;
const SECRET_VALUE = /(?:\bghp_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bglpat-[A-Za-z0-9_-]{20,}\b|\bhf_[A-Za-z0-9]{20,}\b|\bnpm_[A-Za-z0-9]{20,}\b|\bxox[a-zA-Z]-[A-Za-z0-9-]{10,}\b|\bsk-[A-Za-z0-9_-]{8,}\b|\bAIza[A-Za-z0-9_-]{20,}\b|\bAKIA[A-Z0-9]{16}\b|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b)/i;
const URL_LIKE = /(?:https?:\/\/|https?:\/(?!\/)|\/\/)/i;
const KNOWN_TOOLS = new Set([
  "bash", "edit", "find", "grep", "interview", "ls", "read", "search", "terminal",
  "ask_user_question", "question", "write",
]);
const INTERACTIVE_TOOLS = new Set(["ask_user_question", "question", "interview"]);

export type CommandCategory =
  | "build"
  | "filesystem"
  | "package-manager"
  | "process"
  | "test"
  | "version-control"
  | "shell";

export interface ToolActivity {
  toolName: string;
  summary: string;
  interactive: boolean;
}

function isPrivate(value: string): boolean {
  return PRIVATE_MARKER.test(value) || SECRET_VALUE.test(value) || URL_LIKE.test(value);
}

export function sanitizeProject(value: unknown): string | undefined {
  if (typeof value !== "string" || isPrivate(value)) return undefined;
  const name = basename(value);
  return SAFE_NAME.test(name) && !isPrivate(name) ? name : undefined;
}

export function sanitizeModel(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_MODEL.test(value) && !isPrivate(value) ? value : undefined;
}

export function sanitizeToolName(value: unknown): string {
  return typeof value === "string" && KNOWN_TOOLS.has(value.toLowerCase()) ? value.toLowerCase() : "tool";
}

export function isInteractiveTool(value: unknown): boolean {
  return INTERACTIVE_TOOLS.has(sanitizeToolName(value));
}

export function sanitizeFileBasename(value: unknown): string | undefined {
  if (typeof value !== "string" || isPrivate(value)) return undefined;
  const name = basename(value);
  return SAFE_NAME.test(name) && !isPrivate(name) ? name : undefined;
}

export function classifyCommand(value: unknown): CommandCategory {
  if (typeof value !== "string") return "shell";
  const command = value.trim();
  if (/^(npm|pnpm|yarn|bun)\s+(test|run\s+test)\b/.test(command)) return "test";
  if (/^(npm|pnpm|yarn|bun)\s+(run\s+)?build\b/.test(command)) return "build";
  if (/^(npm|pnpm|yarn|bun)\b/.test(command)) return "package-manager";
  if (/^git\b/.test(command)) return "version-control";
  if (/^(ls|find|grep|rg|cat|cp|mv|rm|mkdir|touch|sed|awk)\b/.test(command)) return "filesystem";
  if (/^(ps|kill|pgrep|pkill)\b/.test(command)) return "process";
  return "shell";
}

function valueAt(input: unknown, names: string[]): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const record = input as Record<string, unknown>;
  for (const name of names) {
    if (name in record) return record[name];
  }
  return undefined;
}

export function summarizeTool(value: unknown, input: unknown): ToolActivity {
  const toolName = sanitizeToolName(value);
  const interactive = INTERACTIVE_TOOLS.has(toolName);
  if (interactive) return { toolName, interactive, summary: "Waiting for input" };

  if (toolName === "bash" || toolName === "terminal") {
    return { toolName, interactive, summary: `Command: ${classifyCommand(valueAt(input, ["command", "cmd"]))}` };
  }

  const file = sanitizeFileBasename(valueAt(input, ["path", "file", "filename"]));
  return { toolName, interactive, summary: file ? `${toolName}: ${file}` : `Using ${toolName}` };
}
