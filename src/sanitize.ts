import { basename } from "node:path";

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,59}(?:\/[A-Za-z0-9][A-Za-z0-9._-]{0,59})?$/;
const SAFE_TOOL_NAME = /^[A-Za-z][A-Za-z0-9._:-]{0,99}$/;
const SAFE_ACTION = /^[A-Za-z][A-Za-z0-9._:-]{0,39}$/;
const PRIVATE_MARKER = /(?:api[-_]?key|auth|credential|password|secret|token)/i;
const SECRET_VALUE = /(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|hf_[A-Za-z0-9]{20,}|npm_[A-Za-z0-9]{20,}|xox[a-zA-Z]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/i;
const URL_LIKE = /(?:https?:\/\/|https?:\/(?!\/)|\/\/)/i;
const INTERACTIVE_TOOLS = new Set(["ask_user_question", "question", "interview"]);
const FILE_TOOLS = new Set(["apply_patch", "edit", "find", "grep", "insert", "ls", "read", "replace", "write"]);
const ACTIONS_BY_TOOL: Readonly<Record<string, ReadonlySet<string>>> = {
  intercom: new Set(["ask", "list", "pending", "reply", "send", "status"]),
  runtime_status: new Set(["clear", "list", "refresh", "remove", "upsert"]),
  subagent: new Set([
    "children.list", "create", "debug.run", "delete", "disable", "doctor", "eject", "enable", "get", "guide",
    "interrupt", "list", "mission.close", "mission.create", "mission.list", "mission.show", "mission.update", "models",
    "project.close", "project.open", "project.status", "reset", "resume", "schedule.create", "schedule.delete",
    "schedule.history", "schedule.list", "schedule.pause", "schedule.resume", "schedule.run", "schedule.run-due",
    "schedule.show", "status", "steer", "stop", "update", "watchdog.configure", "worktree.discard",
  ]),
  subagent_supervisor: new Set(["ask", "list", "pending", "reply", "send", "status"]),
  todo: new Set(["clear", "create", "delete", "get", "list", "update"]),
};

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
  if (typeof value !== "string" || !SAFE_TOOL_NAME.test(value) || isPrivate(value)) return "tool";
  return value;
}

export function isInteractiveTool(value: unknown): boolean {
  return INTERACTIVE_TOOLS.has(sanitizeToolName(value).toLowerCase());
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

function sanitizeAction(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_ACTION.test(value) && !isPrivate(value) ? value : undefined;
}

export function summarizeTool(value: unknown, input: unknown): ToolActivity {
  const toolName = sanitizeToolName(value);
  const capabilityToolName = toolName === toolName.toLowerCase() ? toolName : "";
  const interactive = INTERACTIVE_TOOLS.has(capabilityToolName);
  if (interactive) return { toolName, interactive, summary: "Waiting for input" };

  if (capabilityToolName === "bash" || capabilityToolName === "terminal") {
    return { toolName, interactive, summary: `Command: ${classifyCommand(valueAt(input, ["command", "cmd"]))}` };
  }

  if (FILE_TOOLS.has(capabilityToolName)) {
    const file = sanitizeFileBasename(valueAt(input, ["path", "file", "filename"]));
    if (file) return { toolName, interactive, summary: `${toolName}: ${file}` };
  }

  const allowedActions = ACTIONS_BY_TOOL[capabilityToolName];
  const action = allowedActions ? sanitizeAction(valueAt(input, ["action"])) : undefined;
  return {
    toolName,
    interactive,
    summary: action && allowedActions?.has(action) ? `${toolName}: ${action}` : `Using ${toolName}`,
  };
}
