import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { sanitizeModel, sanitizeProject, sanitizeSessionName, summarizeTool } from "./sanitize.js";
import type { AgentPetEvent, AgentPetEventName } from "./transport.js";

export interface EventSink {
  send(event: AgentPetEvent): Promise<void>;
}

export interface ReporterOptions {
  sessionId?: string;
  project?: string;
  now?: () => number;
}

interface ActiveTool {
  interactive: boolean;
  toolName: string;
  summary: string;
}

export class AgentPetReporter {
  private readonly sessionId: string;
  private project?: string;
  private readonly now: () => number;
  private readonly activeTools = new Map<string, ActiveTool>();
  private tail: Promise<void> = Promise.resolve();
  private lastStreamingSignature?: string;
  private model?: string;
  private errors = 0;
  private tokens = 0;
  private lastActivity?: {
    eventName: AgentPetEventName;
    message: string;
    toolName?: string;
    toolSummary?: string;
  };

  public constructor(private readonly sink: EventSink, options: ReporterOptions = {}) {
    this.sessionId = options.sessionId || randomUUID();
    const project = options.project || basename(process.cwd());
    this.project = sanitizeSessionName(project) || sanitizeProject(project);
    this.now = options.now || (() => Math.floor(Date.now() / 1000));
  }

  public registered(): Promise<void> { return this.emit("registered", "Connected"); }
  public agentStarted(): Promise<void> { return this.emit("working", "Thinking", undefined, undefined, true); }
  public thinking(): Promise<void> { return this.emit("working", "Thinking", undefined, undefined, true); }
  public writing(): Promise<void> { return this.emit("working", "Writing response", undefined, undefined, true); }
  public preparingTool(): Promise<void> { return this.emit("working", "Preparing tool", undefined, undefined, true); }
  public compacting(): Promise<void> { return this.emit("working", "Compacting context"); }
  public compactFailed(): Promise<void> {
    this.errors += 1;
    return this.emit("working", `Recovering (${this.errors} ${this.errors === 1 ? "error" : "errors"})`);
  }
  public idle(): Promise<void> {
    this.activeTools.clear();
    return this.emit("idle", "Idle");
  }

  public selectedModel(value: unknown): void {
    this.model = sanitizeModel(value);
  }

  public projectChanged(value: unknown): Promise<void> {
    const project = sanitizeSessionName(value) || sanitizeProject(value);
    if (project === this.project) return this.tail;
    this.project = project;
    if (!this.lastActivity) return this.tail;
    return this.emit(
      this.lastActivity.eventName,
      this.lastActivity.message,
      this.lastActivity.toolName,
      this.lastActivity.toolSummary,
    );
  }

  public updatedUsage(tokenCount: unknown): void {
    if (typeof tokenCount === "number" && Number.isSafeInteger(tokenCount) && tokenCount >= 0) {
      this.tokens = tokenCount;
    }
  }

  public toolStarted(toolCallId: unknown, toolName: unknown, input: unknown): Promise<void> {
    const id = typeof toolCallId === "string" && toolCallId ? toolCallId : randomUUID();
    const activity = summarizeTool(toolName, input);
    this.activeTools.set(id, activity);
    return this.emit(activity.interactive ? "waiting" : "working", activity.summary, activity.toolName, activity.summary);
  }

  public toolEnded(toolCallId: unknown, toolName: unknown, input: unknown, failed: unknown): Promise<void> {
    const id = typeof toolCallId === "string" ? toolCallId : "";
    const completed = this.activeTools.get(id);
    this.activeTools.delete(id);
    if (failed === true) {
      this.errors += 1;
      return this.activeTools.size > 0
        ? this.emitActiveTools()
        : this.emit("working", `Recovering (${this.errors} ${this.errors === 1 ? "error" : "errors"})`);
    }
    if (this.activeTools.size > 0) return this.emitActiveTools();
    const activity = completed || summarizeTool(toolName, input);
    return this.emit("working", `Finished ${activity.toolName}`, activity.toolName, activity.summary);
  }

  public settled(tokenCount: unknown): Promise<void> {
    this.updatedUsage(tokenCount);
    this.activeTools.clear();
    const details = [`${this.tokens} tokens`, `${this.errors} ${this.errors === 1 ? "error" : "errors"}`];
    return this.emit("done", `Completed (${details.join(", ")})`);
  }

  private emitActiveTools(): Promise<void> {
    const waiting = [...this.activeTools.values()].some((tool) => tool.interactive);
    return this.emit(waiting ? "waiting" : "working", waiting ? "Waiting for input" : `Running ${this.activeTools.size} tools`);
  }

  private emit(eventName: AgentPetEventName, message: string, toolName?: string, toolSummary?: string, streaming = false): Promise<void> {
    this.lastActivity = { eventName, message, toolName, toolSummary };
    const event: AgentPetEvent = {
      sessionId: this.sessionId,
      agentKind: "pi",
      eventName,
      timestamp: this.now(),
    };
    if (this.project) event.project = this.project;
    if (this.model) event.model = this.model;
    if (message) event.message = message;
    if (toolName) event.toolName = toolName;
    if (toolSummary) event.toolSummary = toolSummary;

    const signature = JSON.stringify({
      eventName: event.eventName,
      project: event.project,
      model: event.model,
      message: event.message,
      toolName: event.toolName,
      toolSummary: event.toolSummary,
    });
    if (streaming && signature === this.lastStreamingSignature) return this.tail;
    this.lastStreamingSignature = streaming ? signature : undefined;

    const result = this.tail.then(() => this.sink.send(event));
    this.tail = result.catch(() => undefined);
    return this.tail;
  }
}
