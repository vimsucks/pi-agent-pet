# Pi AgentPet Extension Plan

## Goal

Build a production-ready Pi package that reports rich, privacy-aware Pi activity to AgentPet over its native Unix-domain socket protocol.

## Scope

- Package installation with `pi install git:github.com/vimsucks/pi-agent-pet`.
- AgentPet-compatible newline-delimited JSON events with `agentKind: "pi"`.
- Lifecycle states based on `session_start`, `agent_start`, `agent_settled`, and `session_shutdown`.
- Streaming phases for thinking, writing, and tool preparation without forwarding model output.
- Parallel tool aggregation, interactive-tool waiting states, tool failure recovery, model metadata, and token counts.
- Sanitized activity summaries: project basename, tool name, file basename, and command category only.
- No prompts, model output, file contents, complete paths, command text, tool output, URLs, secrets, transcript paths, or focus URLs.
- Direct Unix socket transport with bounded timeout and a size-bounded offline queue compatible with AgentPet.
- `/agent-pet status` and `/agent-pet test` diagnostics.

## Architecture

- `extensions/agent-pet.ts`: Pi event wiring and commands.
- `src/reporter.ts`: session state machine and event aggregation.
- `src/sanitize.ts`: strict allowlist-based activity summarization.
- `src/transport.ts`: AgentPet JSONL socket and offline queue transport.
- `src/config.ts`: environment-based local configuration.
- `test/`: sanitizer, reporter, transport, and extension integration tests.

## State Mapping

| Pi event | AgentPet state/activity |
| --- | --- |
| `session_start` | `registered` |
| `agent_start` | `working` / Thinking |
| thinking stream | `working` / Thinking |
| text stream | `working` / Writing response |
| normal tool start/end | `working` / sanitized tool summary |
| interactive tool start | `waiting` / Waiting for input |
| tool error | `working` / recovering, with error count |
| compaction | `working` / Compacting context |
| `agent_settled` | `done`, with token/error summary |
| `session_shutdown` | `idle` |

`agent_end` is intentionally not treated as done because Pi may still retry, compact, or process queued continuations.

## Validation

1. `npm test`
2. `npm run typecheck`
3. Install the local package into Pi and run `/reload`.
4. Run `/agent-pet status` and `/agent-pet test` against the local AgentPet socket.
5. Verify Huhu reacts to registered, working, waiting, done, and idle states.
6. Review the final diff for correctness, privacy, failure isolation, and package documentation.