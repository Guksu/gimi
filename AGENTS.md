# gimi — 에이전트 작업 지침

이 파일은 이 저장소에서 일하는 **모든 코딩 에이전트**(Claude Code·Codex·Cursor·Gemini CLI·GitHub Copilot 등)를 위한 공통 지침이다. 도구별 파일(`CLAUDE.md` 등)은 이 파일을 가져오고 도구 전용 내용만 덧붙인다. 규칙을 고칠 때는 이 파일 한 곳에서만 고친다.

## 이 저장소는 무엇인가

gimi — 코드 리뷰 스킬(`gimi-review`)을 담은 설치형 플러그인이다. 테스트 스킬(`gimi-test`)은 설계 결정 52로 지웠다. 열린 표준인 Agent Skills 형식을 따른다. 설계의 단일 출처는 `docs/design/2026-10-19-gimi.md`다. 결정이 바뀌면 그 문서를 먼저 고친다.

| 무엇 | 경로 | 내용 |
|---|---|---|
| 리뷰 스킬 | `skills/gimi-review/SKILL.md` | 맥락 리뷰(영향 범위·의도·이력)와 도메인 규칙 설정 |
| 맥락 수집 | `skills/gimi-review/scripts/context.mjs` + `lib/` | 리뷰 전에 범위·바뀐 파일·의도·이력·영향 범위를 모은다. 계약 파일(OpenAPI·GraphQL)이 바뀌면 바뀐 엔드포인트·필드와 그 사용처를 찾는다. 스킬과 함께 설치되는 스크립트이고, 영향 범위는 리뷰하는 프로젝트의 `typescript`, YAML은 프로젝트의 `yaml`·`js-yaml`(없으면 내장 파서)을 쓴다 |
| 규칙 | `skills/gimi-review/shared/rules/{test,code,review}.md`, `skills/gimi-review/shared/domains/{commerce,kr-commerce-law}/rules.md`, `skills/gimi-review/scripts/rules.mjs` | 공통 금지선(테스트·코드·리뷰 — PR의 테스트 코드도 리뷰한다)과 분야 프리셋(COM 29·KCL 14). `검사`는 리뷰·기록뿐이다(정적 검사는 없다). `rules.mjs`가 설정의 stacks·presets와 회사 규칙의 끈 규칙으로 걸러 보인다 |
| 예제 저장소 | `evals/shop-fixture/` | 국수집 주문 앱 — web(React + Vite)·server(NestJS + pg)·fake-pg(가짜 PG)·PostgreSQL(docker). 리뷰 평가가 쓴다. TypeScript 앱이고 의존성은 그 폴더의 `package-lock.json`에만 둔다 |
| 결함 PR | `evals/shop-fixture/defects/{ID}/`, `scripts/defects.mjs` + `scripts/lib/defects.mjs` | 결함마다 `change.patch` + `defect.json`(어긴 규칙·PR 제목과 본문·정답 `path:line`·잡는 테스트). `check`가 패치·형식·정답 위치·잡는 테스트를 보고, `materialize`가 평가용 git 저장소(main = 정상, defect/{ID} = 결함 PR)를 만든다. 형식은 `defects/README.md` |
| 리뷰 평가 | `evals/review/`, `scripts/review-eval.mjs` + `scripts/lib/review-eval.mjs` | 결함 PR마다 `gimi-review`와 내장 `/code-review`를 같은 모델·같은 지시로 `claude -p`로 돌리고(`run`), 출력의 `FINDING` 줄을 정답과 맞춰 채점한다(`score`). `coverage`는 모델 없이 정답·근거가 맥락 묶음에 있는지 본다. 결함의 GitHub 이슈는 가짜 gh(`scripts/fake-gh.mjs`)가 두 리뷰어에게 똑같이 준다. 원본 결과는 `evals/review/runs/`(커밋하지 않는다), 채점표는 `evals/review/results/` |
| 슬롭 측정 | `evals/slop/`, `scripts/slop-eval.mjs` + `scripts/lib/slop-eval.mjs`, `scripts/buildSlopTable.mjs` + `scripts/lib/slop-table.mjs` | 리뷰 평가의 실행(내장 `/code-review`는 gimi 없이, gimi-review는 있이)을 판정 모델과 사람이 읽고 금지선 줄을 센다(`judge`·`score --reviews`). 테스트·코드 줄은 2026-10-27의 구현 실행 결과로 셌다(그 실행 도구는 지웠다). `apply`가 결과를 규칙 파일의 근거에 옮기고, `buildSlopTable.mjs`가 SKILL.md의 금지선 표를 근거로 다시 쓴다(구조 검사가 어긋남을 막는다) |
| 트리거 평가 | `evals/trigger/` | gimi-review가 맞는 요청에 걸리고, 다른 스킬(내장 `/code-review`, 테스트 작성 등 decoy)의 요청에는 걸리지 않는지 |
| 저장소 스크립트 | `scripts/` | 구조 검사(`validateSkills.mjs`), 트리거 평가(`evalSelection.mjs`), 순수 로직(`lib/`) |
| 테스트 | `tests/` | `scripts/lib/`·`skills/gimi-review/scripts/lib/`의 단위 테스트와 임시 git 저장소 통합 테스트(`node:test`, `tests/helpers/repo.mjs`) |

저장소 루트가 곧 플러그인이다. 루트에 `commands/`·`agents/`·`hooks/`·`output-styles/`·`.mcp.json`을 만들지 않는다. 만들면 설치한 사용자 환경에 그대로 로드된다(구조 검사가 막는다). 매니페스트에는 훅을 두지 않는다(설계 결정 7). 리뷰는 요청할 때만 돈다.

## 개발 명령

```bash
npm ci                            # 개발 의존성(typescript — 테스트 전용) 설치
npm test                          # 단위·통합 테스트 (node:test)
npm run validate                  # 구조 검사 + 트리거 평가 — 실패하면 exit 1
node scripts/evalSelection.mjs --verbose   # 질의마다 상위 3개 점수
node scripts/evalSelection.mjs --margins   # 1위와 2위 점수 차가 작은 should 질의

# 예제 저장소 — Docker의 PostgreSQL이 필요하다
(cd evals/shop-fixture && npm ci && npm run db:up && npm run typecheck && npm test)
node scripts/defects.mjs check            # 결함 PR — 패치가 붙는지, 정답 위치, 잡는 테스트(정상 통과·결함 실패)
node scripts/defects.mjs materialize COM-007 /tmp/pr   # 평가용 저장소
node scripts/review-eval.mjs coverage     # 리뷰 평가 — 모델 없이 정답·근거가 맥락 묶음에 있는지
node scripts/review-eval.mjs run COM-024 --reviewer gimi --model <모델>   # 실제 모델을 부른다 — 비용이 든다
node scripts/slop-eval.mjs judge <리뷰 평가 결과 폴더> --reviews --model <모델>   # 슬롭 측정 — 리뷰 줄, 실제 모델
node scripts/buildSlopTable.mjs          # 규칙 파일의 근거로 SKILL.md의 금지선 표를 다시 쓴다(--check)
```

## 작업 규칙

1. **git.** 작업마다 최신 `main`에서 브랜치를 따고 커밋·푸시·PR(베이스 `main`)까지 올린다. 머지는 사용자가 한다(스쿼시만 허용, 머지 후 브랜치 자동 삭제). 열린 PR 위에 브랜치를 쌓지 않는다 — 아래 PR이 스쿼시되면 충돌로 보인다. rebase·force push·브랜치 삭제는 하지 않는다. 커밋 메시지·PR 본문에 AI 작성 표기(Co-Authored-By 등)를 넣지 않는다.
2. **커밋·PR 형식.** 커밋은 `feat:`·`fix:`·`docs:`·`test:`·`chore:` + 한국어 제목, 본문은 글머리표. PR 본문은 `## 개요` / `## 주요 변경`(커밋 해시) / `## 확인한 것`(실제 실행한 명령과 결과) / `## 참고`(확인하지 못한 것).
3. **평가 먼저.** 스킬 description을 쓰거나 고치기 전에 `evals/trigger/{스킬}.json`을 먼저 고친다(Red). 그다음 description을 고쳐 통과시킨다(Green). description은 3인칭으로 "무엇을 하는가 + 언제 쓰는가"만 적고, 1,024바이트 이하이며 `": "`를 쓰지 않는다(YAML이 깨진다). 요청의 단어가 경쟁 스킬(예: 내장 `/code-review`)의 설명과 같아 단어 겹침으로는 동점을 깰 수 없는 질의는 `contested`에 둔다. 질의를 바꿔 동점을 숨기지 않는다.
4. **코드는 TDD.** `scripts/lib/`의 로직은 `tests/`에 테스트를 먼저 쓴다(Red → Green). 입출력(파일 읽기·종료 코드)은 CLI(`scripts/*.mjs`)가 맡고, 판단은 `lib/`의 순수 함수에 둔다.
5. **스크립트는 `.mjs`, 런타임 의존성 0, Node 22 이상.** `.ts`를 그대로 실행하지 않는다(Node 22.18 미만에서 돌지 않는다 — 설계 결정 23). TypeScript가 필요하면 리뷰하는 프로젝트의 것을 불러오고, 없거나 언어 서비스 API가 없는 버전이면 문자열 검색으로 내려간다. gimi 저장소의 `typescript`는 테스트 전용 개발 의존성이다. 예제 저장소(`evals/shop-fixture/`)는 평가 대상인 앱이라 이 규칙 밖이다(TypeScript, 자체 의존성).
6. **스킬은 설치된 프로젝트에서 단독으로 완결된다.** `SKILL.md`는 저장소의 `docs/`·`evals/`·`scripts/`를 가리키지 않는다(설치하면 없다). 스킬이 쓰는 규칙·스크립트는 스킬 폴더(`skills/gimi-review/`) 안에 둔다.
7. **시크릿은 읽지도 기록하지도 않는다.** `.env`·키 파일을 열지 않는다.
8. **출력은 읽는 사람이 이해할 수 있게.** 전문용어는 처음 나올 때 한 줄로 풀이하고, 한 문장에 하나의 내용만 담는다.

## 완료 게이트

| # | 게이트 | 방법 |
|---|---|---|
| 1 | 단위 테스트 | `npm test` |
| 2 | 구조·트리거 평가 | `npm run validate` |
| 3 | 예제 저장소(`evals/shop-fixture/`를 고쳤을 때) | 그 폴더에서 `npm run typecheck && npm test`, 루트에서 `node scripts/defects.mjs check` |

릴리스 전에는 법령 프리셋(`skills/gimi-review/shared/domains/kr-commerce-law/rules.md`)의 기준 버전 표와 시행 예정 조문을 국가법령정보센터에서 다시 확인하고, 시행일이 바뀌었으면 규칙을 고친 뒤 표의 확인한 날을 고친다(설계 결정 55).

게이트가 실패하면 고친 뒤 그 게이트부터 다시 돌린다. 트리거 평가는 LLM을 부르지 않는다. description과 요청 문장의 단어 겹침(IDF 가중)으로 순위를 매기는 대리 지표라 실제 모델의 선택과 다를 수 있다. 잡아내는 것은 두 가지다. 트리거 표현이 description에 없는 경우와, 두 description이 구별되지 않는 경우다.
