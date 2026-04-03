# 운영 화면 정보 구조와 UI 흐름 정의

## 목적

이 문서는 현재 저장소가 이미 고정한 실행 계약 위에, 사람이 실제로 읽고 조치할 운영 화면의 정보 구조를 선행 정의하기 위해 작성했다.

목표는 세 가지다.

1. 새 프론트엔드 담당자가 구현 시작 전에 다시 범위를 해석하지 않도록 첫 화면 묶음을 고정한다.
2. 이슈, 승인, 실행 증거가 서로 다른 문서가 아니라 하나의 운영 흐름으로 연결되도록 화면 경계를 정한다.
3. 후속 구현 이슈가 화면 단위로 다시 쪼개질 수 있도록 공통 셸과 세부 작업대를 분리한다.

## 관찰 사실

- [`docs/architecture.md`](./architecture.md)는 v1에서 `UI 중심 관리 콘솔`과 `visual timeline / replay UI(시각적 실행 이력 화면)`를 의도적으로 제외했다. 즉 지금 필요한 것은 기존 설계와 충돌하는 새 제품이 아니라, 제품화 단계에서 추가할 운영 표면 정의다.
- [`docs/control-plane-issue-surface.md`](./control-plane-issue-surface.md)는 현재 저장소가 서비스 계층 수준의 이슈 상태, checkout(작업 잠금), 댓글 기록만 고정했다고 적고 있다.
- [`docs/approval-workflow-handoff-contract.md`](./approval-workflow-handoff-contract.md)는 승인 요청 `request`, 승인 결정 `decision`, 해제 전 체크리스트 `release`의 세 단계를 이미 산출물 계약으로 고정했다.
- [`docs/m5-operational-parity-assessment.md`](./m5-operational-parity-assessment.md)는 실제 운영 대체의 부족분으로 control-plane(운영 제어면) 제품 표면, 승인 표면, 다중 작업공간, cutover evidence(전환 증거)를 명시했다.
- 실제 산출물인 `artifacts/runtime-fixtures/*/run-result.json`은 `operator_summary`, `verification_evidence`, `verification_handoff`를 통해 사람이 읽어야 할 상태 요약, 다음 행동, 경로, 검증 명령, 복구 범위를 이미 제공한다.

## 가설과 판단

### H1

운영 화면의 중심 객체는 "실행 로그"가 아니라 "이슈"여야 한다.

- 반증 기준: 사람이 승인, 차단 해소, 재시도 판단을 이슈 없이 산출물만 보고 할 수 있어야 한다.
- 확인 결과: 현재 계약은 댓글, checkout, 승인, 실행 증거가 모두 이슈 또는 이슈에 연결된 산출물로 해석된다. H1은 살아남았다.

### H2

승인 화면은 이슈 상세 안에 완전히 묻히면 안 되고, 별도 작업대로도 접근 가능해야 한다.

- 반증 기준: 승인자는 이슈 스레드 전체를 읽지 않아도 결정 근거를 충분히 읽을 수 없어야 한다.
- 확인 결과: `request`, `decision`, `release`는 이미 독립 단계로 분리돼 있고, 승인자는 검증 명령과 승인 근거를 먼저 읽는 역할이다. H2는 살아남았다.

### H3

모바일은 "읽기와 승인" 정도까지만 1차 목표로 두고, 로그 탐색과 긴 댓글 작성은 데스크톱 우선으로 두는 편이 낫다.

- 반증 기준: 운영자가 모바일에서 장문의 로그와 경로, 검증 명령을 자주 작성·복사해야 해야 한다.
- 확인 결과: 현재 계약은 경로, 로그, 재생 기록, 복구 범위를 길게 보여주는 구조다. H3는 살아남았다.

## 사용자와 핵심 과업

| 사용자 | 지금 해야 하는 일 | 화면에서 바로 보여야 하는 것 |
| --- | --- | --- |
| 운영자 | 내 할당 이슈 확인, 차단 해소, 재시도 판단 | 상태, checkout 소유자, 최신 댓글, 다음 조치, 증거 경로 |
| 승인자 | 승인 요청 읽기, 승인 또는 거절 기록, 해제 조건 확인 | 요청 요약, 검증 명령, 입력 신뢰 경계, release blockers |
| 기술 책임자 | 실패 원인과 복구 범위 검토, 후속 이슈 분해 | recovery steps, residual risk, 재대기 이유, 관련 이슈 링크 |

## 공통 화면 원칙

- 모든 화면은 "현재 상태", "왜 이렇게 됐는지", "다음에 누가 무엇을 해야 하는지"를 같은 첫 화면 안에서 보여줘야 한다.
- 이슈 상태와 댓글 스레드는 별개가 아니라 같은 작업대 안에서 읽혀야 한다.
- `approval_workflow`, `input_defense`, `recovery` 같은 내부 계약 필드는 사람이 이해할 수 있는 한국어 라벨과 함께 노출한다.
- 파일 경로와 검증 명령은 숨기지 않는다. 운영 시스템에서는 추상 요약보다 재현 가능한 경로와 명령이 우선이다.

## 1차 화면 묶음

### 1. 작업함 요약 화면

목적: 지금 손봐야 할 이슈를 한눈에 고른다.

핵심 구성:

- 기본 목록: `identifier`, `title`, `status`, `priority`, `updatedAt`
- 보조 정보: 부모 이슈, 프로젝트명, 현재 실행 중 run(실행 기록) 여부
- 상태 필터: `in_progress`, `blocked`, `in_review`
- 빠른 경고: `blocked`인데 새 댓글이 달렸는지, checkout 충돌이 있는지, 승인 대기인지

데이터 기준:

- `/api/agents/me/inbox-lite`
- 필요 시 `/api/companies/{companyId}/issues?assigneeAgentId=...`

### 2. 이슈 작업대 화면

목적: 한 이슈에 대한 문맥, 스레드, 잠금 상태, 실행 증거, 다음 행동을 한 곳에서 읽는다.

권장 레이아웃:

- 좌측 상단: 상태 칩, 우선순위, assignee(담당자), 부모 이슈, 프로젝트
- 좌측 본문: 설명, ancestor summary(상위 이슈 요약), 최신 댓글 스레드
- 우측 상단: checkout 패널
- 우측 중단: 다음 조치 패널
- 우측 하단: 연결된 승인/실행 증거 요약

하위 탭:

1. `개요`
   - 배경, 범위, 완료 기준
   - 상위 이슈와 프로젝트 링크
2. `스레드`
   - 일반 댓글과 시스템 댓글을 시간순으로 함께 표시
   - 상태 변경, checkout 획득/해제 같은 시스템 이벤트를 별도 배지로 구분
3. `잠금과 실행`
   - checkout 소유자, run id, 잠금 시각
   - 충돌 시 왜 거절됐는지
4. `증거`
   - 연결된 `run-result.json`, `runtime.log`, 검증 명령, 입력 신뢰 경계

데이터 기준:

- `/api/issues/{issueId}`
- `/api/issues/{issueId}/heartbeat-context`
- `/api/issues/{issueId}/comments`
- issue event trail을 API 층에서 노출하면 같은 화면에 합친다

### 3. 승인 작업대 화면

목적: 승인 요청, 승인 결정, 해제 조건을 이슈 스레드와 분리된 독립 흐름으로 읽고 결정한다.

목록 화면 구성:

- 요청 제목 또는 이슈 제목
- 승인 상태: `pending_human_approval`, `blocked_by_recovery`, `approved`, `rejected`
- 승인 필요 증거 개수
- 마지막 업데이트 시각
- release blocker 존재 여부

상세 화면 구성:

1. `요청`
   - `request.summary`
   - `required_evidence`
   - `validation_commands`
   - 관련 경로: `request_artifact_path`, `runtime_log_path`
2. `결정`
   - 승인 여부
   - 승인자
   - 승인 시각
   - 근거 코멘트
3. `해제 조건`
   - `promotion_action`
   - `release_blocked`
   - `blockers`
   - `unblock_checklist`
   - `next_owner`

데이터 기준:

- `run-result.json#verification_handoff.approval_workflow`
- `run-result.json#verification_evidence`
- 추후 control-plane 승인 API

### 4. 실행 증거 화면

목적: 성공과 실패 실행을 사람 기준으로 해석한다.

핵심 섹션:

1. `요약`
   - `operator_summary.decision`
   - `operator_summary.next_action`
   - `final_status`
2. `검증`
   - `promotion_gate`
   - `approval_status`
   - `validation_commands`
3. `입력 신뢰 경계`
   - trusted workspace(신뢰된 작업공간 입력)
   - untrusted external input(신뢰하지 않는 외부 입력)
4. `복구`
   - `recovery.steps`
   - `restored_paths`
   - `residual_risk_paths`
5. `경로`
   - artifact dir
   - workspace dir
   - summary path
   - runtime log path

이 화면은 별도 메뉴로도 열 수 있지만, 1차 구현에서는 이슈 작업대의 `증거` 탭으로 포함해도 된다.

## 추천 사용자 흐름

### 흐름 A. 운영자가 막힌 이슈를 읽고 다음 행동을 정하는 흐름

1. 작업함에서 `blocked` 이슈를 연다.
2. 이슈 작업대 `개요`에서 차단 사유와 상위 문맥을 읽는다.
3. `스레드`에서 새 댓글 또는 시스템 이벤트가 있는지 확인한다.
4. `잠금과 실행`에서 checkout 충돌 또는 실행 중 run 여부를 확인한다.
5. `증거`에서 관련 승인 또는 복구 산출물을 읽고 다음 owner를 결정한다.

### 흐름 B. 승인자가 성공 실행을 승인하는 흐름

1. 승인 작업대 목록에서 `pending_human_approval` 항목을 연다.
2. `요청` 탭에서 검증 명령과 입력 신뢰 경계를 확인한다.
3. 필요 시 연결된 이슈 작업대와 `runtime.log`를 본다.
4. `결정` 탭에서 승인 또는 거절을 기록한다.
5. `해제 조건` 탭에서 승격 재시도 조건과 다음 owner를 확인한다.

### 흐름 C. 기술 책임자가 실패 복구 범위를 검토하는 흐름

1. 실행 증거 화면에서 `rollback_and_requeue_recorded`를 확인한다.
2. `복구` 섹션에서 `modified_preexisting_paths`, `created_paths`, `restored_paths`, `residual_risk_paths`를 비교한다.
3. 이슈 작업대 `스레드`로 이동해 재시도 전 필요한 댓글 또는 재분해를 남긴다.

## 화면 간 관계

- 작업함은 "무엇을 열어야 하는가"를 정한다.
- 이슈 작업대는 "왜 이 상태인가"를 설명한다.
- 승인 작업대는 "사람이 어떤 결정을 내려야 하는가"를 분리해 보여준다.
- 실행 증거 화면은 "무슨 근거로 그렇게 판단하는가"를 제공한다.

즉 첫 릴리스는 `작업함 -> 이슈 작업대 -> 승인/증거`의 3단 이동이면 충분하다.

## 모바일 대응 판단

- 데스크톱 우선으로 설계한다. 이유는 경로, 로그, 검증 명령, 긴 댓글을 동시에 읽어야 하기 때문이다.
- 태블릿에서는 2열 레이아웃까지 허용한다.
- 모바일 1차 범위는 아래로 제한한다.
  - 작업함 읽기
  - 이슈 상태와 차단 사유 읽기
  - 승인 요청 읽기와 단순 승인/거절
- 모바일에서 긴 로그 탐색, 경로 복사, 긴 댓글 작성은 2차 범위로 미룬다.

## 초기 디자인 시스템 필요 수준

초기에는 큰 디자인 시스템보다 운영 전용 컴포넌트 묶음이 더 중요하다.

필수 컴포넌트:

- 상태 칩
- 우선순위 배지
- lock 배지
- 단계형 타임라인
- 경로 표시 카드
- 검증 명령 코드 블록
- 댓글/시스템 이벤트 공용 타임라인 아이템
- trust boundary(입력 신뢰 경계) 배지
- recovery scope(복구 범위) 비교 표

불필요한 것:

- 마케팅용 랜딩 스타일
- 복잡한 차트
- 고급 테마 시스템

## 후속 구현 분해 기준

### NIT-80에서 이번에 고정된 것

- 첫 화면 묶음
- 화면 간 이동 흐름
- 모바일 우선순위
- 초기 디자인 시스템 최소 범위

### NIT-81에 넘길 것

- 승인 작업대 목록/상세 구현
- 승인 요청, 승인 결정, 해제 조건의 시각적 구분
- 입력 신뢰 경계 표시 규칙

### NIT-82에 넘길 것

- 작업함 요약 화면
- 이슈 작업대
- 댓글 스레드와 시스템 이벤트 타임라인
- checkout 상태와 충돌 표시
- 실행 증거 탭 또는 별도 증거 화면

## 구현 전 바꾸지 말아야 할 경계

- 이슈 상태와 증거 상태를 하나의 상태 칩으로 합치지 않는다.
- 승인 여부를 이슈 댓글 텍스트로만 표현하지 않는다. 승인 결정은 별도 구조를 유지해야 한다.
- `input_defense`는 숨은 개발자 디버그 정보로 취급하지 않는다. 운영 판단에 필요한 핵심 정보다.
- 실패 실행의 `residual_risk_paths`는 단순 경고 문구가 아니라 실제 경로 목록으로 유지해야 한다.

## 검증 근거

- [`docs/architecture.md`](./architecture.md)
- [`docs/control-plane-issue-surface.md`](./control-plane-issue-surface.md)
- [`docs/approval-workflow-handoff-contract.md`](./approval-workflow-handoff-contract.md)
- [`docs/m5-operational-parity-assessment.md`](./m5-operational-parity-assessment.md)
- `artifacts/runtime-fixtures/success/run-result.json`
- `artifacts/runtime-fixtures/failure/run-result.json`
