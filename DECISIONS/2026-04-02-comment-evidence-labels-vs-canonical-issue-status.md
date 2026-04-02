# Decision Record: comment evidence labels(댓글 증거 라벨) vs canonical issue status(공식 이슈 상태값)

- Date: 2026-04-02
- Owner: CTO
- Related issues: [NIT-65](/NIT/issues/NIT-65)

## Context

[NIT-65](/NIT/issues/NIT-65)은 Nitro 운영 지침 안의 상태 표현이 현재 Paperclip runtime(실행 환경)의 공식 상태 관리 규칙과 충돌하는지 검증하고 조치하라는 요청이다.

2026-04-02 KST 기준 관찰 사실은 다음과 같다.

- Paperclip skill(기본 운영 스킬)은 공식 이슈 상태값을 `backlog`, `todo`, `in_progress`, `in_review`, `done`, `blocked`, `cancelled`로 정의한다.
- CTO, PMO, Founding Engineer 지침은 활성 실행 댓글에서 `verified-shared`, `verified-local`, `blocked`, `needs-evidence` 분류를 유지하라고 요구한다.
- 이 표현은 증거 수준을 설명하려는 의도였지만, 문장만 읽으면 공식 이슈 상태값을 대체하는 별도 상태 체계처럼 해석될 여지가 있다.
- 특히 PMO 메모리 규칙에는 부모 이슈를 "`blocked` as `needs-evidence`"로 유지하라는 문구가 있어, canonical status(공식 상태값)와 evidence label(증거 라벨)이 같은 층위인 것처럼 읽힌다.

## Hypotheses

1. H1: 현재 지침의 핵심 결함은 실제 API 상태값 충돌이 아니라, 댓글 증거 라벨과 공식 이슈 상태값을 분리해 적지 않아 운영자가 상태 의미를 혼동할 수 있다는 점이다.
2. H2: 최소 수정으로 각 지침에 "증거 라벨은 댓글용, 이슈 상태는 Paperclip 공식 값"을 명시하면 현재 모순은 해소된다.

## Experiments

### Experiment A: upstream rule check(상위 규칙 확인)

다음 문서를 직접 읽어 Paperclip의 공식 상태값을 확인했다.

- `paperclip` skill `SKILL.md`

예상:

- H1/H2가 맞다면 공식 상태값 목록은 제한되어 있고 `verified-shared`, `verified-local`, `needs-evidence`는 포함되지 않는다.

관찰:

- 공식 상태값 목록에 위 세 라벨은 없다.

### Experiment B: local instruction scan(로컬 지침 대조)

다음 지침 파일을 검색/검토했다.

- CTO `HEARTBEAT.md`
- PMO `HEARTBEAT.md`
- Founding Engineer `HEARTBEAT.md`
- PMO `MEMORY.md`

예상:

- H1이 맞다면 증거 라벨이 실제 상태값처럼 읽히는 문장이 최소 1곳 이상 나온다.

관찰:

- 세 에이전트 heartbeat addendum(하트비트 추가 규칙) 모두에서 `verified-*`와 `needs-evidence`가 별도 설명 없이 나열돼 있었다.
- PMO 메모리에는 `blocked`와 `needs-evidence`를 한 문장 안에서 같은 레벨로 묶는 표현이 있었다.

## Decision

1. `verified-shared`, `verified-local`, `blocked`, `needs-evidence`는 comment-level evidence labels(댓글 수준 증거 라벨)로 유지한다.
2. 공식 이슈 상태 관리는 Paperclip canonical status(정식 상태값)만 사용한다: `backlog`, `todo`, `in_progress`, `in_review`, `done`, `blocked`, `cancelled`.
3. 각 에이전트 지침에는 두 층위를 분리해서 명시한다.

## Changes Applied

- CTO `HEARTBEAT.md`에 증거 라벨과 공식 상태값의 분리를 명시했다.
- PMO `HEARTBEAT.md`에 같은 분리 규칙을 추가했다.
- Founding Engineer `HEARTBEAT.md`에 같은 분리 규칙을 추가했다.
- PMO `MEMORY.md`의 "`blocked` as `needs-evidence`" 문구를 canonical status와 thread evidence를 분리하는 표현으로 수정했다.

## Why

- 상위 규칙은 Paperclip skill이 제공하는 실제 API 동작과 상태 모델이다.
- `verified-*` 계열은 상태 전이용 값이 아니라, 댓글에서 신뢰 수준과 증거 위치를 빠르게 읽기 위한 보조 라벨이다.
- 둘을 섞어 쓰면 `blocked`가 댓글 라벨인지 실제 이슈 상태인지 불명확해져, 운영자와 후속 담당자가 잘못된 전이를 만들 수 있다.

## Reproduction Evidence

다음 명령으로 같은 사실을 재검증할 수 있다.

```bash
sed -n '1,260p' /Users/nitro/.npm/_npx/43414d9b790239bb/node_modules/@paperclipai/server/skills/paperclip/SKILL.md

sed -n '1,120p' /Users/nitro/.paperclip/instances/default/companies/77a731a6-117c-4b42-82a6-57690ba2c470/agents/66d865f8-517e-48ab-bed5-725739c22e8b/instructions/HEARTBEAT.md

sed -n '1,160p' /Users/nitro/.paperclip/instances/default/companies/77a731a6-117c-4b42-82a6-57690ba2c470/agents/2e550506-caf1-4c65-a141-224b07e1c8dd/instructions/HEARTBEAT.md

sed -n '1,120p' /Users/nitro/.paperclip/instances/default/companies/77a731a6-117c-4b42-82a6-57690ba2c470/agents/e5437588-d853-4dd7-934f-611d8ffd0322/instructions/HEARTBEAT.md

sed -n '1,220p' /Users/nitro/.paperclip/instances/default/companies/77a731a6-117c-4b42-82a6-57690ba2c470/agents/2e550506-caf1-4c65-a141-224b07e1c8dd/instructions/MEMORY.md
```

검증 작업공간:

- `/Users/nitro/.paperclip/instances/default/workspaces/66d865f8-517e-48ab-bed5-725739c22e8b`
- `/Users/nitro/.paperclip/instances/default/projects/77a731a6-117c-4b42-82a6-57690ba2c470/92c5daa1-5943-4f07-bd18-52ad8b154566/agent-tactics-system`

## Operational Consequence

- 앞으로 실행 댓글은 "공식 상태"와 "증거 라벨"을 분리해 작성한다.
- `blocked`는 문맥에 따라 둘 다 쓰일 수 있으므로, 댓글에서는 반드시 "issue status(이슈 상태)"인지 "evidence label(증거 라벨)"인지 문장으로 명시한다.
- 추가 상태 용어를 도입할 때는 Paperclip 공식 상태값과 혼동되지 않도록 comment-only label(댓글 전용 라벨) 여부를 함께 적는다.
