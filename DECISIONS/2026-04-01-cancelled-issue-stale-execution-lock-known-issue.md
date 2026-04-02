# Decision Record: cancelled issue(취소된 이슈) stale execution lock(남아 있는 실행 잠금) 분류

- Date: 2026-04-01
- Owner: CTO
- Related issues: [NIT-53](/NIT/issues/NIT-53), [NIT-28](/NIT/issues/NIT-28), [NIT-26](/NIT/issues/NIT-26), [NIT-38](/NIT/issues/NIT-38)

## Context

[NIT-53](/NIT/issues/NIT-53)은 PMO(프로젝트 운영 관리)가 [NIT-28](/NIT/issues/NIT-28)을 다시 이어서 처리하려 할 때 checkout(작업 잠금 확보) 충돌이 발생했다는 보고다.

2026-04-01 KST 기준 제어면 API(Application Programming Interface, 운영 제어 서버 인터페이스)에서 확인한 사실은 다음과 같다.

- [NIT-28](/NIT/issues/NIT-28)은 이미 `cancelled` 상태다.
- 상위 [NIT-26](/NIT/issues/NIT-26)도 이미 `cancelled` 상태다.
- 그러나 [NIT-28](/NIT/issues/NIT-28)에는 여전히 `executionRunId=cc338e93-cc85-4759-b4d7-10f7b3774484`, `executionAgentNameKey=pmo`, `executionLockedAt=2026-03-30T17:23:28.444Z`가 남아 있다.
- [NIT-28](/NIT/issues/NIT-28)의 취소 사유와 후속 backlog(재개 시점에 다시 판단할 작업 적치) 경로는 이미 댓글과 [NIT-31](/NIT/issues/NIT-31)로 남아 있다.
- 따라서 현재 필요한 상태 결정은 `blocked` 또는 `in_progress`가 아니라, 종결 상태에서 실행 잠금이 정리되지 않은 운영 결함의 분류다.

## Decision

1. [NIT-53](/NIT/issues/NIT-53)은 별도 장기 실행 이슈로 유지하지 않는다.
2. 이번 사례는 기존 known issue(이미 인지했으며 당장 수정은 보류하는 결함)인 [NIT-38](/NIT/issues/NIT-38)에 추가 증거로 연결한다.
3. [NIT-28](/NIT/issues/NIT-28)의 올바른 업무 상태는 계속 `cancelled`이며, 남은 문제는 "종결 이슈가 다시 실행 후보가 되거나 실행 잠금을 남기는 결함군"으로 본다.

## Why

- 업무 의미상 [NIT-28](/NIT/issues/NIT-28)은 이미 보드 결정으로 종료됐다. 따라서 `blocked`나 `in_progress`로 되돌리는 것은 감사 추적을 흐린다.
- 결함의 핵심은 PMO 업무 정합성이 아니라 terminal-state cleanup(종결 상태 정리) 누락이다.
- [NIT-38](/NIT/issues/NIT-38)은 이미 `done`, `cancelled`, `issue_assigned`, `issue_status_changed` 사례를 같은 억제 규칙 결함군으로 관리 중이다.
- 이번 사례는 wake reason(깨움 사유) 재현보다 lock persistence(잠금 지속) 쪽이 더 직접적이지만, 운영 결과는 동일하게 종결 이슈가 다시 실행 시스템에 개입한다는 점이다.

## Reproduction Evidence

다음 명령으로 사실을 재검증할 수 있다.

```bash
curl -sS -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  "$PAPERCLIP_API_URL/api/issues/7c6883bb-0c36-4035-978e-ff9a6edece3e"

curl -sS -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  "$PAPERCLIP_API_URL/api/issues/6ac20eb3-cc8f-4c8f-92ad-94ef06568dea"

curl -sS -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  "$PAPERCLIP_API_URL/api/issues/7c6883bb-0c36-4035-978e-ff9a6edece3e/comments"
```

검증 작업공간:

- `/Users/nitro/.paperclip/instances/default/projects/77a731a6-117c-4b42-82a6-57690ba2c470/92c5daa1-5943-4f07-bd18-52ad8b154566/agent-tactics-system`

## Operational Consequence

- [NIT-53](/NIT/issues/NIT-53)은 triage complete(분류 완료)로 닫고, 대체 추적 경로를 [NIT-38](/NIT/issues/NIT-38)로 명시한다.
- [NIT-38](/NIT/issues/NIT-38)은 여전히 `blocked` 상태로 유지한다. 이유는 실제 control-plane codebase(운영 제어 서버 코드베이스)가 현재 작업공간에 연결되어 있지 않기 때문이다.
- 이후 같은 유형의 사례가 발생하면 새 구현 이슈를 자동 생성하지 말고, [NIT-38](/NIT/issues/NIT-38)에 재현 증거만 누적한다.

## Required Follow-up

1. CTO는 [NIT-38](/NIT/issues/NIT-38)에 이번 stale execution lock 사례를 추가 증거로 댓글 기록한다.
2. CTO는 [NIT-53](/NIT/issues/NIT-53)를 취소 또는 종료하면서 replacement path(대체 추적 경로)로 [NIT-38](/NIT/issues/NIT-38)을 남긴다.
3. 보드가 수정 재개를 승인하기 전까지는 구현이 아니라 증거 누적과 범위 고정을 우선한다.
