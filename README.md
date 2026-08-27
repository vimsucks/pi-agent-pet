# Pi AgentPet

A dependency-free Pi extension that reports privacy-filtered activity to AgentPet 1.15 over its local Unix socket. It sends JSONL events with `agentKind: "pi"` and never blocks Pi when AgentPet is unavailable.

## Install

```sh
pi install git:github.com/vimsucks/pi-agent-pet
```

Restart Pi or run `/reload`. `/agent-pet status` probes the configured socket and reports whether it is reachable plus the number of fallback events queued. `/agent-pet test` sends an observable `registered`, `working`, `waiting`, `done`, `idle` diagnostic sequence, pausing about 400 ms between states so AgentPet can render each one, and reports each delivery result as `socket`, `queued`, or `failed`.

### Existing AgentPet extension conflict

AgentPet may already have its built-in Pi integration enabled or have installed `~/.pi/agent/extensions/agentpet.ts`. In AgentPet Settings, disconnect the built-in Pi integration first. Then remove the standalone file before installing this package, so two extensions do not report duplicate activity:

```sh
rm -f ~/.pi/agent/extensions/agentpet.ts
pi install git:github.com/vimsucks/pi-agent-pet
```

To uninstall this package, disconnect the built-in Pi integration in AgentPet Settings first, then remove the package source and reload Pi:

```sh
pi remove git:github.com/vimsucks/pi-agent-pet
```

Do not restore the old standalone extension unless it is the reporter you intend to use.

## Privacy

This extension is deliberately lossy. The event payload is restricted to the protocol fields below and is newline-delimited JSON sent to `~/.agentpet/agentpet.sock`.

| Field | Allowed value |
| --- | --- |
| `sessionId` | Random extension session UUID |
| `agentKind` | Always `pi` |
| `eventName` | `registered`, `working`, `waiting`, `done`, or `idle` |
| `project` | Sanitized Pi session name, falling back to the project basename |
| `model` | Validated model id only |
| `toolName` | Real tool identifier after strict format and secret-pattern validation |
| `toolSummary` | Tool name, filename basename, safe action, or command category only |
| `message` | Fixed safe activity text and integer token/error counts |
| `timestamp` | Unix seconds |

The `project` label follows Pi's display name set by `--name`, `/name`, RPC, or another extension. Renaming is reflected immediately; clearing the name or using a value that fails the privacy filter restores the working-directory basename.

It never forwards prompts, assistant output, file contents, full paths, command text, command output, queries, URLs, secrets, transcript paths, or terminal focus URLs. Session names are limited to 80 characters of ordinary letters, numbers, spaces, and safe punctuation, and are rejected when they contain URLs, credential signatures, control characters, or private value assignments. Safe tool identifiers such as `subagent` and `web_search` remain visible, but arbitrary tool arguments never do. File basenames and actions are extracted only for known file and control tools; unknown tools cannot opt into argument extraction by imitating field names. Invalid identifiers and names matching secret patterns are reduced to `tool`; shell commands are reduced to one of `build`, `filesystem`, `package-manager`, `process`, `test`, `version-control`, or `shell`.

When direct delivery fails, the same LF-terminated JSON is written atomically to `~/.agentpet/queue/` with `0600` permissions. The queue is capped to avoid unbounded disk usage, uses a current-user-owned non-symlink `0700` directory, and is never reported as queued when that write fails. Reporting errors, socket timeouts, queue errors, and all Pi hooks are fail-open.

## State Mapping

| Pi activity | AgentPet event | Huhu animation |
| --- | --- | --- |
| `session_start` | `registered` | Greeting / connected |
| `agent_start`, thinking stream | `working` | Thinking |
| Text stream | `working` | Writing response |
| Normal tool execution | `working` | Working |
| `ask_user_question`, `question`, `interview` | `waiting` | Waiting for input |
| Tool failure or compaction | `working` | Recovering / compacting |
| `agent_settled` | `done` | Completed |
| `session_shutdown` | `idle` | Resting |

`agent_end` intentionally does not produce `done`: Pi can still retry, compact context, or run queued continuations. Parallel tools are tracked by `toolCallId`; the extension stays active until all tracked calls finish.

### Huhu animation mapping

Huhu uses the Codex V2 8x11 atlas. In **AgentPet Settings -> Pet -> Map animations**, use these rows:

| AgentPet state | Huhu row |
| --- | --- |
| Idle | `0` idle |
| Working | `7` running |
| Waiting | `6` waiting |
| Done | `3` waving |
| Celebrate | `4` jumping |
| Sleepy | `0` idle |
| Level up | `4` jumping |

Rows `1-2` are directional movement. Rows `9-10` are Codex pointer-look directions; AgentPet loads them as clips but does not currently steer Huhu's gaze from the pointer.

## Configuration

All configuration is optional and local to the Pi process.

| Variable | Default | Purpose |
| --- | --- | --- |
| `AGENTPET_SOCKET_PATH` | `~/.agentpet/agentpet.sock` | AgentPet Unix stream socket |
| `AGENTPET_QUEUE_DIR` | `~/.agentpet/queue` | Offline JSONL queue directory |
| `AGENTPET_TIMEOUT_MS` | `350` | Per-event socket timeout in milliseconds |
| `AGENTPET_QUEUE_MAX_ENTRIES` | `100` | Maximum queued event files |

## Development

```sh
npm install
npm test
npm run typecheck
```

The package has no runtime third-party dependencies. Tests use the Node test runner through `tsx` and cover sanitization leaks, state aggregation, socket JSONL delivery, offline queue permissions/capacity, and extension registration.

The package declares Pi as a peer because Pi provides its extension API at runtime. The repository-level `.npmrc` prevents npm from downloading a second private copy of Pi when this Git package is installed.
