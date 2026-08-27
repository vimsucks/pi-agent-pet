import { homedir } from "node:os";
import { join } from "node:path";

export interface AgentPetConfig {
  socketPath: string;
  queueDir: string;
  timeoutMs: number;
  queueMaxEntries: number;
}

const DEFAULT_TIMEOUT_MS = 350;
const DEFAULT_QUEUE_MAX_ENTRIES = 100;

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function enabled(value: string | undefined): boolean {
  return value !== undefined && ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function shouldReportSession(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PI_SUBAGENT_CHILD !== "1" || enabled(env.PI_AGENTPET_INCLUDE_SUBAGENTS);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentPetConfig {
  const root = env.HOME || homedir();
  return {
    socketPath: env.AGENTPET_SOCKET_PATH || join(root, ".agentpet", "agentpet.sock"),
    queueDir: env.AGENTPET_QUEUE_DIR || join(root, ".agentpet", "queue"),
    timeoutMs: positiveInteger(env.AGENTPET_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    queueMaxEntries: positiveInteger(env.AGENTPET_QUEUE_MAX_ENTRIES, DEFAULT_QUEUE_MAX_ENTRIES),
  };
}
