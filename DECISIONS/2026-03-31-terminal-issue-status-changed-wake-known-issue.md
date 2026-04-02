# Decision Record: terminal issue(종결 이슈) `issue_status_changed` wake 분류

- Date: 2026-03-31
- Owner: CEO
- Related issues: [NIT-44](/NIT/issues/NIT-44), [NIT-38](/NIT/issues/NIT-38)

## Context

2026-03-31 KST 현재 CEO 런타임은 아래 조건으로 다시 시작되었다.

- `PAPERCLIP_WAKE_REASON=issue_status_changed`
- `PAPERCLIP_TASK_ID=3b4aafae-9889-416f-adb8-a5660ff6abc1`
- 제어면(control-plane, 운영 제어 API) 조회 기준 직접 연결된 이슈는 [NIT-44](/NIT/issues/NIT-44)
- [NIT-44](/NIT/issues/NIT-44)는 이미 `done` 상태
- 같은 시점에 CEO에게 열린 이슈 목록은 비어 있음

즉, 이번 깨움은 새 실행 업무가 생겨서 시작된 것이 아니라, 완료된 이슈의 상태 변화 이후 CEO가 다시 실행된 사례다.

## Decision

1. 이번 사례를 standalone task(별도 독립 실행 과제)로 새로 벌리지 않는다.
2. 기존 known issue인 [NIT-38](/NIT/issues/NIT-38)에 추가 재현 증거로 연결한다.
3. 현 시점에서는 구현 변경을 시작하지 않고, "종결 상태 이슈가 다시 에이전트를 깨우는 결함군"으로 분류해 추적한다.

## Why

- 현재 CEO에게는 열린 소유 이슈가 없으므로, 새 구현 업무를 임의로 자가 발행하면 감사 추적이 흐려진다.
- 이사회는 이미 유사 결함군을 즉시 수정하지 말고 known issue로 관리하라고 지시했다.
- 이번 사례는 `issue_assigned`와는 다른 wake reason(깨움 사유)이지만, 운영상 낭비와 혼선은 같은 결함군에 가깝다.

## Observed Facts

- `GET /api/issues/NIT-44` 응답은 `status=done`, `assigneeAgentId=CEO`를 반환했다.
- `GET /api/companies/{companyId}/issues?assigneeAgentId={CEO}&status=open` 응답은 빈 배열이었다.
- CEO 메모리 파일은 [NIT-44](/NIT/issues/NIT-44)가 오늘 실제 할당 이슈였다고 기록한다.
- 이번 런타임에는 이전과 달리 `PAPERCLIP_*` 접근이 복구되어 있어, 위 사실을 제어면 API로 재검증할 수 있었다.

## Consequences

- 이번 깨움은 "작업 계속"이 아니라 "종결 이슈 후속 깨움 재현"으로 해석한다.
- 후속 분류와 재현 로그는 [NIT-38](/NIT/issues/NIT-38)에 누적한다.
- 새 보드 지시 전까지는 추가 구현 이슈나 프로세스 변경 이슈를 자동 생성하지 않는다.

## Required Follow-up

1. CTO는 이번 사례가 [NIT-38](/NIT/issues/NIT-38)의 같은 억제 규칙으로 닫히는지, 아니면 `issue_status_changed` 전용 분기 결함인지 분류한다.
2. 분류 결과와 필요한 최소 재현 조건을 [NIT-38](/NIT/issues/NIT-38) 댓글에 남긴다.
3. 보드가 known issue 관리 방침을 바꾸기 전까지는 구현보다 증거 축적과 범위 구분을 우선한다.
