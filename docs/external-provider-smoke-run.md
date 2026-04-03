# External Provider Smoke Run

This document fixes the governed credential source and the repeatable smoke run
procedure for `npm run runtime:fixture` when the runtime targets an external
provider.

## Governed Credential Source

Use one operator-managed shell environment file outside the repository:

- Path: `${HOME}/.config/agent-tactics-system/runtime-fixture-provider.env`
- Owner: the operator account that runs the smoke command
- File mode: `0600`
- Scope: local machine or managed secret mount only

Required variables:

```bash
RUNTIME_FIXTURE_PROVIDER_MODE=external
RUNTIME_FIXTURE_PROVIDER_BASE_URL=https://provider.example.com
RUNTIME_FIXTURE_PROVIDER_MODEL_ID=gpt-4.1-mini
RUNTIME_FIXTURE_PROVIDER_API_KEY=replace-me
```

Optional variables:

```bash
RUNTIME_FIXTURE_PROVIDER_ID=runtime-smoke
RUNTIME_FIXTURE_PROVIDER_KIND=openai
```

For Claude provider runs, set:

```bash
RUNTIME_FIXTURE_PROVIDER_MODE=external
RUNTIME_FIXTURE_PROVIDER_BASE_URL=https://api.anthropic.com
RUNTIME_FIXTURE_PROVIDER_MODEL_ID=claude-sonnet-4-5
RUNTIME_FIXTURE_PROVIDER_API_KEY=replace-me
RUNTIME_FIXTURE_PROVIDER_KIND=claude
```

Governance rules:

- Do not commit the env file to the repository.
- Do not store provider secrets under `artifacts/`, `workspace/`, or any tracked
  path in this repository.
- Use `--provider-api-key` only for temporary non-production debugging when the
  shell environment file cannot be mounted.
- Treat the shell environment file as the single credential source of truth for
  operator smoke runs.

Create the file once:

```bash
install -d -m 700 "${HOME}/.config/agent-tactics-system"
cat > "${HOME}/.config/agent-tactics-system/runtime-fixture-provider.env" <<'EOF'
RUNTIME_FIXTURE_PROVIDER_MODE=external
RUNTIME_FIXTURE_PROVIDER_BASE_URL=https://provider.example.com
RUNTIME_FIXTURE_PROVIDER_MODEL_ID=gpt-4.1-mini
RUNTIME_FIXTURE_PROVIDER_API_KEY=replace-me
RUNTIME_FIXTURE_PROVIDER_ID=runtime-smoke
RUNTIME_FIXTURE_PROVIDER_KIND=openai
EOF
chmod 600 "${HOME}/.config/agent-tactics-system/runtime-fixture-provider.env"
```

## Repeatable Smoke Run

Run from the repository root:

```bash
set -a
. "${HOME}/.config/agent-tactics-system/runtime-fixture-provider.env"
set +a
npm run runtime:fixture
```

Expected artifact paths:

- `artifacts/runtime-fixtures/success/run-result.json`
- `artifacts/runtime-fixtures/success/workspace/artifacts/runtime.log`

## Pass Criteria

The smoke run passes only when all of the checks below succeed:

```bash
test -f artifacts/runtime-fixtures/success/run-result.json
test -f artifacts/runtime-fixtures/success/workspace/artifacts/runtime.log
node -e '
const fs = require("node:fs");
const summary = JSON.parse(fs.readFileSync("artifacts/runtime-fixtures/success/run-result.json", "utf8"));
if (summary.provider_target?.mode !== "external") {
  throw new Error("provider_target.mode must be external");
}
if (summary.provider_handshake?.metadata?.transport !== "http") {
  throw new Error("provider handshake transport must be http");
}
if (summary.verification_evidence?.promotion_gate !== "waiting_for_human_approval_and_independent_verifier") {
  throw new Error("promotion gate mismatch");
}
if (summary.provider_handshake?.metadata?.endpoint_origin !== summary.provider_target?.base_url) {
  throw new Error("endpoint origin must match provider target base URL");
}
'
```

## Fail Criteria

Treat the smoke run as failed when any of the conditions below occurs:

- `npm run runtime:fixture` exits non-zero.
- `artifacts/runtime-fixtures/success/run-result.json` is missing.
- `artifacts/runtime-fixtures/success/workspace/artifacts/runtime.log` is
  missing.
- `run-result.json` does not record `provider_target.mode=external`.
- `run-result.json` records an `endpoint_origin` different from
  `provider_target.base_url`.
- `run-result.json` does not preserve
  `verification_evidence.promotion_gate=waiting_for_human_approval_and_independent_verifier`.

## Evidence Handoff

When the smoke run passes, hand off these exact evidence paths:

- `artifacts/runtime-fixtures/success/run-result.json`
- `artifacts/runtime-fixtures/success/workspace/artifacts/runtime.log`

Use `run-result.json#provider_target`,
`run-result.json#provider_handshake`, and
`run-result.json#verification_handoff` as the review anchors for operator and
independent verifier handoff.
