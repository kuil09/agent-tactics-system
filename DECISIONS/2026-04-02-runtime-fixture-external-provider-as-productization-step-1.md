# Decision Record: 제품화 1단계는 외부 제공자 연결 경로를 여는 것으로 고정

- Date: 2026-04-02
- Owner: CTO
- Related issues: [NIT-67](/NIT/issues/NIT-67), [NIT-66](/NIT/issues/NIT-66)

## Context

[NIT-67](/NIT/issues/NIT-67)은 현재 저장소에서 바로 시작할 수 있는 실제 제품화 1단계를 하나 고정하고, 산출물과 후속 분해를 남기라고 요구한다.

가설 기반 실행으로 세 후보를 비교했다.

1. 외부 제공자 연결 경로 추가
2. 승인 워크플로 직전 경계 정리
3. 다중 파일/부분 쓰기 복구 계약 확장

관찰된 사실:

- 현재 `src/runtime/cli.ts`는 항상 로컬 fixture provider server(재현용 제공자 서버)를 직접 띄운다.
- 반면 `src/runtime/openai-compatible-provider.ts`는 이미 외부 OpenAI-compatible(오픈AI 호환) HTTP endpoint(원격 실행 주소)로 handshake(연결 확인)와 execution(실행)을 수행할 수 있다.
- 즉 제품화와 가장 가까운 남은 공백은 "실행 경로 선택을 operator(운영자)가 바꿀 수 없다는 점"이다.

## Decision

1. 제품화 1단계는 `runtime:fixture` CLI가 로컬 fixture와 외부 OpenAI-compatible provider를 모두 지원하도록 여는 작업으로 고정한다.
2. 기본값은 계속 fixture 모드로 두어 기존 재현성과 테스트 계약을 깨지 않는다.
3. 외부 provider 사용 시에도 `run-result.json`, `runtime.log`, verification handoff(검증 인계), approval gate(승인 게이트), recovery contract(복구 계약) 구조는 유지한다.
4. 이번 단계에서는 credential source governance(자격 증명 제공 통제), 실제 approval surface(정식 승인 화면), multi-file recovery(다중 파일 복구)는 의도적으로 제외하고 후속 이슈로 분리한다.

## Why

- 가장 작은 변경으로 실제 운영 연결점을 연다.
- 기존 산출물 계약을 그대로 유지할 수 있어 회귀 위험이 낮다.
- 외부 제공자 연결은 이후 승인 통합과 복구 확장의 공통 기반이 된다.

## Consequences

- 운영자는 환경변수나 CLI 인자로 외부 provider smoke run(실운영 전 연결 점검 실행)을 수행할 수 있다.
- 저장소는 더 이상 "fixture transport만 가능한 참조 구현"에 머물지 않고, 같은 계약으로 외부 제공자까지 닿는 제품화 경로를 갖는다.
- 다음 단계는 자격 증명 통제, 복구 확장, 승인 연계를 각각 분리된 실행 이슈로 추적해야 한다.
