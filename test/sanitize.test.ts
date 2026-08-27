import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyCommand,
  sanitizeFileBasename,
  sanitizeModel,
  sanitizeProject,
  sanitizeToolName,
  summarizeTool,
} from "../src/sanitize.js";

test("sanitizers retain only approved metadata", () => {
  assert.equal(sanitizeProject("/private/work/demo-app"), "demo-app");
  assert.equal(sanitizeFileBasename("/private/work/src/index.ts"), "index.ts");
  assert.equal(sanitizeModel("anthropic/claude-3-7-sonnet"), "anthropic/claude-3-7-sonnet");
  assert.equal(classifyCommand("git status --short"), "version-control");
  assert.equal(classifyCommand("npm test -- --secret=hidden"), "test");
  assert.deepEqual(summarizeTool("bash", { command: "curl https://example.test/?token=secret" }), {
    toolName: "bash",
    interactive: false,
    summary: "Command: shell",
  });
});

test("balanced tool summaries retain safe names without arbitrary argument leakage", () => {
  const prompt = "please send sk-live-123 and https://host.test/private?token=secret";
  assert.equal(sanitizeProject(`/${prompt}`), undefined);
  assert.equal(sanitizeFileBasename(`/${prompt}`), undefined);
  assert.equal(sanitizeFileBasename("/private/sk-live-123456789"), undefined);
  assert.equal(sanitizeModel("https://host.test/model?key=secret"), undefined);
  assert.equal(sanitizeProject("https:/host.test/private"), undefined);
  assert.equal(sanitizeFileBasename("https:/host.test/private"), undefined);
  const activity = summarizeTool("custom_tool", { query: prompt, payload: { password: "hidden" } });
  assert.deepEqual(activity, { toolName: "custom_tool", interactive: false, summary: "Using custom_tool" });
  assert.doesNotMatch(JSON.stringify(activity), /sk-live|host\.test|token=|password|hidden|private/);
  assert.deepEqual(summarizeTool("subagent", { action: "status", task: prompt }), {
    toolName: "subagent",
    interactive: false,
    summary: "subagent: status",
  });
  assert.deepEqual(summarizeTool("web_search", { query: prompt }), {
    toolName: "web_search",
    interactive: false,
    summary: "Using web_search",
  });
  assert.deepEqual(summarizeTool("read", { path: "/private/work/src/config.ts" }), {
    toolName: "read",
    interactive: false,
    summary: "read: config.ts",
  });
  assert.deepEqual(summarizeTool("custom_tool", { path: "/tmp/prompt-as-filename", action: "exfiltrate" }), {
    toolName: "custom_tool",
    interactive: false,
    summary: "Using custom_tool",
  });
  for (const spoofedName of ["READ", "Todo", "BASH"]) {
    assert.deepEqual(
      summarizeTool(spoofedName, { path: "/tmp/customer-export.csv", action: "update", command: prompt }),
      { toolName: spoofedName, interactive: false, summary: `Using ${spoofedName}` },
    );
  }
  assert.deepEqual(summarizeTool("todo", { action: "update", description: prompt }), {
    toolName: "todo",
    interactive: false,
    summary: "todo: update",
  });
  assert.deepEqual(summarizeTool("todo", { action: "password", description: prompt }), {
    toolName: "todo",
    interactive: false,
    summary: "Using todo",
  });
});

test("sanitizers reject common credential formats and malformed model identifiers", () => {
  for (const token of [
    "ghp_abcdefghijklmnopqrstuvwxyz1234567890",
    "github_pat_abcdefghijklmnopqrstuvwxyz_1234567890",
    "glpat-abcdefghijklmnopqrstuvwxyz1234567890",
    "hf_abcdefghijklmnopqrstuvwxyz1234567890",
    "npm_abcdefghijklmnopqrstuvwxyz1234567890",
    "xoxb-1234567890-abcdefghij",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signaturevalue",
    "AIzaabcdefghijklmnopqrstuvwxyz123456789",
  ]) {
    assert.equal(sanitizeProject(`/work/${token}`), undefined, token);
    assert.equal(sanitizeFileBasename(`/work/${token}`), undefined, token);
    assert.equal(sanitizeModel(token), undefined, token);
    assert.equal(sanitizeFileBasename(`/work/backup_${token}_copy`), undefined, `embedded ${token}`);
    assert.equal(sanitizeToolName(`prefix_${token}_suffix`), "tool", `embedded ${token}`);
  }
  assert.equal(sanitizeModel("provider/model"), "provider/model");
  assert.equal(sanitizeModel("provider/model/extra"), undefined);
  assert.equal(sanitizeModel("provider:model"), undefined);
  assert.equal(sanitizeToolName("tool name with spaces"), "tool");
  assert.equal(sanitizeToolName("https://host.test/tool"), "tool");
  assert.equal(sanitizeToolName("password"), "tool");
  assert.equal(sanitizeToolName("sk-abcdefgh12345678"), "tool");
});

test("interactive tools become waiting without retaining the question", () => {
  assert.deepEqual(summarizeTool("ask_user_question", { question: "What is your API key?" }), {
    toolName: "ask_user_question",
    interactive: true,
    summary: "Waiting for input",
  });
});
