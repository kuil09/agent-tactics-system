# Decision Record: approval workflow handoff(승인 인계 기록) 경계를 control-plane(운영 제어 서버) 연동 직전까지 고정

- Date: 2026-04-02
- Owner: CTO
- Related issues: [NIT-68](/NIT/issues/NIT-68), [NIT-67](/NIT/issues/NIT-67)

## Context

[NIT-68](/NIT/issues/NIT-68)은 현재 저장소의 승인 handoff(인계 기록)를 실제 control-plane 연동 직전 수준까지 정리하라고 요청한다.

관찰된 사실은 다음과 같다.

- `src/runtime/executable-runtime.ts`는 이미 `verification_handoff.approval_workflow.request`, `decision`, `release` 구조를 고정하고 있다.
- 이 구조는 승인 요청 근거, 승인 결정 자리, 승격 전 차단 조건을 분리해 기록한다.
- 반면 실제 사람 승인 수집, 승인자 인증, 승인 결과 영속화, `approval:grant` 권한으로 승격 재시도하는 제품 표면은 저장소 밖에 있다.
- 따라서 지금 필요한 일은 새 상태 체계를 만들거나 control-plane 동작을 추측하는 것이 아니라, 현재 산출물 계약과 외부 의존성 경계를 문서로 잠그는 것이다.

## Hypotheses

1. H1: 현재 승인 흐름의 핵심 공백은 코드 구조 부족이 아니라 책임 경계 문서 부재다.
2. H2: `request`, `decision`, `release`를 단계별 산출물과 외부 책임으로 다시 적으면, 후속 control-plane 연동 이슈는 입력 계약을 재해석하지 않고 바로 구현할 수 있다.

## Experiments

### Experiment A: 코드 구조 확인

다음 파일을 직접 읽었다.

- `src/runtime/executable-runtime.ts`
- `tests/runtime/executable-runtime.test.ts`

예상:

- H1이 맞다면 승인 흐름이 이미 단계별 타입과 테스트로 분리되어 있어야 한다.

관찰:

- `ApprovalWorkflowHandoff`, `ApprovalRequestHandoff`, `ApprovalDecisionHandoff`, `ApprovalReleaseHandoff` 타입이 분리돼 있었다.
- 테스트는 승인 필요 시 `decision.recorded_by`, `recorded_at`를 채우지 않은 상태에서 승격이 막혀야 한다는 점까지 고정하고 있었다.

### Experiment B: 저장소 밖 의존성 확인

다음 문서를 직접 읽었다.

- `docs/m5-operational-parity-assessment.md`
- `DECISIONS/2026-03-31-control-plane-workspace-routing.md`

예상:

- H2가 맞다면 실제 승인 제품 표면과 control-plane 기능은 저장소 밖 범위로 이미 분리돼 있어야 한다.

관찰:

- 두 문서 모두 이 저장소가 참조 runtime이며, 실제 control-plane 제품 코드는 포함하지 않는다고 적고 있었다.
- 따라서 승인 UI, 승인 기록 영속화, 권한 있는 승격 API는 이번 저장소 안에서 구현할 대상이 아니다.

## Decision

1. 승인 handoff의 저장소 안 정본 계약은 계속 `run-result.json#verification_handoff.approval_workflow`로 둔다.
2. `request`는 승인 요청 산출물, `decision`은 외부 승인 결과 산출물의 자리, `release`는 승격 전 체크리스트로 해석을 고정한다.
3. 저장소는 승인 필요 여부 계산, 요청 근거 경로 기록, 권한 없는 승격 차단, 입력 신뢰 경계 기록까지만 책임진다.
4. control-plane 연동 이슈는 승인 수집, 승인자 기록, 승인 결과 영속화, `approval:grant` 권한으로 승격 재시도만 구현하면 된다.
5. 위 경계는 새 문서 `docs/approval-workflow-handoff-contract.md`에 재현 명령과 함께 고정한다.

## Why

- 이미 존재하는 계약을 다시 설계하는 것은 중복 작업이다.
- 지금 필요한 것은 제품 표면 구현보다, 어떤 값을 누가 언제 채우는지의 감사 가능한 경계다.
- 이 경계가 고정돼야 후속 control-plane 연동이 산출물 소비 작업으로 바뀌고, 해석 싸움이 줄어든다.

## Consequences

- 후속 승인 연동 이슈는 `request`, `decision`, `release` 의미를 다시 논의하지 않고 구현에 들어갈 수 있다.
- 저장소 안 구현은 계속 참조 runtime 역할에 집중하고, 실제 운영 제어 표면은 별도 제품 코드베이스 또는 후속 통합 이슈에서 처리한다.
- 이후 이 경계를 깨는 변경이 필요하면, 새 결정 기록과 replacement path(대체 경로)를 남겨야 한다.

## Reproduction Evidence

다음 명령으로 같은 사실을 재검증할 수 있다.

```bash
sed -n '1,220p' src/runtime/executable-runtime.ts
sed -n '1,260p' tests/runtime/executable-runtime.test.ts
sed -n '1,220p' docs/m5-operational-parity-assessment.md
npm run runtime:fixture
```

검증 작업공간:

- `/Users/nitro/.paperclip/instances/default/projects/77a731a6-117c-4b42-82a6-57690ba2c470/92c5daa1-5943-4f07-bd18-52ad8b154566/agent-tactics-system`
