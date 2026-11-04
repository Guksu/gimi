# 처음 설정과 규칙 후보 — gimi-review

SKILL.md가 필요할 때 가리키는 문서다. 경로의 `<이 스킬 폴더>`는 SKILL.md가 있는 폴더다.

## 처음 설정

회사 저장소에서 "도메인 규칙 설정해줘"라고 하면 다음을 한다.

1. 공통 금지선의 대상(`stacks` — `frontend-ts`·`backend`)을 고른다. `node <이 스킬 폴더>/scripts/rules.mjs` 목록 첫 줄의 추정값과 근거(설정이 이미 있으면 지금 값)를 보여 주고 확인받는다.
2. 분야 프리셋을 고른다(여러 개 가능 — 지금은 `commerce`·`kr-commerce-law`). 국내 법령 프리셋은 법률 자문이 아니라고 알리고, 해석 값(`kcl.periodCounting`·`kcl.businessDays`)을 팀이 정하게 한다.
3. 요구사항 출처(GitHub PR·이슈, Jira, Notion·Confluence, Linear)를 고른다.
4. 코드에서 도메인 규칙 초안(enum·union 타입, 상태 전이 함수, 검증 스키마, 금액·날짜 계산)을 뽑아 `docs/gimi/candidates.md`에 후보로 쓴다(아래 "규칙 후보"의 형식, 출처는 `file:line`).
5. 사람이 승인한 후보만 `docs/gimi/rules.md`로 옮긴다.
6. 고른 값을 `.agents/gimi.json`에 쓴다. 프론트와 백엔드가 다른 저장소면 함께 보는 저장소의 로컬 경로를 `linkedRepos`에 적는다(예: `["../shop-web"]`).
7. `.gitignore`에 `docs/gimi/reviews/*.context.json`을 더한다(맥락 묶음은 커밋하지 않는다).

## 규칙 후보

같은 묶음의 지적이 서로 다른 리뷰 기록 `promoteAfter`건(기본 3)에 쌓이면 `promote.mjs`가 "후보로 올릴 것"에 보인다. 같은 PR을 다시 리뷰한 기록은 한 건이고, 판정이 틀림·의도함인 지적은 세지 않는다. 사람이 승인해야 규칙이 된다.

후보는 `docs/gimi/candidates.md`에 회사 규칙과 같은 형식으로 쓴다. 절 머리는 `## <머리>-<세 자리 번호> <한 줄>`이다(머리는 설정 `rulePrefix`, 없으면 `TEAM`). 반복 지적에서 올린 후보는 `- 묶음:`을 적는다.

```markdown
## SHOP-007 주문 상태는 orderMachine.ts에서만 바꾼다
- 상태: 대기
- 출처: 리뷰 3건 — docs/gimi/reviews/2026-10-02-pr-31.md#2, docs/gimi/reviews/2026-10-09-pr-35.md#1, docs/gimi/reviews/2026-10-15-pr-40.md#3
- 묶음: order-transition
- 왜: 화면마다 상태 전이를 따로 하면 결제 취소 후에도 배송 준비로 넘어간다
- 대신: orderMachine.transition()을 부른다
- 확인: 영향 범위 — setStatus·status 대입
```

- 출처는 `promote.mjs`가 보인 `기록#지적`을 그대로 옮긴다. 왜·대신·확인은 그 지적들을 읽고 쓴다.
- 쓴 뒤 사용자에게 승인을 묻는다. 승인하면 `docs/gimi/rules.md`로 옮기고 후보에서 지운다. 출처는 `- 근거:`로 옮기고, `- 묶음:` 줄은 남긴다 — `promote.mjs`가 같은 묶음을 다시 올리지 않게.
- 거절하면 `- 상태: 거절 — 이유`로 남긴다. 같은 묶음은 다시 올리지 않는다.
