# gimi

기미(氣味)상궁이 임금의 수라를 먼저 맛보듯, 코드를 올리기 전에 먼저 맛보는 Claude Code·Codex 코드 리뷰 스킬입니다.

AI 리뷰어는 보통 diff 안에서만 판단합니다. 사람이 리뷰하며 잡는 결함은 대개 diff 밖에 있습니다. 바뀐 함수를 쓰는 다른 화면, 티켓에 적힌 요구사항, 그 줄을 예전에 일부러 그렇게 둔 이유 같은 것입니다. **gimi-review**는 리뷰 전에 이 맥락을 먼저 모으고, 근거가 있는 지적만 남깁니다.

## 하는 일

- **영향 범위** — 바뀐 함수·타입·클래스 메서드를 이 변경에서 안 바뀐 곳이 쓰는지 찾습니다(TypeScript·JavaScript). 바뀐 쿼리 키·경로 같은 문자열과 지운 필드도 찾습니다.
- **계약** — OpenAPI·GraphQL 스키마가 바뀌면 바뀐 엔드포인트·필드와 그 사용처를 찾습니다. 프론트와 백엔드가 다른 저장소면 설정에 적은 저장소에서도 찾습니다.
- **의도** — PR·이슈 본문을 읽고(GitHub, 연결된 Jira·Notion·Linear) 요구사항과 diff를 맞춰 봅니다.
- **변경 이력** — 바꾸거나 지운 줄을 넣은 커밋을 찾아, 예전 수정을 되돌리는지 봅니다.
- **규칙** — AI가 쓴 코드의 티(공통 금지선), 분야 프리셋(커머스 29개·국내 전자상거래 법령 14개), 팀 규칙 파일로 대조합니다.
- **리뷰 기록** — 지적을 `docs/gimi/reviews/`에 남깁니다. 같은 지적이 쌓이면 팀 규칙 후보로 올립니다.

## 설치

**Claude Code** — 대화창에서:

```text
/plugin install gimi --marketplace Guksu/gimi
```

**Codex** — 터미널에서:

```bash
codex plugin marketplace add Guksu/gimi
codex plugin add gimi@gimi
```

맥락 수집 스크립트는 Node.js 22 이상에서 돌고 런타임 의존성이 없습니다. 영향 범위는 리뷰하는 프로젝트의 `typescript`를 씁니다(없으면 문자열 검색으로 내려갑니다).

## 쓰는 법

리뷰할 저장소에서 "PR 42 리뷰해줘", "이 브랜치 코드 리뷰해줘", "다른 화면에 영향 없는지 봐줘"처럼 요청합니다. 채팅에는 지적 수와 "고쳐야 함"만 짧게 나오고, 전체는 리뷰 기록 파일에 남습니다.

지적은 이런 모양입니다.

```text
[고쳐야 함] 영향 범위
주문 상태 형태가 바뀌었는데 배지는 예전 형태를 읽는다

바뀐 곳  src/api/order.ts:42
         status: string → { code, label }
근거    src/components/OrderBadge.tsx:12
         status === 'PAID'  (이 PR에서 안 바뀜)
```

## 설정

"도메인 규칙 설정해줘"라고 하면 분야 프리셋과 요구사항 출처를 고르고 `.agents/gimi.json`을 씁니다.

```json
{
  "stacks": ["frontend-ts", "backend"],
  "presets": ["commerce", "kr-commerce-law"],
  "requirements": [{ "source": "github" }, { "source": "jira", "keyPattern": "SHOP-\\d+" }],
  "linkedRepos": ["../shop-web"]
}
```

- `linkedRepos`는 함께 볼 다른 저장소의 경로입니다. 이 체크아웃의 루트 기준이고, 그 저장소는 지금 체크아웃된 그대로 읽습니다. PR이 이 값을 바꾸면 그 값은 쓰지 않습니다.
- 국내 법령 프리셋(`kr-commerce-law`)은 법률 자문이 아닙니다. 기간·영업일처럼 해석이 들어간 값은 팀이 정합니다.

모든 설정 항목은 [설계 문서의 설정 절](docs/design/2026-10-19-gimi.md#설정--agentsgimijson)에 있습니다.

## 측정

예제 앱(`evals/shop-fixture`, 국수집 주문 앱)에 결함을 심은 PR로 gimi-review와 Claude Code 내장 `/code-review`를 같은 모델·같은 지시로 돌려 비교했습니다.

- 결함은 두 리뷰어 모두 거의 다 찾았습니다. 차이는 정답 밖 지적에서 났습니다(새 결함 32개 — 55개 대 19개).
- 요구사항이 이슈에만 있는 결함은 gimi가 8번 모두, 내장 리뷰는 8번 중 5번 읽어 냈습니다.
- 결과와 조건은 [evals/review/results/](evals/review/results/)에 있습니다. 예제 앱 한 곳으로 잰 결과입니다.

## 한계

- 바뀐 이름의 사용처는 TypeScript·JavaScript(Vue·Svelte 포함)에서만 찾습니다. 다른 언어 파일은 바뀐 문자열만 찾습니다.
- proto 계약과 코드 안의 GraphQL typeDefs는 아직 읽지 않습니다.
- 테스트를 쓰거나 돌리지 않습니다. PR에 든 테스트 코드는 리뷰합니다.

설계는 [docs/design/2026-10-19-gimi.md](docs/design/2026-10-19-gimi.md)에, 바뀐 내용은 [CHANGELOG.md](CHANGELOG.md)에 있습니다.

## 개발

Node.js 22 이상이 필요합니다. `typescript`는 테스트에서만 씁니다.

```bash
npm ci            # 개발 의존성 설치
npm test          # 단위·통합 테스트 (node:test)
npm run validate  # 스킬 구조 검사 + 트리거 평가
```

## 라이선스

[MIT](LICENSE) © 2026 Guksu
