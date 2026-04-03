# Control-Plane Issue Surface

This repository now includes a minimal product-facing issue service and read API
surface for the control-plane slice that the runtime fixture does not cover.

## Scope

The implementation lives in `src/control-plane/issue-service.ts` and
`src/control-plane/read-api.ts`.

The service layer fixes four behaviors that operators and agents need before a
Paperclip replacement can be credible outside the reference runtime:

- issue lifecycle transitions across `backlog`, `todo`, `in_progress`,
  `in_review`, `done`, `blocked`, and `cancelled`
- checkout acquisition with expected-status checks and lock-conflict rejection
- checkout release back to the issue queue or an explicit next status
- automatic checkout release when the checkout owner moves work into terminal
  `done` or `cancelled` states
- comment creation and incremental comment reads for issue threads

The read API adds the first route-level product surface for operator screens:

- `GET /api/agents/me/inbox-lite`
- `GET /api/companies/{companyId}/issues`
- `GET /api/companies/{companyId}/dashboard`
- `GET /api/issues/{issueId}`
- `GET /api/issues/{issueId}/heartbeat-context`
- `GET /api/issues/{issueId}/comments`
- `GET /api/issues/{issueId}/comments/{commentId}`
- `GET /api/issues/{issueId}/activity`

## Product Boundary

This is intentionally a route-handler slice, not a full production server.

- The modules are shaped so an API route or `node:http` server can call them directly.
- Rejected operations are preserved in an event trail with explicit rejection
  reasons such as `status_mismatch`, `checkout_conflict`, and
  `permission_denied`.
- Successful checkout and release operations also emit system comments so the
  visible thread can reconstruct ownership changes without replaying raw events.
- Dashboard and issue workbench responses are built from the existing
  view-model helpers so the first operator UI can consume them without extra
  transformation.

## Runtime Boundary

The existing executable runtime remains the execution and verification reference
path. The issue service is the first control-plane product primitive that sits
beside that runtime rather than inside it.

- `src/runtime/executable-runtime.ts` still owns canonical execution-state
  transitions for the reference fixture flow.
- `src/control-plane/issue-service.ts` owns user-facing issue coordination
  semantics such as lifecycle, checkout, release, and comment trail behavior.
- The read API maps HTTP paths onto the service and workbench/dashboard view
  models without changing the lifecycle, lock, or audit semantics defined here.

## Verification

Run the targeted product-surface checks:

```bash
npm test -- --run tests/control-plane/issue-service.test.ts
npm test -- --run tests/control-plane/read-api.test.ts
npm run typecheck
```
