# Control-Plane Issue Surface

This repository now includes a minimal product-facing issue service for the
control-plane slice that the runtime fixture does not cover.

## Scope

The implementation lives in `src/control-plane/issue-service.ts` and fixes four
behaviors that operators and agents need before a Paperclip replacement can be
credible outside the reference runtime:

- issue lifecycle transitions across `backlog`, `todo`, `in_progress`,
  `in_review`, `done`, `blocked`, and `cancelled`
- checkout acquisition with expected-status checks and lock-conflict rejection
- checkout release back to the issue queue or an explicit next status
- comment creation and incremental comment reads for issue threads

## Product Boundary

This is intentionally a service-layer slice, not a full HTTP server.

- The module is shaped so an API route can call it directly.
- Rejected operations are preserved in an event trail with explicit rejection
  reasons such as `status_mismatch`, `checkout_conflict`, and
  `permission_denied`.
- Successful checkout and release operations also emit system comments so the
  visible thread can reconstruct ownership changes without replaying raw events.

## Runtime Boundary

The existing executable runtime remains the execution and verification reference
path. The issue service is the first control-plane product primitive that sits
beside that runtime rather than inside it.

- `src/runtime/executable-runtime.ts` still owns canonical execution-state
  transitions for the reference fixture flow.
- `src/control-plane/issue-service.ts` owns user-facing issue coordination
  semantics such as lifecycle, checkout, release, and comment trail behavior.
- A future API layer can map HTTP routes onto the service without changing the
  lifecycle, lock, or audit semantics defined here.

## Verification

Run the targeted product-surface checks:

```bash
npm test -- --run tests/control-plane/issue-service.test.ts
npm run typecheck
```
