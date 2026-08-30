# SDD ledger — plan: docs/superpowers/plans/2026-08-29-kb-daily-product-optimization-roadmap.md

## Setup

- Execution mode: Subagent-Driven Development.
- Workspace: sandbox prevented the first worktree attempt; a second attempt with approved escalation created `codex/kb-daily-product-optimization` at `.worktrees/codex-kb-daily-product-optimization`.
- Baseline commit: `9809f10`.
- Baseline verification: `pnpm install --frozen-lockfile` completed; `pnpm run test` reproduced the existing 31/33 result, with only the two current-date assertions in `tests/tools.spec.ts` failing.
- Script note: the bundled `sdd-workspace` Bash helper could not run under the Windows Bash stub, so this ledger is maintained at the exact helper-defined path and task briefs/review packages will use equivalent PowerShell extraction when necessary.

## Preflight scan

| Item | Shared files/interfaces | Finding | Ruling |
| --- | --- | --- | --- |
| Task 1 → Task 2 | `package.json`, README; `ToolsConfig` not shared | Task 1 establishes the package identity/install contract; Task 2 changes runtime determinism and security. No interface conflict. | Preserve the repository's community remote and adopt `@ly028716/dsh-kb-daily` as the release identity; the current `@deepseek-ai` metadata is inconsistent with the remote and community-plugin intent. Cost if wrong: package metadata and install docs need a later rename. |
| Task 1 → Task 3 | `package.json` | Task 3 adds scripts/dev tooling after Task 1 changes metadata. | Task 1 owns package identity and bundle metadata; Task 3 owns only additional verification scripts/dependencies. |
| Task 2 → Task 4 | `src/tools.ts`, `src/fs.ts`, tests | Task 4 adds budgets on top of Task 2's clock/path/size behavior. | Task 2 must expose stable helper seams; Task 4 extends them without changing existing result semantics. |
| Task 2 → Task 5 | `src/tools.ts`, `tests/tools.spec.ts` | Task 5 changes report structure but consumes Task 2's deterministic clock and bounded writes. | Preserve the `ToolsConfig.now` seam and write safety while adding report metadata. |
| Task 4 → Task 5 | `src/tools.ts`, `src/prompt.ts` | Both affect report input/output shape. | Task 4 owns scan budget fields; Task 5 owns report content guidance and metadata. |
| Task 5 → Task 6 | `src/tools.ts`, `src/prompt.ts` | Task 6 adds optional Git diff context. | Diff remains optional and must not change the baseline report contract when unavailable. |
| Task 7 → Task 8 | `src/index.ts`, `src/runner.ts`, tests | Task 8 adds logging around Task 7 control/status behavior. | Task 7 defines runner control/status; Task 8 consumes those interfaces and must not duplicate state. |
| Task 8 → Task 9 | `src/index.ts`, `src/runner.ts`, README | Task 9 expands lifecycle state to multiple vaults. | Multi-vault work remains opt-in and reuses the single-vault status/error contract. |
| Task 9 → Task 10 | `src/runner.ts`, `src/tools.ts` | Task 10 adds explicit date-range work over multi-vault-capable runner primitives. | Backfill is explicit, bounded, and never part of the default startup path. |
| Task 1 | package files, manifest, smoke prerequisites | Self-consistent: package identity, bundle manifest, license, exports and tests are specified together. | Include the pre-existing roadmap document in the first implementation commit so it is not lost. |
| Task 2 | date/path/fs/tools tests and implementation | Self-consistent: fixed clocks, symlink checks and report size are specified with matching interfaces. | Use the exact 512 KiB limit and preserve `wx`. |
| Task 3 | smoke script, packed export test, CI and verify script | Self-consistent: the smoke script is the proving command for the bundle manifest. | Do not require a real LLM or approval UI in smoke. |
| Task 4 | budget config, list result, tests and docs | Self-consistent: returned truncation is explicit. | Prefer stable error/result shapes over silent omission. |
| Task 5 | report format, prompt and tests | Self-consistent: metadata is deterministic and source paths remain relative. | Do not require model-specific prose assertions. |
| Task 6 | optional Git adapter and tests | Self-consistent: unavailable Git is non-fatal. | Keep Git support outside the P1 baseline if it threatens the core path. |
| Task 7 | control/status lifecycle | Self-consistent: automatic dedupe and explicit retry are distinct. | Do not let retry bypass report existence or write policy. |
| Task 8 | logging and notifications | Self-consistent: logs are structured and sanitized. | Notification is optional and cannot become a required peer service. |
| Task 9 | multi-vault configuration and lifecycle | Self-consistent: each vault owns independent runner identity. | Do not expand defaults until single-vault behavior remains stable. |
| Task 10 | bounded backfill | Self-consistent: explicit range, max span and no overwrite. | Keep it opt-in and independently testable. |

## Rulings

- Ruling: adopt `@ly028716/dsh-kb-daily` and the `ly028716/dsh-kb-daily` community repository identity — the checked-out repository's `origin` already points there, while the existing package metadata points at the official DeepSeek namespace. Cost if wrong: metadata and install commands require a later coordinated rename.
- Ruling: proceed in the current checkout only after the escalated worktree creation succeeded — the sandbox denied the first isolated-worktree operation, but the approved elevated retry produced the requested isolated branch. Cost if wrong: local branch state may need cleanup before handoff.

## Task 1

- Implementer commit: `a93aa62`.
- Fix-round commit: `4fa22d0`.
- Review: first pass found a test coverage gap; fix-round review returned CLEAN. The package identity concern was resolved by the existing identity ruling above and documented in both READMEs.
- Verification: focused package contract tests 3/3, typecheck, build, and clean temporary-directory pack dry-run passed.

## Task 2

- Implementer commit: `467d2d1`.
- Review: CLEAN; no blocking findings. Non-blocking note: list-modified default-date boundary is covered by the shared clock seam but not a separate assertion.
- Verification: focused 23/23, full 42/42, typecheck, build, and diff check passed.

## Task 3

- Implementer commit: `199f334`.
- Fix-round commit: `08e9fe1`.
- Review: first pass found CI config parsing was local-only and the public invariant entrypoint retained the old package identifier; fix-round review returned CLEAN.
- Verification: `config:parse`, packed tests, frozen install, and `pnpm run verify` passed; final Task 3 run reported 10 files/43 tests passing.

## Task 4

- Implementer: controller fallback after subagent quota exhaustion; no subagent was available.
- Commit: `c58ec77`.
- Verification: focused tests passed on retry with 21/21; full runtime tests 45/45; typecheck, build, pack inspection, and smoke verification passed.
- Scope review: budget configuration, explicit list metadata, stable bounded selection, prompt disclosure, and bilingual docs only; no Task 5 frontmatter implementation.

## Task 5

- Implementer: controller fallback after subagent quota exhaustion; no subagent was available.
- Commit: `4f3125f`.
- Verification: focused prompt/tools/packed tests 8/8, typecheck, and build passed.
- Scope review: stable frontmatter/section/path guidance and bilingual docs; no Git diff or runner control changes.

## Task 6

- Implementer: controller fallback after subagent quota exhaustion; no subagent was available.
- Commit: `445f22b`.
- Verification: Git diff tests 3 cases/8 assertions, typecheck, build, and prior plugin/prompt suites passed; diff-overflow hang was fixed by active child-process termination.
- Scope review: optional bounded Git context only; non-Git, no-history, binary, oversized, and path-escape cases remain non-fatal/stable.

## Task 7

- Implementer: controller fallback after subagent quota exhaustion; no subagent was available.
- Commit: `504b0cd`.
- Verification: runner/plugin tests 10/10, typecheck, and build passed.
- Scope review: added `RunnerControl`, status states, explicit retry, narrowed resume fallback, and preserved automatic dedupe/timer/handle cleanup.

## Task 8

- Implementer: controller fallback after subagent quota exhaustion; no subagent was available.
- Commit: `ab67c63`.
- Verification: runtime full tests 51/51, typecheck, build, and diff check passed.
- Scope review: fixed lifecycle events, redacted metadata, optional notification duck-typing, approval-required logging, and non-blocking error isolation.

## Task 9

- Status: implemented as explicit opt-in multi-vault configuration.
- Contract: legacy single-vault fields remain compatible; multi-vault uses `vaults[]` entries with stable `id`, required `vaultPath` and `agentId`, per-vault report directory/time zone/policy/budgets, and no implicit directory discovery.
- Conflict rules: duplicate vault ids and agent ids, mixed legacy plus multi-vault fields, invalid ids, and identical/nested/overlapping vault paths are rejected before registration.
- Isolation: each entry owns its namespaced tools (`kb_<id>_*`), prompt section, approval listener, timer, and runner lifecycle; report writes remain scoped to that vault.
- Verification: focused plugin/approval tests 10/10, full runtime tests 54/54, typecheck, build, and pack inspection 2/2 passed.
- Commit: pending final Task 9 commit.

## Task 10

- Status: deferred as P3 product work; no implementation started.
- Ruling: keep historical backfill opt-in and out of the stable default until task-cost limits, date-range semantics, and user demand are validated. Cost if wrong: a future P3 change will need explicit bounded scheduling and recovery tests.

## Final verification snapshot

- Passed: `pnpm run typecheck`, `pnpm run test` (11 files/51 tests), `pnpm run build`, and `pnpm run pack:inspect` (2/2).
- Blocked: `pnpm run smoke:dsh` and therefore the aggregate `pnpm run verify` release gate. On the current Windows host, DeepSeek Harness `0.1.0-rc.8` hangs while preparing the temporary profile after `plugin add` when `--dump-config` is invoked. This is an environment/CLI profile-healing issue, not a failing package assertion; the smoke script was restored after diagnosis and no timeout workaround was retained.
- Final implementation scope: Tasks 1–9 delivered; Task 10 remains intentionally deferred P3 work.

## CI follow-up

- The blocking CI gate is now `pnpm run verify:core` (typecheck, runtime tests, build, and packed artifact inspection).
- The real DSH smoke test is a manual-dispatch-only job with a five-minute job timeout and `continue-on-error: true`; it no longer makes push/PR checks fail while the Windows/DSH profile initialization issue remains unresolved.
