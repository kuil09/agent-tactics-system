# M5 운영 기능 대체 수준 검증

## 검증 기준

- 기준 이슈: [NIT-55](/NIT/issues/NIT-55)
- 상위 계획: [NIT-25 계획 문서](/NIT/issues/NIT-25#document-plan)
- 저장소 기준선:
  - 작업공간: `/Users/nitro/.paperclip/instances/default/projects/77a731a6-117c-4b42-82a6-57690ba2c470/92c5daa1-5943-4f07-bd18-52ad8b154566/agent-tactics-system`
  - 브랜치: `codex/publish-m1-runtime-slice`
  - 커밋: `1e29ea99d974b7a711fae53a8bd68b2b5f9430e9`

이 문서는 현재 저장소 구현이 operational parity(실제 운영 대체 가능 수준)에 어디까지 도달했는지 확인하기 위해 작성했다. 비교 기준은 README의 `Next Milestone`, `Verification`, `Current Implementation Scope`와 아키텍처 문서의 v1 범위 정의다.

## 실행 검증

다음 명령을 2026-04-01 KST에 현재 작업공간에서 직접 실행했다.

```bash
npm run runtime:fixture
npm run runtime:fixture -- --scenario=failure
npm run typecheck
npm test
npm run test:coverage
```

확인 결과:

- 성공 fixture는 `artifacts/runtime-fixtures/success/run-result.json`에 `promotion_gate=waiting_for_human_approval_and_independent_verifier`를 남긴다.
- 실패 fixture는 `artifacts/runtime-fixtures/failure/run-result.json`에 `promotion_gate=rollback_and_requeue_recorded`와 `repo_restore`, `state_rollback`, `issue_requeue` 복구 단계를 남긴다.
- `typecheck`, `test`, `test:coverage`는 모두 통과했다.
- `test:coverage`는 statements, branches, functions, lines 모두 100%를 기록했다.

## 현재 저장소가 대체 가능한 범위

현재 구현은 "단일 작업공간 기준 참조 런타임" 수준에서는 충분히 강하다.

- 단일 작업공간(workspace, 작업 공간)에서 heartbeat(실행 주기 입력) -> 실행 -> 검증 handoff(인계 기록) -> 복구까지 하나의 재현 가능한 흐름을 제공한다.
- 승인 게이트는 실제 승격을 닫아 둔 채 `done_candidate`까지만 진행시키고, `approval:grant` 권한과 승인 산출물 없이는 완료로 올리지 않는다.
- 외부 입력은 `untrusted_external_input`로 분리 기록해 입력 경계를 남긴다.
- 실패 시 저장소 스냅샷 복원, 상태 롤백, 재대기 기록이 남아 운영 복구 증거로 쓸 수 있다.
- 테스트와 커버리지가 참조 런타임 경계를 강하게 고정하고 있어, 이 저장소 자체의 회귀 검출력은 충분하다.

정리하면 이 저장소는 "Paperclip의 전체 운영 시스템"을 대체하는 수준이 아니라, 그 안에서 가장 위험한 실행 경계인 실행 계약, 검증 인계, 승인 차단, 복구 기록을 재현하는 reference implementation(참조 구현)으로는 유효하다.

## 아직 대체하지 못하는 범위

아래 영역은 현재 저장소만으로는 현행 Paperclip을 실제 운영에서 대체할 수 없다.

### 1. 실제 provider handshake(제공자 연결 절차)와 운영 연결

- README의 `Next Milestone` 첫 항목이 아직 "fixture provider를 real adapter handshake로 교체"라고 남아 있다.
- 현재 산출물의 `provider_handshake.protocol_version=provider-module-v1`은 확인되지만, 실제 외부 제공자와의 운영 연계 증거는 없다.

### 2. first-class approval workflow(정식 승인 워크플로) 부재

- README와 아키텍처 문서는 현재 승인이 minimum gate artifact(최소 승인 기록물) 수준이라고 명시한다.
- 즉, 승인 기록 구조는 있지만 실제 운영 제어 흐름 안에서 사람 승인 요청, 승인 수집, 상태 승격을 닫는 제품 표면은 아직 없다.

### 3. 다중 작업공간 및 다중 저장소 운영

- 아키텍처 문서는 `다중 workspace / 다중 repo 동시 스케줄링`을 v1.5 또는 v2 이후 범위로 미뤘다.
- 현재 구현은 단일 작업공간 참조 흐름 1개를 안정적으로 재현하는 데 초점을 맞춘다.

### 4. Paperclip control-plane(운영 제어 서버) 기능

- 이 저장소에는 실제 inbox(할당 받은 작업함), issue lifecycle(이슈 상태 흐름), checkout API(작업 잠금 API), 댓글, 승인, 프로젝트 관리 같은 control-plane 제품 코드가 없다.
- `DECISIONS/2026-03-31-control-plane-workspace-routing.md`도 같은 결론을 이미 기록한다.
- 따라서 현행 Paperclip 운영 전체를 이 저장소만으로 cutover(기존 시스템을 새 시스템으로 전환)하는 것은 범위 오류다.

## CTO 판단

M5 결론은 아래와 같다.

- `verified-shared`: 단일 작업공간 참조 런타임의 실행, 검증 인계, 승인 차단, 롤백/재대기 기록은 공유 검증 기준을 충족한다.
- `verified-local`: 2026-04-01 KST 기준 현재 작업공간에서 fixture 2종, 타입체크, 테스트, 커버리지 100%를 재현했다.
- `blocked`: 실제 운영 대체는 control-plane 부재, 실제 provider 연계 부재, 정식 승인 워크플로 부재, 다중 작업공간 미지원 때문에 아직 불가하다.
- `needs-evidence`: M6 컷오버 준비에서는 이 저장소 바깥 의존성인 control-plane 소유 코드베이스와 승인 제품 표면을 별도 증거로 확인해야 한다.

즉, 현재 저장소는 "운영 대체를 위한 핵심 실행 경계 검증"까지는 통과했지만, "현행 Paperclip 전체 운영 전환" 수준에는 아직 도달하지 못했다.

## 필요한 후속 기술 실행

1. fixture provider를 실제 adapter handshake로 교체하면서 현재 산출물 계약을 유지하는 실행 이슈
2. 다중 파일 변경과 provider 쪽 부분 쓰기까지 포함하는 복구 계약 확장 이슈
3. 최소 승인 기록물을 실제 승인 워크플로 handoff로 교체하는 실행 이슈
4. M6에서 control-plane 외부 의존성과 cutover 경계를 별도 체크리스트로 고정하는 준비 이슈
