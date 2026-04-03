# Decision Record: M5 런타임 handoff(전달본) 로컬 검증 패키지 고정

- Date: 2026-04-03
- Owner: CTO
- Related issues: [NIT-66](/NIT/issues/NIT-66), [NIT-84](/NIT/issues/NIT-84), [NIT-85](/NIT/issues/NIT-85)

## Context

현재 `agent-tactics-system` 작업공간에는 세 가지 변경 축이 함께 존재한다.

1. 종결 상태(`done`, `cancelled`) 전이 시 checkout(작업 잠금) 자동 해제 규칙
2. 다중 작업공간 routing(작업공간 선택) 규칙과 런타임 산출물 연결
3. 운영자용 dashboard(작업함 첫 화면), issue workbench(이슈 작업대), approval workbench(승인 작업대) 최소 화면

이번 heartbeat(짧은 실행 주기)에서 확인한 사실은 다음과 같다.

- 현재 브랜치는 `codex/publish-m5-runtime-handoff`이고 기준 커밋은 `969f9cb`다.
- 아직 공유 커밋(commit, 저장소에 고정된 변경 묶음)은 없으므로, 지금 시점의 재현 가능한 handoff는 "정확한 작업공간 경로 + 브랜치명 + 검증 명령" 형태여야 한다.
- 추적 중인 변경 파일은 6개이고, 새로 추가된 미추적 파일은 13개다.
- `artifacts/runtime-fixtures/` 아래에는 검증 중 생성된 `success/run-result.json`, `failure/run-result.json`만 남아 있으며, 이는 공유 소스가 아니라 로컬 검증 산출물이다.

## Hypotheses

1. H1: 현재 단계에서는 공유 커밋이 없어도 정확한 작업공간 경로, 브랜치, 파일 범위, 검증 명령을 함께 남기면 재현 가능한 로컬 handoff가 된다.
2. H2: 현재 변경 묶음은 코드 수준에서는 이미 일관적이며, 남은 위험은 병합과 실제 control-plane(운영 제어 서버) 적용 범위에 있다.
3. H3: 실제 `done` 상태 재깨움 결함의 완전한 수정은 이 저장소 바깥의 control-plane 서버 코드까지 같은 종결 상태 정리 규칙을 가져가야 끝난다.

## Falsification Checks

H1과 H2를 깨기 위해 아래 명령을 직접 실행했다.

```bash
npm test -- --run tests/control-plane/issue-service.test.ts tests/control-plane/dashboard.test.ts tests/control-plane/issue-workbench.test.ts tests/control-plane/approval-workbench.test.ts tests/control-plane/workspace-routing.test.ts tests/runtime/cli.test.ts
npm run typecheck
npm test
npm run runtime:fixture
npm run runtime:fixture -- --scenario=failure
```

검증 결과:

- 표적 테스트 55개 통과
- 전체 테스트 137개 통과
- 타입 검사 통과
- 성공 시나리오와 실패 시나리오 모두 `run-result.json` 생성 확인
- `operator_summary.operational_flow`는 두 시나리오 모두 `workspace_routed_runtime_fixture`로 기록됐다

## Decision

1. 현재 변경 묶음은 `verified-local`(현재 작업공간에서 검증 완료) 상태로 취급한다.
2. 공유 handoff의 기준은 아래 네 요소를 함께 전달하는 것으로 고정한다.
   - 브랜치: `codex/publish-m5-runtime-handoff`
   - 기준 커밋: `969f9cb`
   - 작업공간: `/Users/nitro/.paperclip/instances/default/projects/77a731a6-117c-4b42-82a6-57690ba2c470/92c5daa1-5943-4f07-bd18-52ad8b154566/agent-tactics-system`
   - 검증 명령: 본 문서의 `Falsification Checks` 절
3. 현재 단계에서는 로컬 검증 산출물인 `artifacts/runtime-fixtures/*/run-result.json`를 공유 소스 범위에 포함하지 않는다.
4. 실제 운영 결함 수정의 완료 판정은 이 저장소 검증만으로 내리지 않는다. 외부 control-plane 서버에 같은 terminal-state cleanup(종결 상태 정리) 규칙이 적용됐는지 별도 확인이 필요하다.

## Included Change Surface

추적 중인 수정 파일:

- `README.md`
- `docs/control-plane-issue-surface.md`
- `src/control-plane/issue-service.ts`
- `src/runtime/cli.ts`
- `tests/control-plane/issue-service.test.ts`
- `tests/runtime/cli.test.ts`

새로 추가된 파일:

- `DECISIONS/2026-04-03-dashboard-inbox-minimum-slice.md`
- `DECISIONS/2026-04-03-done-issue-assignment-wake-runtime-defect.md`
- `DECISIONS/2026-04-03-frontend-product-engineer-instruction-bundle-parity.md`
- `DECISIONS/2026-04-03-frontend-product-engineer-reporting-line-and-initial-scope.md`
- `docs/control-plane-operator-ui-information-architecture.md`
- `src/control-plane/approval-workbench.ts`
- `src/control-plane/dashboard.ts`
- `src/control-plane/issue-workbench.ts`
- `src/control-plane/workspace-routing.ts`
- `tests/control-plane/approval-workbench.test.ts`
- `tests/control-plane/dashboard.test.ts`
- `tests/control-plane/issue-workbench.test.ts`
- `tests/control-plane/workspace-routing.test.ts`

## Why

- 공유 커밋이 없는 상태에서 "검증했다"는 말만 남기면 다음 담당자는 같은 상태를 다시 만들 수 없다.
- 현재 브랜치와 작업공간 경로, 명령 묶음을 함께 남기면 병합 전에도 누가 무엇을 검증했는지 추적 가능하다.
- 로컬 검증 산출물과 공유 소스를 분리해 두어야, 저장소에 남겨야 할 것과 다시 생성하면 되는 것을 혼동하지 않는다.

## Reproduction

작업공간 루트에서 아래 명령으로 같은 상태를 다시 확인할 수 있다.

```bash
git branch --show-current
git rev-parse --short HEAD
git status --short --branch
npm test
npm run typecheck
npm run runtime:fixture
npm run runtime:fixture -- --scenario=failure
```

검증 후 확인할 산출물:

- `artifacts/runtime-fixtures/success/run-result.json`
- `artifacts/runtime-fixtures/failure/run-result.json`

## Remaining Risk

- 아직 병합되지 않았으므로 `verified-shared`(공유 기준에서 검증 완료) 상태는 아니다.
- 실제 운영 제어 서버의 queue/scheduler(대기열/스케줄러) 계층이 같은 종결 상태 정리 규칙을 지키는지는 이 저장소만으로 증명되지 않는다.
- 따라서 현재 상태는 "로컬 검증 완료, 공유 전"으로 해석해야 한다.

## Operational Consequence

- 후속 담당자는 본 문서를 기준으로 같은 브랜치와 작업공간에서 즉시 재검증할 수 있다.
- 병합 전 리뷰는 이 문서의 포함 파일 범위를 기준으로 받아야 한다.
- 실제 control-plane 서버 코드 검토 없이 [NIT-84](/NIT/issues/NIT-84) 류 결함이 완전히 닫혔다고 판단하면 안 된다.
