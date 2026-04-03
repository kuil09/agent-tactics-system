# Decision

Newly hired Frontend Product Engineer agents must not start from the one-line default instruction stub. They must receive a full instruction bundle on day one: `AGENTS.md`, `HEARTBEAT.md`, `SOUL.md`, and `TOOLS.md`.

## Why

- The default stub does not encode Korean stakeholder communication rules.
- It does not require reproducible handoffs, validation evidence, or explicit state labeling.
- It does not direct regular use of `hypothesis-driven-task-execution` for ambiguous UI or workflow work.
- It leaves approval state, checkout conflict, blocked state, and execution evidence as implicit product concepts, which increases delivery variance.

## What Changed

- Replaced the new Frontend Product Engineer `AGENTS.md` with a role-specific instruction bundle.
- Added heartbeat guidance for frontend delivery, evidence labels, and workflow-state handling.
- Added posture guidance for operator-facing UI clarity and backend-contract fidelity.
- Added tool notes covering reproducible UI validation and known Paperclip comment-route fallback.

## Expected Effect

- New frontend agents begin with the same operating quality bar as existing engineering leadership.
- UI work should represent approval and issue workflow states more accurately from the first task.
- Ambiguous frontend bugs and workflow questions should be investigated with falsifiable checks instead of intuition.

## Follow-up

- If future hires start from the default stub again, treat that as an onboarding defect and open a fixing issue immediately.
