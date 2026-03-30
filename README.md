# agent-tactics-system

`agent-tactics-system` is a TypeScript reference implementation for a turn-based
agent orchestration runtime. The repository now includes the first executable
slice of the v1 design: contracts, policy gates, canonical state handling,
verification rules, and focused tests around those boundaries.

## Current Implementation Scope

- Architecture document for the v1 operating model in `docs/architecture.md`
- JSON schemas for provider registration, assignment decisions, task envelopes,
  skill contracts, state patches, verification records, and heartbeat records
- TypeScript contract enums and types in `src/contracts`
- Assignment and browser skill policy gates in `src/policies`
- Provider registry and health primitives in `src/providers`
- Adapter-facing provider execution, repository I/O, and skill loading modules
- Turn queue, canonical state store, and promotion flow in `src/orchestrator`
- Programmatic executable runtime entrypoint in `src/runtime`
- Independent verification planning and replay helpers in `src/verifier`
- Vitest coverage for schemas, policies, orchestrator behavior, providers, and
  verification flows, including executable runtime wiring

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

## Verification

```bash
npm run typecheck
npm test
npm run test:coverage
```

Current expected result:

- `npm run typecheck` exits successfully
- `npm test` passes the full Vitest suite
- `npm run test:coverage` passes and enforces 100% lines/statements/functions/branches coverage
- Coverage output is available locally in `coverage/` and in CI as both a job summary snippet and the `coverage-report` artifact

## Continuous Integration

- GitHub Actions runs on every push and pull request via `.github/workflows/ci.yml`
- The workflow executes `npm ci`, `npm run typecheck`, and `npm run test:coverage`
- Coverage failures break the workflow because the Vitest coverage thresholds are set to 100% across all tracked metrics

Programmatic runtime entrypoint:

- `runExecutableRuntime(...)` wires `HeartbeatRecord`, `TaskEnvelope`,
  repo materialization, skill loading, provider execution, and verification
  handoff into a single executable flow.
- The fixture in `tests/runtime/executable-runtime.test.ts` replays
  task issuance -> state transition -> verification handoff end to end.

## Next Milestone

1. Add adapter-facing modules for provider execution, repository I/O, and skill
   loading so the current policy core can drive real runtimes.
2. Extend the programmatic runtime entrypoint into a CLI surface for local
   fixture replay and debugging.
3. Extend verification replay and failure recovery paths with richer evidence
   capture and rollback scenarios.
