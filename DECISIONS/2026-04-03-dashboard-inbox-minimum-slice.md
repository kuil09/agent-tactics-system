# Decision Record: operator dashboard minimum inbox slice

- Date: 2026-04-03
- Owner: Founding Engineer
- Related issue: [NIT-85](/NIT/issues/NIT-85)

## Context

[NIT-85](/NIT/issues/NIT-85) asks for a working dashboard with a goal of main-branch
integration and deployment. The repository already contained two operator-facing
HTML renderers:

- `src/control-plane/issue-workbench.ts`
- `src/control-plane/approval-workbench.ts`

What was still missing was the inbox-level dashboard surface that lets an operator
see which issues require attention before opening either detailed workbench.

## Hypotheses

1. H1: The smallest useful dashboard slice is an inbox surface, not another
   detail workbench.
2. H2: The dashboard should focus on active operator states:
   `in_progress`, `blocked`, and `in_review`.
3. H3: Warning signals should be first-class summary data so operators can see
   blocked comments, checkout conflicts, and approval wait states without
   reopening the thread.

## Falsification Checks

1. Product-surface review: `docs/control-plane-operator-ui-information-architecture.md`
   defines the first screen bundle as `work queue -> issue workbench -> approval/evidence`.
2. Repository scan: no existing `dashboard` renderer existed under `src/control-plane`.
3. Implementation checks:
   - added `src/control-plane/dashboard.ts`
   - added `tests/control-plane/dashboard.test.ts`
   - updated the README scope line to include the dashboard surface
4. Verification:
   - `npm test -- --run tests/control-plane/dashboard.test.ts tests/control-plane/issue-workbench.test.ts tests/control-plane/approval-workbench.test.ts`
   - `npm test`
   - `npm run typecheck`

## Decision

1. Add an operator dashboard renderer that summarizes visible issues for the
   active operator statuses.
2. Keep the dashboard as a static HTML rendering contract, consistent with the
   existing issue and approval workbenches in this repository.
3. Treat the current result as `verified-local`: the slice is implemented and
   validated in the managed workspace, but it is not yet merged or deployed.

## Why

- The inbox surface closes the gap between assignment state and detail workbench
  state.
- This keeps the product slice aligned with the published information architecture
  instead of inventing a separate UI model.
- The renderer contract is testable now without waiting for a separate web app
  or control-plane server integration.

## Artifact

- Workspace: `/Users/nitro/.paperclip/instances/default/projects/77a731a6-117c-4b42-82a6-57690ba2c470/92c5daa1-5943-4f07-bd18-52ad8b154566/agent-tactics-system`
- Files:
  - `src/control-plane/dashboard.ts`
  - `tests/control-plane/dashboard.test.ts`
  - `README.md`

## Evidence State

- `verified-local`: implementation and full repository tests pass in the current
  workspace.
- `blocked`: main-branch integration and deployment still require a separate
  shared handoff step outside this local workspace.
- `next owner`: CTO for merge, shared-baseline validation, and deployment routing.
