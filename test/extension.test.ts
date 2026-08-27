import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installAgentPetExtension } from "../extensions/agent-pet.js";
import { AgentPetTransport, type AgentPetEvent } from "../src/transport.js";

class FakePi {
  public readonly handlers = new Map<string, (...args: any[]) => void | Promise<void>>();
  public command?: { name: string; handler: (args: string, context: any) => Promise<void> };
  public on(eventName: string, handler: (...args: any[]) => void | Promise<void>): void { this.handlers.set(eventName, handler); }
  public registerCommand(name: string, command: { handler: (args: string, context: any) => Promise<void> }): void {
    this.command = { name, handler: command.handler };
  }
}

async function listen(server: Server, socketPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("extension uses Pi 0.84.3 fields and awaits idle delivery at shutdown", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pi-agent-pet-"));
  const socketPath = join(directory, "agentpet.sock");
  const events: AgentPetEvent[] = [];
  let resolveEvents: (() => void) | undefined;
  const allEvents = new Promise<void>((resolve) => { resolveEvents = resolve; });
  const server = createServer((socket) => {
    let data = "";
    socket.on("data", (chunk) => { data += chunk.toString("utf8"); });
    socket.on("end", () => {
      for (const line of data.trim().split("\n")) if (line) events.push(JSON.parse(line) as AgentPetEvent);
      if (events.length === 6) resolveEvents?.();
    });
  });
  await listen(server, socketPath);
  t.after(async () => { await close(server); await rm(directory, { recursive: true, force: true }); });

  const pi = new FakePi();
  const transport = new AgentPetTransport({ socketPath, queueDir: join(directory, "queue"), timeoutMs: 100, queueMaxEntries: 10 });
  installAgentPetExtension(pi as unknown as ExtensionAPI, { transport, diagnosticDelayMs: 0 });
  const context = { cwd: "/work/demo", getContextUsage: () => ({ tokens: 99 }) };
  await pi.handlers.get("session_start")!({ type: "session_start", reason: "startup" }, context);
  await pi.handlers.get("model_select")!({ type: "model_select", model: { id: "provider/model-1" }, previousModel: undefined, source: "set" }, context);
  await pi.handlers.get("message_update")!({
    type: "message_update",
    message: {},
    assistantMessageEvent: { type: "thinking_delta" },
  }, context);
  await pi.handlers.get("tool_execution_start")!({ type: "tool_execution_start", toolCallId: "call-1", toolName: "read", args: { path: "/secret/safe.ts" } }, context);
  await pi.handlers.get("tool_execution_end")!({ type: "tool_execution_end", toolCallId: "call-1", toolName: "read", result: {}, isError: false }, context);
  await pi.handlers.get("turn_end")!({
    type: "turn_end",
    turnIndex: 0,
    message: { role: "assistant", usage: { totalTokens: 42 } },
    toolResults: [],
  }, context);
  await pi.handlers.get("agent_settled")!({ type: "agent_settled" }, context);
  await pi.handlers.get("session_shutdown")!({ type: "session_shutdown", reason: "quit" }, context);
  await allEvents;

  assert.deepEqual(events.map((event) => event.eventName), ["registered", "working", "working", "working", "done", "idle"]);
  assert.match(events.find((event) => event.eventName === "done")?.message || "", /42 tokens/);
  assert.doesNotMatch(JSON.stringify(events), /secret/);
  assert.equal(pi.handlers.has("agent_end"), false);
});

test("status probes the socket and test sends the complete diagnostic sequence", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pi-agent-pet-"));
  const socketPath = join(directory, "agentpet.sock");
  const events: AgentPetEvent[] = [];
  let resolveDiagnostic: (() => void) | undefined;
  const diagnostic = new Promise<void>((resolve) => { resolveDiagnostic = resolve; });
  const server = createServer((socket) => {
    let data = "";
    socket.on("data", (chunk) => { data += chunk.toString("utf8"); });
    socket.on("end", () => {
      for (const line of data.trim().split("\n")) if (line) events.push(JSON.parse(line) as AgentPetEvent);
      if (events.length === 5) resolveDiagnostic?.();
    });
  });
  await listen(server, socketPath);
  t.after(async () => { await close(server); await rm(directory, { recursive: true, force: true }); });

  const pi = new FakePi();
  const transport = new AgentPetTransport({ socketPath, queueDir: join(directory, "queue"), timeoutMs: 100, queueMaxEntries: 10 });
  installAgentPetExtension(pi as unknown as ExtensionAPI, { transport, diagnosticDelayMs: 0 });
  const notices: string[] = [];
  const commandContext = { cwd: "/work/demo", ui: { notify: (message: string) => notices.push(message) } };
  await pi.command!.handler("status", commandContext);
  assert.match(notices[0], /socket reachable/);
  await pi.command!.handler("test", commandContext);
  await diagnostic;
  assert.deepEqual(events.map((event) => event.eventName), ["registered", "working", "waiting", "done", "idle"]);
  assert.equal(notices.at(-1), "AgentPet diagnostic delivery: socket, socket, socket, socket, socket.");
});
