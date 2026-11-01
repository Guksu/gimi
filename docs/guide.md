# gimi 상세 안내

[README](../README.ko.md) · [English](guide.en.md)

## 소개

기미(氣味)상궁이 임금의 수라를 먼저 맛보듯, 코드를 올리기 전에 먼저 맛본다는 뜻으로 지은 이름입니다.

gimi는 Claude Code·Codex의 코드 리뷰 스킬(**gimi-review**)입니다. AI 리뷰어는 보통 diff(이번 변경에서 바뀐 줄) 안에서만 판단합니다. 사람이 리뷰하며 잡는 결함은 대개 diff 밖에 있습니다. 바뀐 함수를 쓰는 다른 화면, 티켓에 적힌 요구사항, 그 줄을 예전에 일부러 그렇게 둔 이유 같은 것입니다. gimi-review는 리뷰 전에 이 맥락을 먼저 모읍니다. 그리고 근거 위치를 댈 수 있는 지적만 남깁니다.

## 하는 일

- **영향 범위** — 바뀐 함수·타입·클래스 메서드를 이 변경에서 안 바뀐 곳이 쓰는지 찾습니다(TypeScript·JavaScript). 바뀐 쿼리 키·경로 같은 문자열과 지운 필드도 찾습니다.
- **계약** — 계약은 프론트와 백엔드가 주고받는 API의 약속(OpenAPI·GraphQL 스키마)입니다. 계약이 바뀌면 바뀐 엔드포인트·필드와 그 사용처를 찾습니다. 프론트와 백엔드가 다른 저장소면 설정에 적은 저장소에서도 찾습니다.
- **의도** — PR·이슈 본문을 읽고 요구사항과 diff를 맞춰 봅니다. Jira·Notion·Linear 번호는 에이전트에 연결된 도구로 읽고, 읽을 수 없으면 붙여 넣기를 요청합니다.
- **변경 이력** — 바꾸거나 지운 줄을 넣은 커밋을 찾아, 예전 수정을 되돌리는지 봅니다.
- **규칙** — 세 겹으로 대조합니다.
  - 공통 금지선: AI가 쓴 코드·테스트·리뷰에 흔히 보이는 티(예: 빈 catch, 근거 없는 단정)
  - 분야 프리셋: 커머스 29개, 국내 전자상거래 법령 14개
  - 팀 규칙: `docs/gimi/rules.md`
- **리뷰 기록** — 지적을 `docs/gimi/reviews/`에 남깁니다. 같은 종류의 지적이 기록에 세 번 쌓이면 에이전트가 기록을 읽어 팀 규칙 후보로 올립니다. 사람이 승인해야 규칙이 됩니다.

## 설치

**Claude Code** — 대화창에서 실행합니다.

```text
/plugin marketplace add Guksu/gimi
/plugin install gimi@gimi
```

**Codex** — 터미널에서 실행합니다.

```bash
codex plugin marketplace add Guksu/gimi
codex plugin add gimi@gimi
```

필요한 것은 이렇습니다.

- Node.js 22 이상. 맥락 수집 스크립트는 런타임 의존성이 없습니다.
- 리뷰할 git 저장소. 얕은 복제면 변경 이력을 건너뜁니다.
- PR·이슈 본문을 읽으려면 GitHub CLI(`gh`)에 로그인해 둡니다. 없으면 의도를 건너뛰었다고 알립니다.
- 영향 범위는 리뷰하는 프로젝트의 `typescript`를 씁니다. 없으면 문자열 검색으로 내려갑니다.
- 리뷰하는 저장소의 `node_modules` 아래에 git이 추적하는 파일이 하나라도 있으면 `typescript`와 YAML 파서를 불러오지 않습니다. 남의 PR을 리뷰할 때 PR이 커밋한 코드가 실행되지 않게 하려는 것입니다. 다만 PR의 `package.json`으로 직접 설치한 패키지는 막지 못합니다. 남의 PR에서는 설치 전에 의존성 변경을 확인합니다.

## 업데이트

업데이트 전에 [릴리스 노트](https://github.com/Guksu/gimi/releases)를 확인합니다.

**Claude Code**는 터미널에서 아래 명령을 실행하고 새 세션을 시작합니다.

```bash
claude plugin marketplace update gimi
claude plugin update gimi@gimi
```

**Codex**는 `codex plugin marketplace upgrade gimi`로 마켓플레이스를 갱신합니다. 그다음 앱의 플러그인 설정에서 gimi의 설치 버전을 확인하고 업데이트합니다. 마켓플레이스 갱신만으로 설치된 플러그인까지 바뀌었다고 보지 않습니다.

명령 참고: [Claude Code](https://code.claude.com/docs/en/discover-plugins#update-plugins-now) · [Codex 플러그인](https://developers.openai.com/plugins/build/plugins)

## 동작 방식

리뷰할 저장소에서 "PR 42 리뷰해줘", "이 브랜치 코드 리뷰해줘", "다른 화면에 영향 없는지 봐줘"처럼 요청합니다. Claude Code에서는 `/gimi:gimi-review`로 직접 부를 수 있습니다. 내장 `/code-review`와 겹치는 요청이면 이 이름으로 부르는 편이 확실합니다.

리뷰는 다섯 단계로 돕니다.

1. **범위를 정합니다.** PR 번호가 있으면 그 PR, 없으면 현재 브랜치와 기본 브랜치의 갈림점부터 지금까지입니다.
2. **맥락을 모읍니다.** 스킬에 든 스크립트(`scripts/context.mjs`)가 바뀐 파일·의도·이력·영향 범위·계약을 모아 요약합니다.
3. **규칙과 대조합니다.** 이 프로젝트에 맞는 규칙만 골라 diff에 닿는 것을 읽습니다.
4. **근거가 있는 지적만 씁니다.** 근거는 diff 밖이어야 합니다. AI 코드의 티(슬롭) 지적만 diff 안의 줄을 근거로 씁니다.
5. **보고합니다.** 채팅에는 지적 수와 "고쳐야 함"만 짧게 나옵니다. 전체는 리뷰 기록 파일에 남습니다.

지적은 이런 모양입니다(예시).

```text
[고쳐야 함] 영향 범위
주문 상태 형태가 바뀌었는데 배지는 예전 형태를 읽는다

바뀐 곳  src/api/order.ts:42
         status: string → { code, label }
근거    src/components/OrderBadge.tsx:12
         status === 'PAID'  (이 PR에서 안 바뀜)
상황    결제 완료 주문 → 배지가 항상 '알 수 없음'
```

리뷰하면 저장소에 두 가지 파일이 생깁니다.

- `docs/gimi/reviews/{날짜}-pr-{번호}.md` — 리뷰 기록. 지적과 확인한 맥락을 적습니다.
- `docs/gimi/reviews/{날짜}-pr-{번호}.context.json` — 모은 맥락. 크고 다시 만들 수 있어 커밋하지 않습니다. `.gitignore`에 `docs/gimi/reviews/*.context.json`을 더합니다.

PR에 코멘트를 달지는 않습니다. 리뷰는 요청할 때만 돕니다.

## 설정

설정이 없어도 리뷰는 됩니다. 이때 공통 금지선은 공통 줄과 프론트엔드(TypeScript) 줄만 씁니다. 백엔드 줄과 분야 프리셋은 쓰지 않습니다.

프리셋을 쓰려면 "도메인 규칙 설정해줘"라고 합니다. 분야 프리셋과 요구사항 출처를 고르면 `.agents/gimi.json`에 씁니다.

```json
{
  "stacks": ["frontend-ts", "backend"],
  "presets": ["commerce", "kr-commerce-law"],
  "kcl": { "periodCounting": "civil-code", "businessDays": "docs/gimi/business-days.json" },
  "requirements": [{ "source": "github" }, { "source": "jira", "keyPattern": "SHOP-\\d+" }],
  "linkedRepos": ["../shop-web"]
}
```

- `stacks`는 공통 금지선의 대상(`frontend-ts`·`backend`), `presets`는 분야 프리셋입니다.
- 국내 법령 프리셋(`kr-commerce-law`)은 법률 자문이 아닙니다. 청약철회 기간을 세는 방식(`kcl.periodCounting`)과 영업일 달력(`kcl.businessDays`)은 팀이 정합니다. 정하지 않으면 리뷰가 그 계산을 단정하지 않고 확인 질문으로 올립니다.
- `linkedRepos`는 함께 볼 다른 저장소의 경로입니다. 경로는 이 체크아웃의 루트 기준입니다. 그 저장소는 지금 체크아웃된 그대로 읽습니다.
- PR이 `linkedRepos`를 바꾸면 PR의 값 대신 기준 브랜치(갈림점)에 있던 값을 쓰고 알립니다.
- 프리셋 규칙 하나를 끄려면 팀 규칙 파일의 "끈 프리셋 규칙" 절에 이유와 함께 적습니다.

설정 항목의 뜻은 [설계 문서의 설정 절](design/2026-10-19-gimi.md#설정--agentsgimijson)에 있습니다. `promoteAfter`·`rulePrefix`는 아직 스크립트가 읽지 않습니다.

## 측정

예제 앱(`evals/shop-fixture`, 국수집 주문 앱)에 결함을 심은 PR로 gimi-review와 Claude Code 내장 `/code-review`를 비교했습니다. 두 리뷰어는 같은 모델(`claude-opus-5-5`)·같은 지시로 돌렸습니다.

- **찾음** — 결함은 두 리뷰어 모두 거의 다 찾았습니다(새 결함 32개에서 `/code-review` 32개, gimi 31개). 찾음은 지적 위치가 정답 줄에서 3줄 안이면 맞음으로 센 것이라, 같은 줄의 다른 문제도 맞음이 될 수 있습니다.
- **정답 밖 지적** — 심은 결함이 아닌 곳을 짚은 지적입니다. 틀린 지적이라는 뜻은 아닙니다. 새 결함 32개에서 `/code-review`는 55개, gimi는 19개였습니다. 그 내용이 맞는지는 읽지 않았습니다.
- **이슈에만 있는 요구사항** — 요구사항이 이슈에만 있는 결함 4개를 리뷰어마다 2번씩 돌렸습니다. 요구사항을 읽어 낸 리뷰는 gimi 8번 중 8번, `/code-review` 8번 중 5번이었습니다(제가 읽고 센 것).
- **비용·시간** — gimi가 더 듭니다. 새 결함 32개에서 리뷰 한 번에 gimi 평균 $0.41·57초, `/code-review` 평균 $0.31·45초였습니다.

모델 하나와 예제 앱 한 곳으로 잰 결과입니다. 새 결함은 PR마다 1번씩만 돌렸습니다. 결과와 조건은 [평가 안내](../evals/review/README.md)와 [결과 문서](../evals/review/results/)에 있습니다.

## 한계

- 바뀐 이름의 사용처는 TypeScript·JavaScript(Vue·Svelte 포함)에서만 찾습니다. 다른 언어 파일은 바뀐 문자열만 찾습니다.
- proto 계약(gRPC의 `.proto` 파일)과 서버 코드 안에 쓴 GraphQL 스키마(typeDefs)는 아직 읽지 않습니다.
- 테스트를 쓰거나 돌리지 않습니다. PR에 든 테스트 코드는 리뷰합니다.

## 구성

| 무엇 | 경로 |
|---|---|
| 스킬 | `skills/gimi-review/SKILL.md` |
| 맥락 수집 스크립트 | `skills/gimi-review/scripts/context.mjs` + `lib/` |
| 규칙 | `skills/gimi-review/shared/rules/`(공통 금지선), `shared/domains/`(분야 프리셋) |
| 예제 앱과 결함 PR | `evals/shop-fixture/` |
| 리뷰 평가 | `evals/review/` |
| 설계 | `docs/design/2026-10-19-gimi.md` |

## 개발

Node.js 22 이상이 필요합니다. `typescript`는 테스트에서만 씁니다.

```bash
npm ci            # 개발 의존성 설치
npm test          # 단위·통합 테스트 (node:test)
npm run validate  # 스킬 구조 검사 + 트리거 평가
```

작업 규칙은 [AGENTS.md](../AGENTS.md)에 있습니다. 바뀐 내용은 [CHANGELOG.md](../CHANGELOG.md)에 있습니다.
