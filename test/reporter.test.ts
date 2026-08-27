import assert from "node:assert/strict";
import test from "node:test";
import { AgentPetReporter } from "../src/reporter.js";
import type { AgentPetEvent } from "../src/transport.js";

class MemorySink {
  public readonly events: AgentPetEvent[] = [];
  public async send(event: AgentPetEvent): Promise<void> { this.events.push(event); }
}

test("reporter maps settled, not agent end, to done and aggregates parallel tools", async () => {
  const sink = new MemorySink();
  const reporter = new AgentPetReporter(sink, { sessionId: "session-1", project: "/work/demo", now: () => 123 });
  await reporter.registered();
  reporter.selectedModel("provider/model-1");
  await reporter.agentStarted();
  await reporter.toolStarted("one", "read", { path: "/private/a.ts" });
  await reporter.toolStarted("two", "bash", { command: "git status --short /private/secret" });
  await reporter.toolEnded("one", "read", { path: "/private/a.ts" }, false);
  await reporter.toolEnded("two", "bash", { command: "git status" }, false);
  await reporter.settled(42);

  assert.equal(sink.events[0].eventName, "registered");
  assert.equal(sink.events.at(-1)?.eventName, "done");
  assert.match(sink.events.at(-1)?.message || "", /42 tokens, 0 errors/);
  assert.equal(sink.events.find((event) => event.message === "Running 1 tools")?.eventName, "working");
  const serialized = JSON.stringify(sink.events);
  assert.doesNotMatch(serialized, /private\/secret|git status|\/work\/demo/);
  assert.match(serialized, /demo/);
  assert.match(serialized, /provider\/model-1/);
});

test("reporter emits stream phases once per full state signature and preserves sink order", async () => {
  const events: AgentPetEvent[] = [];
  let releaseFirst: (() => void) | undefined;
  const firstPending = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let sends = 0;
  const reporter = new AgentPetReporter({
    send: async (event) => {
      sends += 1;
      if (sends === 1) await firstPending;
      events.push(event);
    },
  }, { sessionId: "session-order", project: "demo", now: () => 1 });

  const registered = reporter.registered();
  const firstThinking = reporter.thinking();
  const duplicateThinking = reporter.thinking();
  const writing = reporter.writing();
  releaseFirst?.();
  await Promise.all([registered, firstThinking, duplicateThinking, writing]);

  assert.deepEqual(events.map((event) => event.message), ["Connected", "Thinking", "Writing response"]);
});

test("tool failures aggregate remaining active tools and settled clears them", async () => {
  const sink = new MemorySink();
  const reporter = new AgentPetReporter(sink, { sessionId: "session-2", project: "demo", now: () => 1 });
  await reporter.toolStarted("normal", "read", { path: "safe.ts" });
  await reporter.toolStarted("input", "interview", { question: "Share the production password" });
  await reporter.toolEnded("normal", "read", {}, true);
  assert.equal(sink.events.at(-1)?.eventName, "waiting");
  assert.equal(sink.events.at(-1)?.message, "Waiting for input");
  await reporter.settled(0);
  await reporter.toolEnded("input", "interview", {}, true);

  assert.equal(sink.events.at(-2)?.eventName, "done");
  assert.match(sink.events.at(-1)?.message || "", /Recovering \(2 errors\)/);
  assert.doesNotMatch(JSON.stringify(sink.events), /password|production/);
});
