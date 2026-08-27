import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "../src/config.js";
import { AgentPetReporter } from "../src/reporter.js";
import { sanitizeProject, sanitizeSessionName } from "../src/sanitize.js";
import { AgentPetTransport, type AgentPetEvent, type DeliveryResult } from "../src/transport.js";

export interface AgentPetExtensionOptions {
  transport?: AgentPetTransport;
  diagnosticDelayMs?: number;
}

function projectLabel(cwd: string, sessionName: unknown): string | undefined {
  return sanitizeSessionName(sessionName) || sanitizeProject(cwd);
}

function createReporter(transport: AgentPetTransport, cwd: string, sessionName: unknown): AgentPetReporter {
  return new AgentPetReporter(transport, { project: projectLabel(cwd, sessionName) });
}

function currentSessionName(pi: ExtensionAPI): string | undefined {
  try {
    return pi.getSessionName();
  } catch {
    return undefined;
  }
}

function fireAndForget(operation: () => Promise<void> | void): void {
  try {
    void Promise.resolve(operation()).catch(() => undefined);
  } catch {
    // Pi hooks must remain fail-open.
  }
}

function diagnosticEvent(eventName: AgentPetEvent["eventName"], message: string): AgentPetEvent {
  return {
    sessionId: "agent-pet-diagnostic",
    agentKind: "pi",
    eventName,
    project: "agent-pet-diagnostic",
    message,
    timestamp: Math.floor(Date.now() / 1000),
  };
}

function diagnosticSummary(results: DeliveryResult[]): string {
  return `AgentPet diagnostic delivery: ${results.join(", ")}.`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function installAgentPetExtension(pi: ExtensionAPI, options: AgentPetExtensionOptions = {}): void {
  const transport = options.transport || new AgentPetTransport(loadConfig());
  const requestedDiagnosticDelayMs = options.diagnosticDelayMs;
  let diagnosticDelayMs = 400;
  if (typeof requestedDiagnosticDelayMs === "number"
    && Number.isSafeInteger(requestedDiagnosticDelayMs)
    && requestedDiagnosticDelayMs >= 0) {
    diagnosticDelayMs = requestedDiagnosticDelayMs;
  }
  let reporter = createReporter(transport, process.cwd(), undefined);

  pi.on("session_start", (_event, context) => {
    reporter = createReporter(transport, context.cwd, currentSessionName(pi));
    fireAndForget(() => reporter.registered());
  });
  pi.on("session_info_changed", (event, context) => {
    fireAndForget(() => reporter.projectChanged(projectLabel(context.cwd, event.name)));
  });
  pi.on("agent_start", () => fireAndForget(() => reporter.agentStarted()));
  // agent_end deliberately has no handler: Pi can still retry or compact.
  pi.on("agent_settled", () => fireAndForget(() => reporter.settled(undefined)));
  pi.on("turn_start", () => fireAndForget(() => reporter.agentStarted()));
  pi.on("turn_end", (event) => {
    if (event.message.role === "assistant") reporter.updatedUsage(event.message.usage.totalTokens);
  });
  pi.on("message_update", (event) => {
    if (event.assistantMessageEvent.type.startsWith("thinking_")) fireAndForget(() => reporter.thinking());
    else if (event.assistantMessageEvent.type.startsWith("text_")) fireAndForget(() => reporter.writing());
    else if (event.assistantMessageEvent.type.startsWith("toolcall_")) fireAndForget(() => reporter.preparingTool());
  });
  pi.on("tool_execution_start", (event) => fireAndForget(() => reporter.toolStarted(event.toolCallId, event.toolName, event.args)));
  pi.on("tool_execution_end", (event) => fireAndForget(() => reporter.toolEnded(event.toolCallId, event.toolName, undefined, event.isError)));
  pi.on("model_select", (event) => { reporter.selectedModel(event.model.id); });
  pi.on("session_compact", () => fireAndForget(() => reporter.compacting()));
  pi.on("session_compact_failed", () => fireAndForget(() => reporter.compactFailed()));
  pi.on("session_shutdown", async () => {
    try {
      await reporter.idle();
    } catch {
      // Shutdown must not prevent Pi teardown.
    }
  });

  pi.registerCommand("agent-pet", {
    description: "Show AgentPet transport status. Usage: /agent-pet status|test",
    handler: async (args, context): Promise<void> => {
      try {
        const command = args.trim().toLowerCase() || "status";
        if (command === "test") {
          const events: AgentPetEvent[] = [
            diagnosticEvent("registered", "Connected"),
            diagnosticEvent("working", "Thinking"),
            diagnosticEvent("waiting", "Waiting for input"),
            diagnosticEvent("done", "Completed"),
            diagnosticEvent("idle", "Idle"),
          ];
          const results: DeliveryResult[] = [];
          for (const [index, event] of events.entries()) {
            results.push(await transport.test(event));
            if (index < events.length - 1) await delay(diagnosticDelayMs);
          }
          context.ui.notify(diagnosticSummary(results));
          return;
        }
        const status = await transport.status();
        context.ui.notify(`AgentPet socket ${status.socket}; queued events: ${status.queueEntries}.`);
      } catch {
        context.ui.notify("AgentPet diagnostics unavailable.");
      }
    },
  });
}

export default installAgentPetExtension;
