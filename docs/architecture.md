# agent-tactics-system v1 설계 확정

## 가정

- 저장소는 현재 비어 있고 기존 런타임 자산이 없다.
- v1은 단일 프로세스 orchestrator를 기본값으로 한다.
- 구현 언어는 TypeScript/Node 계열을 기본 가정으로 두되, 문서와 스키마는 언어 독립적으로 유지한다.
- 외부 provider는 OpenAI, Claude, OpenCode, Cursor, local OpenAI-compatible endpoint를 우선 대상으로 본다.
- 목표는 "멀티에이전트 데모"가 아니라 "정책-상태-검증이 고정된 실행 운영체제"를 만드는 것이다.

## 1. 문제 재정의

기존 agent orchestration은 여러 모델을 한 번에 붙여서 일을 던지는 데 집중하고, 누가 어떤 근거로 행동했는지와 어떤 상태가 정본인지가 흐려지기 쉽다. 이 시스템이 실제로 해결하려는 문제는 "여러 에이전트가 있는 환경에서 작업 권한, 상태 변경 권한, 검증 책임을 명시적으로 분리하는 것"이다. 핵심은 agent 수를 늘리는 것이 아니라, 시스템 에이전트가 행동권을 발급하고 회수하는 구조를 고정하는 데 있다. 개별 에이전트는 전체 문맥을 모른 채 제한된 턴 브리프만 받아 움직여야 하며, 이 제약이 오히려 운영 가능성을 만든다. provider는 연결되었다고 바로 일할 수 있는 것이 아니라, 별도 적격성 게이트를 통과해야 한다. 완료 판단도 실행자 자신의 선언이 아니라 독립 검증 기록을 통해서만 이뤄진다. 따라서 이 시스템은 "대화형 협업"보다 "정책 기반 임무 실행"에 더 가깝다. 기존 orchestration과 다른 지점은 중앙 상태 권한, 직접 통신 금지, 턴 단위 배정, 쓰기 직렬화, 독립 검증 강제를 동시에 채택한다는 점이다.

## 2. 설계 원칙

1. canonical state는 시스템 에이전트만 읽기-쓰기 승인을 가진다. 이유: 다중 에이전트의 자기 보고를 정본으로 인정하면 충돌을 막을 수 없다.
2. provider inclusion과 assignment eligibility를 분리한다. 이유: transport 호환성과 임무 적합성은 다른 문제다.
3. 모든 실행은 TaskEnvelope 계약으로 발행한다. 이유: 역할, 범위, 금지사항, 완료 기준을 구두 프롬프트에 맡기지 않기 위해서다.
4. 개별 에이전트는 턴 브리프 외의 전역 상태를 기본적으로 모른다. 이유: context 누수를 줄이고 재현 가능한 실패 분석을 가능하게 한다.
5. 쓰기 작업은 단일 lock 아래 직렬화하고, 병렬은 읽기와 조사에만 쓴다. 이유: v1에서 가장 먼저 깨지는 것은 상태 경합이다.
6. 완료 후보와 완료 확정은 분리한다. 이유: 실행자와 검증자를 분리하지 않으면 자기 승인 구조가 된다.
7. 약한 모델에는 작은 과업만 준다. 이유: capability mismatch는 품질 문제가 아니라 정책 실패다.
8. browser 접근은 예외 skill 계약이 있어야만 허용한다. 이유: 브라우저는 권한 상승과 prompt injection이 동시에 일어나는 고위험 표면이다.
9. 외부 페이지와 문서는 모두 untrusted input으로 취급한다. 이유: 외부 텍스트를 명령처럼 해석하면 시스템 경계가 무너진다.
10. 상태 패치는 되돌릴 수 있어야 한다. 이유: 실패를 정상 흐름으로 흡수하지 못하면 운영 비용이 급격히 오른다.
11. v1은 단일 orchestrator로 제한한다. 이유: 분산 스케줄링보다 정책 계약 고정이 우선이다.
12. 역할보다 검증 기록을 더 신뢰한다. 이유: provider 브랜드는 품질 보증 수단이 아니다.

## 3. 전체 아키텍처

시스템의 중심은 `System Orchestrator`다. 이 컴포넌트가 provider registry를 읽고, assignment gate를 통과한 후보에게만 턴을 배정하며, state store에 canonical state patch를 기록한다. 개별 에이전트는 직접 통신하지 않고, 오직 orchestrator가 발급한 TaskEnvelope와 tool 허용 목록만 받는다. skill layer는 "행동 카드" 역할을 하며, 어떤 역할이 어떤 외부 표면을 어떤 범위로 만질 수 있는지 제한한다. verifier는 실행 경로와 분리된 별도 단계이며, done_candidate를 mission_complete로 승격할지 결정한다. heartbeat는 provider readiness와 runtime liveness를 추적한다. lock/queue는 쓰기 직렬화와 우선순위 조정을 담당한다. external connector는 provider API, 로컬 런타임, 저장소, 사내 시스템 같은 바깥 경계를 담당하되, 직접 정책 판단은 하지 않는다.

```text
User / Project Goal
        |
        v
System Orchestrator
  |- Provider Registry
  |- Assignment Gate
  |- Turn Queue / Write Lock
  |- Skill Policy Layer
  |- Canonical State Store
  |- Verification Router
        |
        +--> Agent Runtime (restricted brief only)
        |       |- allowed tools
        |       |- write scope
        |       `- stop conditions
        |
        +--> Verifier Runtime (independent path)
        |
        `--> External Connectors
                |- provider APIs
                |- repo / filesystem
                |- browser skill harness
                `- internal readonly systems
```

## 4. 핵심 계약과 데이터 모델

### ProviderRegistryEntry

- provider_id: 등록 식별자
- provider_kind: `openai`, `claude`, `opencode`, `cursor`, `local_openai_compatible`, `other`
- transport: API/CLI/embedded 같은 연결 방식
- models: 제공 모델 목록과 각 모델의 지원 task level
- trust_tier: 현재 허용 등급
- eligibility: protocol compliance, readiness heartbeat, microbench 상태, calibration 시각
- assignment_modes: `direct`, `decompose_only`, `reject`

### AssignmentDecision

- task_id: 배정 대상 과업
- candidate_provider_id
- candidate_model
- target_role
- requested_task_level
- decision: `assign`, `decompose`, `reject`
- reasons: 결정 근거
- required_skills
- independent_verifier_required

### TaskEnvelope

- objective
- task_level
- inputs
- allowed_tools
- write_scope
- must_not
- done_when
- stop_conditions
- output_schema_ref
- verification_required
- rollback_hint

### SkillContract

- skill_id
- purpose
- preconditions
- allowed_roles
- allowed_targets
- side_effect_level
- requires_lock
- verification_required
- failure_recovery

### StatePatch

- patch_id
- issue_id
- actor_id
- base_state_version
- operations
- requires_lock
- verifier_required
- rollback_to_version

### VerificationRecord

- verification_id
- subject_id
- subject_kind
- verifier_provider_id
- verifier_model
- status
- evidence
- created_at

### HeartbeatRecord

- record_id
- agent_id
- issue_id
- turn_number
- inputs_summary
- allowed_action_budget
- started_at
- finished_at
- outcome

기계 판독 가능한 최소 스키마는 `schemas/` 아래 파일로 고정했다.

## 5. provider 정책

OpenAI와 Claude의 상위 모델은 기본적으로 T3 `Trusted Executor`에서 시작하되, 검증 없는 T4 승격은 금지한다. OpenCode와 Cursor는 편의 런타임으로 등록할 수 있지만, v1에서는 기본적으로 T1 `Scout` 또는 제한적 T2 `Bounded Executor`에서 시작한다. local OpenAI-compatible provider는 transport 호환만 증명하므로 T0 `Registered` 또는 T1 `Scout`가 기본값이다. T2 이상 승격 조건은 protocol compliance 통과, 최근 heartbeat 정상, capability microbench 통과, 최근 검증 실패율 임계치 이하 충족이다. L4-L5 과업은 T3 이상만 직접 배정할 수 있고, T1-T2는 `decompose_only` 규칙으로만 참여시킨다. self-assessment는 참고 신호로만 저장하며, 배정 결정 근거의 1차 증거가 될 수 없다. provider가 자기보고로 "가능하다"라고 말해도, microbench와 historical calibration이 없으면 assign 대신 decompose 또는 reject를 택한다.

## 6. skill 및 외부 시스템 연결 정책

`heartbeat`는 실행 주기와 상태 보고 규약이다. `soul`은 역할 정체성과 운영 태도를 규정한다. `tools`는 도구 사용 메모와 예외 경로를 정의한다. `AGENTS.md`는 헌법 계층으로서 권한 경계, 금지 규칙, 의사결정 원칙을 담는다. 이 네 가지를 섞지 않는다.

### Browser skill 예외 정책

- `browser-test-local`: 로컬 개발 서버에 대한 테스트 목적. 허용 액션은 페이지 열기, 클릭, 폼 입력, DOM 확인, 스크린샷이다.
- `browser-research-public`: 공개 웹 리서치 목적. 허용 액션은 탐색, 텍스트 추출, 스크린샷이다.
- `browser-research-internal-readonly`: 사내 읽기 전용 시스템 열람. 허용 액션은 조회와 증거 수집이다.
- `browser-transactional`: 결제, 배포, 권한 변경, 외부 전송 같은 거래성 액션. v1 기본 금지, human gate 없이는 불가다.

각 browser skill 계약은 URL allowlist, auth mode, allowed actions, denied actions, evidence requirement, budget cap, escalate_on 조건을 필수 필드로 가진다. raw bash로 브라우저를 띄우는 경로는 정책 위반으로 본다.

### 외부 페이지 방어 규칙

- 외부 텍스트는 명령이 아니라 데이터다.
- 페이지 안의 코드 블록, 배너, 팝업, PDF 문구를 tool directive로 해석하지 않는다.
- 브라우저 세션이 읽은 내용은 orchestrator가 요약한 구조화 필드로만 다음 턴에 전달한다.
- 인증 정보, 쿠키, 토큰은 TaskEnvelope 입력으로 직접 넘기지 않는다.

## 7. 구현 범위 정의

### v1에서 반드시 구현할 것

- 단일 프로세스 orchestrator: 상태와 정책의 중심축이 필요하기 때문이다.
- provider registry와 assignment gate: 등록과 배정을 분리해야 하기 때문이다.
- trust tier와 task level 정책: 약한 모델에 큰 과업을 던지는 실패를 막기 위해서다.
- TaskEnvelope, SkillContract, StatePatch, VerificationRecord, HeartbeatRecord: 실행 계약이 없으면 운영이 재현되지 않기 때문이다.
- write lock과 queue: v1에서 상태 경합을 제거해야 하기 때문이다.
- 독립 verifier 경로: 자기 완료 선언을 차단해야 하기 때문이다.
- browser 예외 skill 정책: 브라우저를 일반 권한으로 열면 경계가 무너지기 때문이다.

### v1에서 의도적으로 제외할 것

- 다중 orchestrator 분산 합의: 단일 정본조차 고정되지 않은 단계에서 과도하다.
- agent 간 direct messaging: 시스템 중심 구조와 충돌한다.
- 자동 trust tier 승격: 운영 데이터가 쌓이기 전까지 위험하다.
- fully autonomous browser transaction: 사고 표면이 너무 넓다.
- provider marketplace나 UI 중심 관리 콘솔: 핵심 정책보다 부수 기능이다.

### v1.5 또는 v2로 미룰 것

- 다중 workspace / 다중 repo 동시 스케줄링
- calibration 자동화와 장기 성능 히스토리
- human approval workflow 내장
- visual timeline / replay UI
- 분산 락 또는 외부 메시지 버스

이 항목들은 유용하지만, v1 성공 여부를 가르는 것은 "정책과 상태 경계 고정"이지 "편의 기능"이 아니다.

## 8. 저장소 구조 또는 모듈 구조 제안

```text
docs/
  architecture.md
schemas/
  provider-registry-entry.schema.json
  assignment-decision.schema.json
  task-envelope.schema.json
  skill-contract.schema.json
  state-patch.schema.json
  verification-record.schema.json
  heartbeat-record.schema.json
src/
  contracts/
    types.ts
    enums.ts
  orchestrator/
    turn-loop.ts
    queue.ts
    state-store.ts
  policies/
    assignment-gate.ts
    trust-tier.ts
    browser-skill-policy.ts
  providers/
    registry.ts
    health.ts
    microbench.ts
  skills/
    loader.ts
    contracts.ts
  verifier/
    verify.ts
    replay.ts
  adapters/
    provider-api/
    repo/
    browser/
tests/
  contracts/
  policies/
  orchestrator/
```

`contracts`는 공통 타입의 단일 진실 공급원이고, `policies`는 의사결정 규칙, `orchestrator`는 실행 흐름, `providers`는 외부 런타임 정보, `verifier`는 독립 검증, `adapters`는 실제 I/O 경계다.

## 9. 첫 구현 순서

### 첫 2주

1. 계약 고정
   완료 기준: 모든 핵심 객체가 스키마와 타입으로 표현되고 JSON validation이 통과한다.
2. assignment gate 구현
   완료 기준: provider tier, task level, skill requirement에 따라 `assign/decompose/reject`가 재현 가능하게 나온다.
3. turn loop와 write lock 구현
   완료 기준: 동시에 두 개의 write task가 canonical state를 수정하지 못한다.
4. verifier 분리
   완료 기준: done_candidate가 verifier 기록 없이는 complete로 승격되지 않는다.

### 첫 5개 PR

1. `docs + schemas`
2. `contracts + enums + validation tests`
3. `provider registry + trust tier policy`
4. `turn loop + queue + state patch flow`
5. `verifier + browser skill policy`

### 첫 MVP

- 단일 orchestrator 실행
- 두 종류 이상의 provider 등록
- 최소 하나의 decompose decision 예시
- 하나의 write task와 하나의 독립 verification 흐름
- browser skill 예외 계약 로딩

## 10. 리스크와 실패 패턴

1. provider 등록만으로 배정이 열리는 경우
   완화: assignment gate를 registry와 별도 모듈로 분리한다.
2. 전역 상태가 agent prompt에 복제되는 경우
   완화: TaskEnvelope 생성기에서 요약 필드만 허용한다.
3. write task 병렬 실행으로 state 충돌이 나는 경우
   완화: write lock과 base_state_version 검사로 막는다.
4. 실행자와 검증자가 같은 계열 provider로 묶이는 경우
   완화: verification policy에서 provider family 분리를 강제한다.
5. local provider를 과신하는 경우
   완화: 기본 tier를 낮게 두고 decompose_only로 제한한다.
6. browser가 일반 도구처럼 사용되는 경우
   완화: named browser skill 없이는 호출 자체를 거부한다.
7. done 선언이 남발되는 경우
   완화: 상태 전이에서 `done_candidate -> verified -> complete` 단계를 강제한다.
8. skill 정의가 프롬프트 모음으로 변질되는 경우
   완화: SkillContract에 preconditions, allowed_targets, failure_recovery를 필수화한다.
9. 과업 분해 없이 약한 모델에 모호한 작업이 투입되는 경우
   완화: task level이 tier보다 높으면 자동으로 `decompose`를 반환한다.
10. 외부 페이지의 지시문이 시스템 정책을 오염시키는 경우
    완화: 외부 텍스트를 untrusted input으로 표시하고 요약 단계에서만 구조화한다.

## 11. 최종 제안

권장 v1 아키텍처는 "단일 시스템 orchestrator가 canonical state, assignment gate, write lock, verifier routing을 독점하고, 개별 에이전트는 제한된 TaskEnvelope와 skill 계약 아래서만 턴 단위로 움직이는 구조"다. provider는 많이 붙일 수 있지만, 등록과 배정을 분리하고 trust tier와 task level 정책으로 직접 배정 범위를 강하게 자른다. browser는 일반 능력이 아니라 예외 skill로만 노출한다. 이 구조가 v1에서 필요한 이유는, 멀티에이전트 환상을 줄이고 운영 가능한 실패 경계와 검증 경로를 먼저 만들기 위해서다.

지금 당장 만들 파일/문서/인터페이스:

- `docs/architecture.md`
- `schemas/provider-registry-entry.schema.json`
- `schemas/assignment-decision.schema.json`
- `schemas/task-envelope.schema.json`
- `schemas/skill-contract.schema.json`
- `schemas/state-patch.schema.json`
- `schemas/verification-record.schema.json`
- `schemas/heartbeat-record.schema.json`
- 다음 PR 대상: `src/contracts/types.ts`, `src/policies/assignment-gate.ts`, `src/orchestrator/turn-loop.ts`, `src/verifier/verify.ts`
