# Provider Policy API

The control-plane read surface now exposes the provider registry and assignment
gate policy that previously existed only as internal TypeScript functions.

## Routes

- `GET /api/providers/registry`
- `GET /api/providers/registry/{providerId}`
- `POST /api/providers/assignment-decisions`

## Registry Response

Each provider entry returns:

- `provider_id`
- `provider_kind`
- `transport`
- `models`
- `trust_tier`
- `eligibility`
- `assignment_modes`

This keeps the API aligned with the existing `ProviderRegistryEntry` contract.

## Assignment Decision Request

`POST /api/providers/assignment-decisions`

```json
{
  "task_id": "task-123",
  "candidate_provider_id": "openai-runtime",
  "candidate_model": "gpt-5.4",
  "target_role": "implementer",
  "requested_task_level": "L4",
  "required_skills": ["typescript"]
}
```

## Assignment Decision Response

The response returns both the matched registry entry and the evaluated
assignment decision so operators can inspect the evidence and the resulting
policy decision in one call.

```json
{
  "provider": {
    "provider_id": "openai-runtime",
    "provider_kind": "openai",
    "transport": "api",
    "models": [
      {
        "model_id": "gpt-5.4",
        "task_levels_supported": ["L1", "L2", "L3", "L4", "L5"]
      }
    ],
    "trust_tier": "T3",
    "eligibility": {
      "registered": true,
      "protocol_compliant": true,
      "heartbeat_ok": true,
      "microbench_status": "pass",
      "last_calibrated_at": "2026-04-03T00:00:00Z"
    },
    "assignment_modes": ["direct", "decompose_only"]
  },
  "decision": {
    "task_id": "task-123",
    "candidate_provider_id": "openai-runtime",
    "candidate_model": "gpt-5.4",
    "target_role": "implementer",
    "requested_task_level": "L4",
    "decision": "assign",
    "reasons": ["provider evidence satisfies direct assignment gate"],
    "required_skills": ["typescript"],
    "independent_verifier_required": true
  }
}
```

## Verification

```bash
npm test -- --run tests/control-plane/read-api.test.ts tests/control-plane/operator-server.test.ts
```
