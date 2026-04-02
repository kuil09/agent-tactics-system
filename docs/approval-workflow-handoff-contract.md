# Approval Workflow Handoff(승인 인계 기록) 계약

## 목적

이 문서는 `run-result.json#verification_handoff.approval_workflow`가 이미 노출하는 승인 workflow(승인 절차) 구조를 control-plane(운영 제어 서버) 연동 직전 수준까지 고정하기 위해 작성했다.

목표는 두 가지다.

1. 저장소 안에서 이미 책임지는 산출물과 상태 전이를 단계별로 명시한다.
2. 이후 control-plane 연동 이슈가 생겨도 어떤 입력을 받아 무엇을 써야 하는지 다시 해석하지 않도록 경계를 고정한다.

## 관찰 사실

- `src/runtime/executable-runtime.ts`는 `verification_handoff.approval_workflow` 아래에 `request`, `decision`, `release` 세 단계를 항상 같은 구조로 기록한다.
- 승인 요구 여부는 `TaskEnvelope.verification_required`에서 파생된다. 즉 저장소는 "승인이 필요한가"를 독자적으로 판정할 수 있다.
- 저장소는 실제 승인 결정을 기록하지 않는다. 현재 `decision.recorded_by`, `decision.recorded_at`는 `null`이며, `decision.decision_artifact_path`만 계약으로 예약한다.
- 저장소는 승인을 받지 못한 상태에서 promotion(승격)을 막는다. 이 차단 근거는 `verification_handoff.governance.authorization_boundary`와 `approval_gate`에 함께 남는다.

## 가설과 반증

### H1

현재 부족한 것은 승인 구조 자체가 아니라, 저장소 책임과 control-plane 책임을 분리한 문서 계약이다.

반증 기준:

- 코드상 `request`, `decision`, `release` 중 하나라도 입력이나 출력 의미가 모호해 단계별 책임을 구분할 수 없으면 H1은 틀리다.

확인:

- 각 단계는 이미 별도 타입과 필드로 분리돼 있어, 문서 계약만 추가하면 책임 경계를 고정할 수 있다.

### H2

control-plane 연동 직전까지 필요한 입력 계약은 "저장소가 남기는 승인 요청 산출물"과 "외부가 채워 넣어야 하는 승인 결정 산출물"을 분리해 적으면 충분하다.

반증 기준:

- 연동에 필요한 값 중 저장소와 외부 어느 쪽 책임인지 불명확한 필드가 남아 있으면 H2는 틀리다.

확인:

- 현재 남은 외부 의존성은 승인 수집, 권한 부여, 승격 재시도이며, 모두 저장소 밖 책임으로 분리할 수 있다.

## 단계별 계약

| 단계 | 저장소가 쓰는 것 | 저장소 입력 | 외부 입력 | 외부 책임 | 단계 종료 조건 |
| --- | --- | --- | --- | --- | --- |
| `request` | `request.request_artifact_path`, `request.summary`, `request.required_evidence`, `request.validation_commands`, `request.issued_at` | `TaskEnvelope`, verification replay(검증 재생 기록), `runtime.log`, input defense(입력 신뢰 경계) | 없음 | control-plane은 이 산출물을 사람 승인자에게 전달한다 | 승인 요청이 사람이 읽을 수 있는 표면으로 노출된다 |
| `decision` | `decision.decision_artifact_path`, `decision.resolution_criteria`, `decision.blocked_reason` | 승인 필요 여부, 승격 차단 사유 | 실제 승인 여부, 승인자 신원, 승인 시각 | control-plane은 승인 결정을 기록하고 `recorded_by`, `recorded_at`를 채운다 | 승인 또는 거절 결정 산출물이 생긴다 |
| `release` | `release.promotion_action`, `release.release_blocked`, `release.blockers`, `release.unblock_checklist`, `release.next_owner` | 승인 상태, recovery(복구 기록) 상태, authorization boundary(권한 경계) | `approval:grant` 권한으로 재시도한 승격 결과 | control-plane은 승인 후 승격 재시도와 최종 상태 전이를 수행한다 | `done_candidate`에서 `complete`로 승격되거나, 재실행 경로로 되돌린다 |

## 저장소 안 책임

저장소는 다음까지만 책임진다.

1. 승인 요구 여부를 `verification_required`로부터 계산한다.
2. 승인 요청에 필요한 근거 경로와 검증 명령을 `request`에 적는다.
3. 실제 승인 전에는 `authorization_boundary`로 승격을 차단한다.
4. 외부 입력을 `input_defense`에 신뢰 구역별로 기록한다.
5. 복구가 개입된 경우 `blocked_by_recovery`로 승인 흐름을 닫고, 재실행 전 검토 항목을 `release`에 남긴다.

저장소는 다음을 책임지지 않는다.

- 사람 승인 UI(User Interface, 사람이 보는 화면) 제공
- 승인 알림 전송
- 승인자 인증 및 권한 관리
- `approval:grant` 권한이 실린 실제 승격 API(Application Programming Interface, 프로그램 호출 규약) 실행
- 승인 거절 후 재분해나 재할당 정책

## control-plane 바깥 의존성

control-plane 연동 이슈는 아래 항목만 구현하면 된다.

1. `request.request_artifact_path`가 가리키는 승인 요청 산출물을 읽어 사람이 검토할 수 있는 표면에 노출한다.
2. 승인자가 내린 결정을 `decision.decision_artifact_path`에 대응하는 제품 산출물로 영속화한다.
3. 승인 결정을 기록한 주체와 시각을 남긴다.
4. 승인 후 `approval:grant` 권한으로 승격을 다시 시도한다.
5. 거절 또는 복구 상태에서는 `release.blockers`와 `release.unblock_checklist`를 운영 액션으로 연결한다.

이 다섯 가지는 저장소 안에서 미리 구현하지 않는다. 이유는 현재 저장소가 참조 runtime(참조 런타임)이지 실제 control-plane 제품 표면을 포함하지 않기 때문이다.

## 고정된 입력 계약

후속 연동은 아래 경로를 그대로 소비하면 된다.

### request 단계 필수 입력

- `run-result.json#verification_handoff.replay`
- `run-result.json#verification_handoff.governance.input_defense`
- `workspace/artifacts/runtime.log`
- `run-result.json#verification_handoff.approval_workflow.request.validation_commands`

### decision 단계 필수 입력

- `run-result.json#verification_handoff.approval_workflow.request`
- `run-result.json#verification_handoff.approval_workflow.decision.resolution_criteria`
- 사람 승인자 결정 산출물

### release 단계 필수 입력

- `run-result.json#verification_handoff.approval_workflow.decision`
- `run-result.json#verification_handoff.approval_workflow.release`
- `run-result.json#verification_handoff.governance.authorization_boundary`
- 필요 시 `run-result.json#verification_handoff.recovery`

## 연동 시 바꾸지 말아야 할 것

후속 control-plane 연동에서도 아래 의미는 유지한다.

- `request`는 승인 요청 산출물이다. 승인 결과 저장소가 아니다.
- `decision`은 사람 승인 결과 산출물의 자리다. 실행자가 자기 자신을 승인자로 기록하면 안 된다.
- `release`는 승격 실행 전 체크리스트다. 승인 그 자체를 대체하지 않는다.
- `approval:grant` 없는 승격은 계속 실패해야 한다.
- 외부 텍스트는 계속 `untrusted_external_input`로 취급해야 한다.

## 재현과 검증

작업공간:

- `/Users/nitro/.paperclip/instances/default/projects/77a731a6-117c-4b42-82a6-57690ba2c470/92c5daa1-5943-4f07-bd18-52ad8b154566/agent-tactics-system`

검증 명령:

```bash
npm run runtime:fixture
npm run typecheck
npm test
```

확인 포인트:

1. `artifacts/runtime-fixtures/success/run-result.json`에 `verification_handoff.approval_workflow.request`, `decision`, `release`가 모두 존재해야 한다.
2. `verification_handoff.governance.authorization_boundary.allowed`는 승인 필요 시 `false`여야 한다.
3. `verification_handoff.approval_workflow.decision.recorded_by`와 `recorded_at`는 여전히 `null`이어야 한다. 이 값은 control-plane이 채울 외부 책임이기 때문이다.
