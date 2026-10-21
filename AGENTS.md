# gimi — 에이전트 작업 지침

이 파일은 이 저장소에서 일하는 **모든 코딩 에이전트**(Claude Code·Codex·Cursor·Gemini CLI·GitHub Copilot 등)를 위한 공통 지침이다. 도구별 파일(`CLAUDE.md` 등)은 이 파일을 가져오고 도구 전용 내용만 덧붙인다. 규칙을 고칠 때는 이 파일 한 곳에서만 고친다.

## 이 저장소는 무엇인가

gimi — 코드 리뷰·테스트 스킬 두 개를 담은 설치형 플러그인이다. 열린 표준인 Agent Skills 형식을 따른다. 설계의 단일 출처는 `docs/design/2026-10-19-gimi.md`다. 결정이 바뀌면 그 문서를 먼저 고친다.

| 무엇 | 경로 | 내용 |
|---|---|---|
| 리뷰 스킬 | `skills/gimi-review/SKILL.md` | 맥락 리뷰(영향 범위·의도·이력)와 도메인 규칙 설정 |
| 테스트 스킬 | `skills/gimi-test/SKILL.md` | 테스트 작성·테스트 슬롭 금지선·끝내기 전 검사 |
| 끝내기 전 검사 | `skills/gimi-test/scripts/check.mjs` + `lib/` | 바뀐 범위의 테스트·타입 검사·린트 명령을 찾아 돌리고 명령·종료 코드·결과 수로 보고한다. 바뀐 JS·TS 줄에서 테스트·코드 슬롭(설계 7절의 검사 error·warn 줄)을 찾는다 |
| 맥락 수집 | `skills/gimi-review/scripts/context.mjs` + `lib/` | 리뷰 전에 범위·바뀐 파일·의도·이력·영향 범위를 모은다. 스킬과 함께 설치되는 스크립트이고, 영향 범위는 리뷰하는 프로젝트의 `typescript`를 쓴다 |
| 트리거 평가 | `evals/trigger/` | 두 스킬이 맞는 요청에 걸리고, 서로·다른 스킬의 요청에는 걸리지 않는지 |
| 저장소 스크립트 | `scripts/` | 구조 검사(`validateSkills.mjs`), 트리거 평가(`evalSelection.mjs`), 순수 로직(`lib/`) |
| 테스트 | `tests/` | `scripts/lib/`·`skills/*/scripts/lib/`의 단위 테스트와 임시 git 저장소 통합 테스트(`node:test`, `tests/helpers/repo.mjs`) |

저장소 루트가 곧 플러그인이다. 루트에 `commands/`·`agents/`·`hooks/`·`output-styles/`·`.mcp.json`을 만들지 않는다. 만들면 설치한 사용자 환경에 그대로 로드된다(구조 검사가 막는다). 매니페스트에는 훅을 두지 않는다(설계 결정 7·9). 끝내기 전 검사는 프로젝트별 옵트인이다.

## 개발 명령

```bash
npm ci                            # 개발 의존성(typescript — 테스트 전용) 설치
npm test                          # 단위·통합 테스트 (node:test)
npm run validate                  # 구조 검사 + 트리거 평가 — 실패하면 exit 1
node scripts/evalSelection.mjs --verbose   # 질의마다 상위 3개 점수
node scripts/evalSelection.mjs --margins   # 1위와 2위 점수 차가 작은 should 질의
```

## 작업 규칙

1. **git.** 작업마다 최신 `main`에서 브랜치를 따고 커밋·푸시·PR(베이스 `main`)까지 올린다. 머지는 사용자가 한다(스쿼시만 허용, 머지 후 브랜치 자동 삭제). 열린 PR 위에 브랜치를 쌓지 않는다 — 아래 PR이 스쿼시되면 충돌로 보인다. rebase·force push·브랜치 삭제는 하지 않는다. 커밋 메시지·PR 본문에 AI 작성 표기(Co-Authored-By 등)를 넣지 않는다.
2. **커밋·PR 형식.** 커밋은 `feat:`·`fix:`·`docs:`·`test:`·`chore:` + 한국어 제목, 본문은 글머리표. PR 본문은 `## 개요` / `## 주요 변경`(커밋 해시) / `## 확인한 것`(실제 실행한 명령과 결과) / `## 참고`(확인하지 못한 것).
3. **평가 먼저.** 스킬 description을 쓰거나 고치기 전에 `evals/trigger/{스킬}.json`을 먼저 고친다(Red). 그다음 description을 고쳐 통과시킨다(Green). description은 3인칭으로 "무엇을 하는가 + 언제 쓰는가"만 적고, 1,024바이트 이하이며 `": "`를 쓰지 않는다(YAML이 깨진다). 요청의 단어가 경쟁 스킬(예: 내장 `/code-review`)의 설명과 같아 단어 겹침으로는 동점을 깰 수 없는 질의는 `contested`에 둔다. 질의를 바꿔 동점을 숨기지 않는다.
4. **코드는 TDD.** `scripts/lib/`의 로직은 `tests/`에 테스트를 먼저 쓴다(Red → Green). 입출력(파일 읽기·종료 코드)은 CLI(`scripts/*.mjs`)가 맡고, 판단은 `lib/`의 순수 함수에 둔다.
5. **스크립트는 `.mjs`, 런타임 의존성 0, Node 22 이상.** `.ts`를 그대로 실행하지 않는다(Node 22.18 미만에서 돌지 않는다 — 설계 결정 23). TypeScript가 필요하면 리뷰하는 프로젝트의 것을 불러오고, 없거나 언어 서비스 API가 없는 버전이면 문자열 검색으로 내려간다. gimi 저장소의 `typescript`는 테스트 전용 개발 의존성이다.
6. **스킬은 설치된 프로젝트에서 단독으로 완결된다.** `SKILL.md`는 저장소의 `docs/`·`evals/`·`scripts/`를 가리키지 않는다(설치하면 없다). 두 스킬이 함께 쓰는 파일은 원본 첫 줄에 `// @shared {파일} origin: {스킬}` 머리를 달고 다른 스킬의 같은 경로에 그대로 복사한다. 구조 검사가 원본과 바이트 단위로 같은지 본다. 고칠 때는 원본을 고치고 다시 복사한다.
7. **시크릿은 읽지도 기록하지도 않는다.** `.env`·키 파일을 열지 않는다.
8. **출력은 읽는 사람이 이해할 수 있게.** 전문용어는 처음 나올 때 한 줄로 풀이하고, 한 문장에 하나의 내용만 담는다.

## 완료 게이트

| # | 게이트 | 방법 |
|---|---|---|
| 1 | 단위 테스트 | `npm test` |
| 2 | 구조·트리거 평가 | `npm run validate` |

게이트가 실패하면 고친 뒤 그 게이트부터 다시 돌린다. 트리거 평가는 LLM을 부르지 않는다. description과 요청 문장의 단어 겹침(IDF 가중)으로 순위를 매기는 대리 지표라 실제 모델의 선택과 다를 수 있다. 잡아내는 것은 두 가지다. 트리거 표현이 description에 없는 경우와, 두 description이 구별되지 않는 경우다.
