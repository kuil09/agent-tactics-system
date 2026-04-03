# Decision Record: done issue(완료 이슈) assignment wake(할당 깨움) 런타임 결함의 최소 재현 경로

- Date: 2026-04-03
- Owner: CTO
- Related issues: [NIT-84](/NIT/issues/NIT-84), [NIT-83](/NIT/issues/NIT-83), [NIT-38](/NIT/issues/NIT-38)

## Context

[NIT-84](/NIT/issues/NIT-84)는 이미 `done`(완료) 상태인 [NIT-83](/NIT/issues/NIT-83) 때문에 CEO heartbeat(짧은 실행 주기)가 다시 `issue_assigned`(이슈 할당 깨움)로 시작한 사례를 조사하라고 요청한다.

이번 heartbeat에서 확인한 사실은 다음과 같다.

- 제어면 API에서 [NIT-84](/NIT/issues/NIT-84)를 `in_progress`(진행 중)로 바꾼 직후, `checkoutRunId`(작업 잠금 run id)가 비어 있어 댓글 작성이 `Issue run ownership conflict`로 거절됐다.
- 이후 같은 run id로 `checkout`을 호출하자 `checkoutRunId`가 채워지고 댓글 작성이 가능해졌다.
- 현재 저장소의 최소 제어면 서비스인 `src/control-plane/issue-service.ts`에서는 checkout 상태의 이슈가 `transitionIssue(..., nextStatus: "done")` 또는 `transitionIssue(..., nextStatus: "cancelled")`를 거칠 때 checkout을 자동 해제하지 않았다.
- 이 동작은 `done` 또는 `cancelled` 상태에 실행 잠금 또는 active run(현재 실행 중으로 보이는 기록)이 남는 실제 운영 결함과 구조적으로 같은 정리 누락이다.

## Hypotheses

1. H1: 종료 상태 전이에서 checkout 또는 실행 잠금 정리가 누락되면, 종결 이슈가 다시 실행 후보처럼 보일 수 있다.
2. H2: 최소 제어면 서비스에서 종료 상태 전이 시 checkout을 자동 해제하면, 같은 유형의 정리 누락을 재현 가능한 제품 규칙으로 고정할 수 있다.
3. H3: 실제 `issue_assigned` 깨움 결함 전체는 이 저장소 밖의 control-plane(운영 제어 서버) queue/scheduler(대기열/스케줄러) 코드까지 포함해야 완전히 수정된다.

## Falsification Checks

1. 코드 검사: `src/control-plane/issue-service.ts`에서 `transitionIssue`는 상태만 바꾸고 terminal-state cleanup(종결 상태 정리)을 하지 않았다.
2. 제품 테스트 추가: checkout 중인 이슈를 `done`으로 전이했을 때 checkout이 `null`로 비워지고 `release.granted` 이벤트와 시스템 댓글이 남아야 한다는 테스트를 추가했다.
3. 검증 결과: `npm test -- --run tests/control-plane/issue-service.test.ts`와 `npm run typecheck`가 모두 통과했다.

## Decision

1. 이 저장소의 최소 제어면 제품 표면에서는 `done`과 `cancelled`로의 직접 상태 전이 시 checkout을 자동 해제한다.
2. 자동 해제는 감사 추적을 위해 `release.granted` 이벤트와 시스템 댓글을 함께 남긴다.
3. 실제 CEO 재깨움 문제의 전체 수정은 여전히 별도 control-plane 코드베이스가 필요하므로, 이 저장소에서는 최소 재현 규칙과 제품 계약만 고정한다.

## Why

- 종결 이슈에 실행 소유권이 남아 있으면 운영자 입장에서 "끝난 일"과 "지금 돌아가는 일"이 구분되지 않는다.
- checkout 정리는 상태 전이와 분리된 선택 동작이 아니라 terminal-state invariant(종결 상태 불변 조건)이어야 한다.
- 최소 제품 표면에서 이 규칙을 먼저 고정하면, 실제 제어면 서버 구현도 동일한 회귀 테스트 기대치를 공유할 수 있다.

## Reproduction

현재 저장소에서 재현 및 검증할 명령:

```bash
npm test -- --run tests/control-plane/issue-service.test.ts
npm run typecheck
```

제어면 API에서 같은 결함군을 관찰한 명령:

```bash
curl -sS -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  "$PAPERCLIP_API_URL/api/issues/$PAPERCLIP_TASK_ID"

curl -sS -X POST \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID" \
  "$PAPERCLIP_API_URL/api/issues/$PAPERCLIP_TASK_ID/checkout" \
  -d "{\"agentId\":\"$PAPERCLIP_AGENT_ID\",\"runId\":\"$PAPERCLIP_RUN_ID\",\"expectedStatuses\":[\"in_progress\"]}"
```

검증 작업공간:

- `/Users/nitro/.paperclip/instances/default/projects/77a731a6-117c-4b42-82a6-57690ba2c470/92c5daa1-5943-4f07-bd18-52ad8b154566/agent-tactics-system`

## Operational Consequence

- `src/control-plane/issue-service.ts`는 종료 상태 전이 시 checkout 정리를 강제하는 기준 구현이 된다.
- 실제 Paperclip control-plane 서버에서 `executionRunId`, `executionLockedAt`, `activeRun` 정리 누락이 있는지 별도 코드베이스에서 같은 규칙으로 대조해야 한다.
- [NIT-38](/NIT/issues/NIT-38)에는 이번 사례를 "done 상태 전이 뒤 실행 소유권 정리 누락" 증거로 연결한다.

## Replacement Trail

- 이 결정은 [NIT-84](/NIT/issues/NIT-84)의 조사 결과를 고정하는 문서다.
- 실제 제어면 queue/scheduler 수정 이슈가 열리면, 본 문서를 replacement evidence(대체 증거 경로)로 링크하고 여기서 고정한 terminal-state cleanup 규칙을 그대로 상속한다.
