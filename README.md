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
- Turn queue, canonical state store, and promotion flow in `src/orchestrator`
- Independent verification planning and replay helpers in `src/verifier`
- Vitest coverage for schemas, policies, orchestrator behavior, providers, and
  verification flows

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
  contracts/
  orchestrator/
  policies/
  providers/
  verifier/
tests/
  contracts/
  orchestrator/
  policies/
  providers/
  verifier/
```

## Verification

```bash
npm run typecheck
npm test
```

Current expected result:

- `npm run typecheck` exits successfully
- `npm test` passes 6 test files / 33 tests

## Next Milestone

1. Add adapter-facing modules for provider execution, repository I/O, and skill
   loading so the current policy core can drive real runtimes.
2. Connect heartbeat records and task envelopes to a runnable orchestrator entry
   point instead of testing the core modules in isolation.
3. Extend verification replay and failure recovery paths with richer evidence
   capture and rollback scenarios.
