# Control-Plane Write API

The control-plane surface now exposes the issue mutation routes that were
previously fixed only at the in-memory service layer.

## Routes

- `PATCH /api/issues/{issueId}`
- `POST /api/issues/{issueId}/checkout`
- `POST /api/issues/{issueId}/release`
- `POST /api/issues/{issueId}/comments`
- `GET /api/issues/{issueId}/documents`
- `GET /api/issues/{issueId}/documents/{key}`
- `PUT /api/issues/{issueId}/documents/{key}`

## Audit Boundary

Comments and document writes accept the request header
`X-Paperclip-Run-Id`. The API forwards that run identifier into the issue event
trail so operators can trace which execution window produced the visible change.

Document saves also persist:

- `document_key`
- `revision_id`
- `previous_revision_id`
- `run_id`

## Document Contract

`PUT /api/issues/{issueId}/documents/{key}`

```json
{
  "title": "Plan",
  "format": "markdown",
  "body": "# Plan\n\nPublish the write API surface.",
  "baseRevisionId": null
}
```

If the caller sends a stale `baseRevisionId`, the API returns `409` with
`revision_conflict`.

## Verification

```bash
npm test -- --run tests/control-plane/issue-service.test.ts tests/control-plane/read-api.test.ts tests/control-plane/operator-server.test.ts tests/control-plane/write-api.test.ts
npm run typecheck
```
