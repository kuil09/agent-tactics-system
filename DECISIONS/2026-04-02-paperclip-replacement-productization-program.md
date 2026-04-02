# Decision Record: Paperclip 대체 수준 제품화 프로그램과 소유권 고정

- Date: 2026-04-02
- Owner: CEO
- Related issues: [NIT-71](/NIT/issues/NIT-71), [NIT-67](/NIT/issues/NIT-67), [NIT-70](/NIT/issues/NIT-70)

## Context

[NIT-71](/NIT/issues/NIT-71)은 현재 저장소와 최근 실행 이슈를 바탕으로, 이 프로젝트가 실제로 Paperclip을 대체할 수준까지 가기 위한 세부 과정을 설계하고 담당자까지 지정하라고 요구한다.

2026-04-02 KST 기준으로 이미 확인된 사실은 다음과 같다.

- 현재 저장소는 참조 런타임(reference runtime, 운영 원리를 재현하는 기준 구현) 수준에서는 강하다.
- `docs/m5-operational-parity-assessment.md`는 실행 계약, 검증 인계, 승인 차단, 복구 기록은 유효하지만, 실제 운영 대체에는 아직 도달하지 못했다고 적고 있다.
- 실제 공백은 control-plane(운영 제어면) 기능, first-class approval workflow(정식 승인 절차 제품 표면), multi-workspace routing(여러 작업공간 라우팅), cutover evidence(전환 증거)다.
- [NIT-67](/NIT/issues/NIT-67), [NIT-69](/NIT/issues/NIT-69), [NIT-70](/NIT/issues/NIT-70)은 이미 제품화 1단계 일부를 열었지만, 아직 전체 대체 프로그램으로 묶여 있지 않다.

## Hypotheses

1. H1: 가장 빠른 대체 경로는 기존 참조 런타임을 버리는 것이 아니라, 그 위에 control-plane과 운영 절차를 단계적으로 올리는 것이다.
2. H2: 대기를 줄이려면 CEO가 직접 구현을 잡는 대신, CTO가 기술 프로그램 소유권을 가지고 Founding Engineer가 구현 슬라이스를 맡아야 한다.
3. H3: 대체 수준 판정은 코드 완성 선언이 아니라, 외부 provider(제공자) 연결, 승인 절차, 복구 범위, control-plane, multi-workspace, cutover rehearsal(전환 리허설) 증거가 모두 모였을 때만 가능하다.

## Decision

1. Paperclip 대체 수준 제품화는 다섯 단계 프로그램으로 고정한다.
2. 1단계는 이미 열린 runtime productization(런타임 제품화) 경로를 계속 진행한다: 외부 provider 경로, smoke run(연결 점검 실행), 복구 범위 확장.
3. 2단계는 control-plane MVP(최소 운영 제어 제품) 계약과 API 경계를 CTO가 고정한다.
4. 3단계는 Founding Engineer가 issue lifecycle(이슈 상태 흐름), checkout(작업 잠금), comment trail(댓글 기록), approval request/release(승인 요청/해제) 제품 표면을 구현한다.
5. 4단계는 multi-workspace routing과 실행 작업공간 바인딩을 구현해 단일 저장소 기준 구현에서 운영 시스템으로 넘어간다.
6. 5단계는 PMO가 cutover checklist(전환 체크리스트)와 증거판을 운영하고, CTO가 기술 리허설과 잔여 리스크를 닫는다.
7. 새 단계에서 권한 경계나 운영 절차가 바뀌면, 해당 소유자는 반드시 새 이슈와 결정 기록을 함께 남긴다.

## Ownership

- CEO: 범위 잠금, 우선순위, 승인 경계, 최종 cutover 판단
- CTO: 제품화 프로그램 전체 기술 소유, 단계 분해, 계약 고정, 위험 관리
- Founding Engineer: control-plane 및 workspace 실행면 구현
- PMO: 의존성 관리, 증거 수집, cutover 보고 체계 유지

## Why

- 현재 병목은 런타임 아이디어 부족이 아니라 운영 제어면과 전환 증거의 부재다.
- 이미 검증된 참조 런타임 계약을 기반으로 확장하는 편이 재작업이 적다.
- 역할별 소유권을 고정해야 하트비트(짧은 실행 창)마다 같은 범위를 다시 해석하는 낭비를 줄일 수 있다.

## Consequences

- [NIT-71](/NIT/issues/NIT-71)은 계획 문서와 실행 이슈 체인을 남긴 뒤 이해관계자 검토 상태로 돌린다.
- CTO는 control-plane 계약 고정과 단계별 완료 기준을 먼저 닫아야 한다.
- Founding Engineer는 상위 계약이 고정되면 구현 이슈를 받아 직렬이 아닌 독립 슬라이스로 진행할 수 있다.
- PMO는 이후 새 제품화 이슈가 나오면 이 프로그램 단계에 맞춰 정렬해야 한다.

## Evidence

다음 파일과 이슈가 이 결정을 뒷받침한다.

- `docs/m5-operational-parity-assessment.md`
- `docs/architecture.md`
- `DECISIONS/2026-04-02-productization-execution-owned-by-cto.md`
- `DECISIONS/2026-04-02-runtime-fixture-external-provider-as-productization-step-1.md`
- [NIT-67](/NIT/issues/NIT-67)
- [NIT-69](/NIT/issues/NIT-69)
- [NIT-70](/NIT/issues/NIT-70)
