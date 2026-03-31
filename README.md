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

What the CLI now fixes as the M2 verification seam:

- One command replays `adapters + runtime + skills + verifier handoff`
- Success artifacts land in `artifacts/runtime-fixtures/success/`
- Failure and rollback artifacts land in `artifacts/runtime-fixtures/failure/`
- Each run emits `run-result.json` plus a fixture workspace under `workspace/`
- Runtime execution writes `workspace/artifacts/runtime.log` on the success path
- `run-result.json` records the `verification_handoff.contract_version`, required
  validation commands, artifact references, and promotion-gate status
- Failure runs restore the workspace snapshot and record rollback, restore, and
  requeue steps as assertion-friendly recovery contract data in `run-result.json`

The fixture is intentionally narrow. It proves the shared execution seam and the
extended M4 artifact contract for verification evidence, rollback handling, and
a minimum approval gate, without claiming production provider integration or a
fully embedded human approval workflow.

## M3 Single Operational Flow

The repository root now exposes one repeatable operator flow for a single
workspace runtime run:

```bash
npm run runtime:fixture
npm run runtime:fixture -- --scenario=failure
```

Use the flow like this:

1. Start from the repository root and run one of the commands above.
2. Open `artifacts/runtime-fixtures/<scenario>/run-result.json`.
3. Read `operator_summary.decision`, `operator_summary.next_action`, and
   `verification_evidence.promotion_gate`.
4. Inspect the paths in `operator_summary.key_paths`.
5. Confirm `verification_handoff.governance.approval_gate`,
   `verification_handoff.governance.authorization_boundary`, and
   `verification_handoff.governance.input_defense`.
6. Run the validation commands listed in
   `verification_handoff.evidence.commands`.

Success path:

- `heartbeat.outcome` is `patched`
- `verification_evidence.promotion_gate` is
  `waiting_for_human_approval_and_independent_verifier`
- `verification_handoff.governance.approval_gate.status` is
  `pending_human_approval`
- `verification_handoff.governance.authorization_boundary.exception` records
  the permission error that keeps promotion closed without approval
- `verification_handoff.governance.input_defense` marks the external note input
  as `untrusted_external_input`
- `workspace/artifacts/runtime.log` exists and captures the executed objective
- `run-result.json#verification_handoff.replay` shows the verification replay
  history that must be reviewed before promotion

Failure path:

- `heartbeat.outcome` is `blocked`
- `verification_evidence.promotion_gate` is
  `rollback_and_requeue_recorded`
- `run-result.json#verification_handoff.recovery.steps` records `repo_restore`,
  `state_rollback`, and `issue_requeue`
- `verification_handoff.evidence.missing_artifacts` tells the operator which
  expected artifacts were not preserved after rollback

This M3 slice fixes one end-to-end operational reference: assignment enters the
runtime through a heartbeat record, state transitions are written into the
summary snapshot, verification handoff is recorded in the same artifact, and
success or rollback leaves a reproducible next-action summary for the operator.

## M4 Minimum Approval Gate

The same fixture now demonstrates one approval-gated promotion path for the v1
reference implementation:

- Success runs stop at `done_candidate` and record a human approval gate before
  promotion to `complete`
- `run-result.json#verification_handoff.governance.approval_gate` is the audit
  trail for the approval requirement and expected approval artifact path
- `run-result.json#verification_handoff.governance.authorization_boundary`
  records the permission exception raised when promotion is attempted without
  `approval:grant`
- `run-result.json#verification_handoff.governance.input_defense` shows which
  inputs are trusted workspace data versus untrusted external data

This is intentionally a minimum gate, not a full approval product surface. The
goal is to make promotion control, authorization failure, and external-input
defense visible in one reproducible runtime artifact.

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
- `run-result.json` exposes promotion-gate evidence for both the verifier and a
  human approval gate, plus a rollback/requeue contract that tests can assert
  directly
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

1. Replace the fixture provider with a real adapter handshake while preserving
   the shared M2 artifact contract.
2. Extend recovery coverage to multi-file repo mutations and provider-side
   partial writes.
3. Replace the minimum approval artifact with a first-class approval workflow
   handoff once a real control-plane integration is in scope.
