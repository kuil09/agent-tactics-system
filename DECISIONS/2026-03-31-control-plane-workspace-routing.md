# Decision Record: control-plane(제어면 서버) 결함의 작업공간 라우팅

- Date: 2026-03-31
- Owner: CEO
- Related issues: [NIT-38](/NIT/issues/NIT-38), [NIT-39](/NIT/issues/NIT-39), [NIT-41](/NIT/issues/NIT-41)

## Context

[NIT-38](/NIT/issues/NIT-38)은 `issue_assigned wake`(이슈 할당으로 인한 깨움) 경로에서 `done` 또는 `cancelled` 상태 이슈가 다시 실행되는 결함을 다룹니다.

현재 이 프로젝트의 기본 작업공간은 아래 경로의 `agent-tactics-system` 저장소입니다.

- `/Users/nitro/.paperclip/instances/default/projects/77a731a6-117c-4b42-82a6-57690ba2c470/92c5daa1-5943-4f07-bd18-52ad8b154566/agent-tactics-system`
- 원격 저장소: `https://github.com/kuil09/agent-tactics-system`

확인 결과 이 저장소는 turn-based runtime reference implementation(턴 기반 런타임 참조 구현)이며, 실제 Paperclip control-plane(제어면 서버)의 wake queue(깨움 대기열), assignment scheduling(할당 스케줄링), issue checkout API(이슈 작업 잠금 API) 소스는 포함하지 않습니다.

따라서 현재 작업공간에 [NIT-38](/NIT/issues/NIT-38)을 직접 수정할 제품 코드가 없습니다.

## Decision

1. `issue_assigned wake`와 같은 Paperclip 운영 결함은 실제 control-plane 코드베이스가 연결된 프로젝트에서만 구현 작업을 시작합니다.
2. 소유 코드베이스가 확인되지 않은 상태에서는 구현을 강행하지 않고, 먼저 작업공간 제공 또는 프로젝트 재배치를 요청합니다.
3. 이 원칙의 첫 감사 추적은 [NIT-39](/NIT/issues/NIT-39)에 남기고, 재발 방지용 프로세스 결함은 [NIT-41](/NIT/issues/NIT-41)로 추적하며, 본 문서를 프로젝트 루트의 결정 기록으로 유지합니다.

## Why

- 잘못된 작업공간에 결함을 배정하면 실행 슬롯과 예산이 낭비됩니다.
- 수정 불가능한 저장소에서 재현 테스트를 약속하면 감사 추적이 오염됩니다.
- 결함 소유권과 코드 소유권이 분리되면 운영 오류가 반복됩니다.

## Operational Consequence

- [NIT-39](/NIT/issues/NIT-39)은 실제 control-plane 작업공간 또는 재배치 결정이 나올 때까지 차단 상태로 유지합니다.
- [NIT-38](/NIT/issues/NIT-38)은 해당 코드베이스가 연결되기 전까지 구현 단계로 재진입하지 않습니다.
- 이후 동일한 유형의 운영 결함이 발생하면, 먼저 "이 결함을 실제로 소유한 코드베이스가 현재 프로젝트에 연결되어 있는가"를 확인합니다.

## Required Follow-up

1. Paperclip board(이사회) 또는 운영 소유자가 실제 control-plane 저장소 경로, 브랜치, 커밋 중 하나를 제공합니다.
2. 또는 [NIT-38](/NIT/issues/NIT-38)을 올바른 프로젝트로 재배치합니다.
3. 그 다음에만 재현 테스트와 회귀 테스트를 구현합니다.

## Superseding Board Direction

- Date: 2026-03-31
- Source comment: [NIT-41 comment](/NIT/issues/NIT-41#comment-586ab20c-4a3d-4dac-a4b3-abf084a54f45)

이사회는 이후 지시에서 이 결함 묶음을 즉시 수정하지 말고 known issue(이미 인지했으며 당장 수정은 보류하는 결함)로 관리하라고 결정했습니다.

이에 따라 CEO는 다음과 같이 운영 결정을 갱신합니다.

1. [NIT-39](/NIT/issues/NIT-39)와 [NIT-41](/NIT/issues/NIT-41)은 구현 또는 프로세스 변경 실행 이슈로서 취소합니다.
2. [NIT-38](/NIT/issues/NIT-38)은 제품 결함 사실 자체의 기록은 유지하되, 별도 수정 작업은 새 이사회 지시 전까지 시작하지 않습니다.
3. 동일 결함이 다시 관찰되더라도, 새 투자 판단 없이 추가 구현 이슈를 자동 생성하지 않습니다.

## Revised Operational Consequence

- 이 저장소에서는 해당 결함에 대한 추가 구현을 진행하지 않습니다.
- 관련 실행 이슈는 취소하고, 감사 목적의 결정 기록과 원인 이슈만 남깁니다.
- 향후 재개는 이사회의 명시적 재지시 또는 우선순위 재조정이 있을 때만 검토합니다.
