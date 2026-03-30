# agent-tactics-system

`agent-tactics-system` is a TypeScript reference implementation for a turn-based
agent orchestration runtime. The repository now includes the first shared
executable slice of the v1 design: contracts, policy gates, canonical state
handling, verification rules, a reproducible runtime fixture CLI, and focused
tests around those boundaries.

## Current Implementation Scope

- Architecture document for the v1 operating model in `docs/architecture.md`
- JSON schemas for provider registration, assignment decisions, task envelopes,
  skill contracts, state patches, verification records, and heartbeat records
- TypeScript contract enums and types in `src/contracts`
- Assignment and browser skill policy gates in `src/policies`
- Provider registry and health primitives in `src/providers`
- Adapter-facing provider execution, repository I/O, and skill loading modules
- Turn queue, canonical state store, and promotion flow in `src/orchestrator`
- Programmatic and CLI-accessible executable runtime entrypoints in `src/runtime`
- Independent verification planning and replay helpers in `src/verifier`
- Vitest coverage for schemas, policies, orchestrator behavior, providers, and
  verification flows, including executable runtime wiring and fixture replay

## v1 Rules

- Canonical state is written through the system orchestrator path only.
- Agents do not communicate directly with each other.
- Execution is turn-based.
- Writes are serialized by default.
- Provider registration and task assignment are separate decisions.
- Completion requires independent verification evidence.
- Browser access is allowed only through explicit skill-policy exceptions.

## Repository Layout

```text
docs/
  architecture.md
schemas/
  *.schema.json
src/
  adapters/
  contracts/
  orchestrator/
  policies/
  providers/
  runtime/
  skills/
  verifier/
tests/
  adapters/
  contracts/
  orchestrator/
  policies/
  providers/
  runtime/
  verifier/
```

## Shared Runtime Entry Surface

Run the shared fixture entrypoint from the repository root:

```bash
npm run runtime:fixture
npm run runtime:fixture -- --scenario=failure
```

What the CLI fixes as the M1 seam:

- One command replays `adapters + runtime + skills + verifier handoff`
- Success artifacts land in `artifacts/runtime-fixtures/success/`
- Failure and rollback artifacts land in `artifacts/runtime-fixtures/failure/`
- Each run emits `run-result.json` plus a fixture workspace under `workspace/`
- Runtime execution writes `workspace/artifacts/runtime.log` on the success path
- Failure runs restore the workspace snapshot and record recovery state in
  `run-result.json`

The fixture is intentionally narrow. It proves the shared execution seam and
artifact contract for M2, without claiming production provider integration,
approval workflow wiring, or richer verification evidence.

## Verification

```bash
npm run runtime:fixture
npm run runtime:fixture -- --scenario=failure
npm run typecheck
npm test
npm run test:coverage
```

Current expected result:

- `npm run runtime:fixture` exits successfully and writes success artifacts to
  `artifacts/runtime-fixtures/success/`
- `npm run runtime:fixture -- --scenario=failure` exits successfully and writes
  rollback evidence to `artifacts/runtime-fixtures/failure/`
- `npm run typecheck` exits successfully
- `npm test` passes the full Vitest suite
- `npm run test:coverage` passes and enforces 100% lines/statements/functions/branches coverage
- Coverage output is available locally in `coverage/` and in CI as both a job summary snippet and the `coverage-report` artifact

## Continuous Integration

- GitHub Actions runs on every push and pull request via `.github/workflows/ci.yml`
- The workflow executes `npm ci`, `npm run typecheck`, and `npm run test:coverage`
- Coverage failures break the workflow because the Vitest coverage thresholds are set to 100% across all tracked metrics

Runtime entrypoints:

- `runExecutableRuntime(...)` wires `HeartbeatRecord`, `TaskEnvelope`,
  repo materialization, skill loading, provider execution, and verification
  handoff into a single executable flow.
- `npm run runtime:fixture` wraps the same flow in a shared CLI contract that
  leaves reproducible success or rollback artifacts on disk.
- The fixtures in `tests/runtime/executable-runtime.test.ts` and
  `tests/runtime/cli.test.ts` replay task issuance -> state transition ->
  verification handoff end to end.

## Next Milestone

1. Enrich verification evidence beyond the current summary and replay timeline so
   done-candidate promotion can depend on stronger M2 proof.
2. Harden rollback and requeue coverage around richer repo mutations and
   provider-side failure modes.
3. Replace the fixture provider with a real adapter handshake while preserving
   the shared artifact contract fixed in M1.
