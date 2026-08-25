# `@deepseek-ai/dsh-kb-daily`

English | [中文](README.zh.md)

Standalone DeepSeek Harness/Cordis plugin that scans a Markdown knowledge base and asks a dedicated agent to write a daily digest at `<reportDir>/YYYY-MM-DD.md`.

## Installation

Install the published package in the deployment that should use it; it is intentionally not mounted by the base bundle:

```sh
pnpm add @deepseek-ai/dsh-kb-daily
```

The host composition must provide the published `agents`, `tools`, `systemPrompt`, and `timer` services. Agent creation/resume is supplied by the host's agent factory. A session-persistence backend is optional: without one, resume falls back to creating a fresh agent.

```yaml
- name: '@deepseek-ai/dsh-kb-daily'
  config:
    vaultPath: /absolute/path/to/vault
    reportDir: Daily
    timeZone: Asia/Shanghai
    agentId: kb-daily
    provider: deepseek
    model: deepseek-chat
    writePolicy: ask
    checkIntervalMs: 3600000
```

## Configuration

| Field | Default | Meaning |
| --- | --- | --- |
| `vaultPath` | required | Absolute Markdown-vault directory. The plugin fails to load if it is missing, unreadable, or not a directory. |
| `reportDir` | `Daily` | Contained subdirectory for reports. |
| `timeZone` | system IANA zone | Zone used for the date key and local-day scan cutoff. |
| `agentId` | `kb-daily` | Stable session id for the dedicated agent. |
| `provider` | deployment-resolved | Optional agent provider route. |
| `model` | deployment-resolved | Optional agent model route. |
| `writePolicy` | `ask` | `ask` requests the host approval service; `allow` permits this plugin's write tool to proceed. |
| `checkIntervalMs` | `3600000` | Interval for day-rollover checks. |

## Runtime behavior

On load and on each interval, the plugin checks whether today's report already exists. If it does, no agent work is scheduled. Otherwise it resumes `agentId` when possible, falls back to `agents.create()` when persistence is unavailable, and queues one task turn. An in-flight and once-per-local-day guard prevents duplicate work. Runner failures are contained so the host timer remains usable; a failed same-day attempt is not retried until restart or the next local day.

The plugin registers three model tools:

- `kb_list_modified` recursively scans Markdown files below `vaultPath`, skips hidden/bookkeeping directories, and uses the configured timezone's local midnight as the cutoff.
- `kb_read` reads a vault-relative file with a UTF-8-safe 64 KiB cap. Lexical paths that escape the vault are rejected.
- `kb_write_report` derives the destination from the current configured local date and never accepts a model-supplied output path. It uses exclusive file creation, so an existing report is never overwritten.

`writePolicy: ask` returns the standard DSH `tools/pre-execute` ask decision. The host approval mechanism decides whether the write continues; if no approval channel is installed, the standard pipeline fails closed. The plugin does not write source notes or bypass host tool policy.

All prompt sections, tools, approval listeners, timers, and agent handles are owned by the plugin's Cordis effects. Unloading the plugin removes them and disposes agents created by the runner. Reloading the plugin starts a fresh lifecycle with the same configured session id.

## Development

```sh
pnpm install
pnpm run typecheck
pnpm run test
pnpm run build
pnpm pack --dry-run
```

The package uses published DeepSeek Harness and Cordis APIs only. Its peer dependencies are mirrored as development dependencies for local typechecking and tests; no `workspace:` dependency is required.
