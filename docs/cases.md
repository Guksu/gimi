# gimi 리뷰 사례

gimi-review가 diff 밖의 맥락을 어떻게 쓰는지 세 가지 사례로 보여 드립니다. 각 사례는 이 순서입니다: 짧은 diff → 추가로 확인한 맥락 → 리뷰 결과 → 고치는 법.

먼저 알아 두실 것이 있습니다.

- **세 사례 모두 일부러 심은 결함입니다.** 예제 앱(`evals/shop-fixture`, 국수집 주문 앱)에 제가 만든 결함 PR입니다. 실제 외부 프로젝트에서 나온 사례가 아닙니다.
- **리뷰 결과는 실제 실행 기록에서 옮겼습니다.** 리뷰 평가(`scripts/review-eval.mjs run`)가 남긴 출력을 그대로 인용했습니다. 날짜·모델·비용도 그 기록에 있는 값입니다. 그때 gimi는 0.1.0 전의 개발 중인 판이었고, 판과 커밋은 기록하지 않았습니다. 지금 gimi로 돌리면 문구와 지적 수가 다를 수 있습니다.
- **같은 실행에서 Claude Code 내장 `/code-review`의 결과도 함께 적었습니다.** 두 리뷰어는 같은 모델·같은 지시로 돌렸습니다. 세 사례 중 두 사례(1·3)는 `/code-review`도 찾았습니다.
- 인용한 출력의 줄 번호는 그때의 예제 앱 기준입니다. 예제 앱은 2026-10-31에 바뀌어 지금 줄과 다를 수 있습니다.

## 1. API 응답 변경으로 다른 화면이 깨지는 경우 — `COM-024`

**짧은 diff** — PR 제목 "refactor: 주문 응답에서 화면 전용 값을 뺀다"

```diff
 // server/src/orders/orders.service.ts
-      canCancel: CANCELABLE.has(order.status),
-      canReturn: order.status === 'delivered' && deadline !== null && now < deadline && items.some((item) => item.returnable),
+      // 버튼을 보일지는 화면이 주문 상태로 정한다 — API는 화면 사정을 몰라도 된다
```

**추가로 확인한 맥락** — diff에는 서버 파일만 있습니다. gimi의 맥락 수집은 응답에서 지운 필드(`canCancel`·`canReturn`)를 저장소 전체에서 찾았습니다.

- `web/src/pages/OrderPage.tsx` — `{order.canCancel && (` 주문 취소 버튼, `{order.canReturn && …` 반품 버튼(이 PR에서 안 바뀜)
- `contracts/openapi.yaml` — 주문 응답의 `required`에 두 필드가 남아 있음
- `web/src/api/schema.d.ts` — 계약에서 만든 타입도 그대로

**리뷰 결과** — 실제 실행 2026-10-26, `claude-opus-5-5`, 리뷰어마다 2번

| 리뷰어 | 찾음(위치) | 한 번의 비용·시간(1회차) |
|---|---|---|
| gimi | 2번 중 2번 | $0.28 · 46초 |
| `/code-review` | 2번 중 2번 | $0.19 · 38초 |

gimi 1회차 출력에서 옮겼습니다(일부).

```text
[고쳐야 함] 영향 범위
서버가 canCancel·canReturn을 더 이상 주지 않는데, 화면은 여전히 그 값으로 버튼을 보입니다
- 바뀐 곳: server/src/orders/orders.service.ts:143
- 근거: web/src/pages/OrderPage.tsx:72, :77 (이 PR에서 안 바뀜)
- 상황: 결제·준비 중인 주문이나 배송 완료 7일 안의 주문을 열어도 "주문 취소"와 "반품 신청" 버튼이 보이지 않습니다.
- 테스트: web/src/test/server.ts:46-47의 MSW가 canCancel·canReturn을 계속 넣어 줘서 웹 테스트는 이 문제를 잡지 못할 것으로 보입니다(추정).
```

`/code-review` 1회차도 같은 문제를 짚었습니다. 그 지적은 "OrderPage still shows the cancel and return buttons only when order.canCancel / order.canReturn are true … so neither button ever appears"입니다.

**고치는 법** — 취소·반품 가능 여부는 서버가 계속 계산해 응답에 둡니다(커머스 프리셋 `COM-024`). 정말 화면으로 옮긴다면 계약(`openapi.yaml`)·생성 타입·화면을 같은 PR에서 함께 바꿉니다.

## 2. 이슈에만 적힌 요구사항을 놓친 경우 — `INTENT-001`

**짧은 diff** — PR 제목 "feat: 메뉴에서 품절 상품 정리", 본문 `closes #41`

```diff
 // web/src/pages/MenuPage.tsx
-      {products.map((product) => (
+      {products
+        .filter((product) => !product.soldOut)
+        .map((product) => (
```

**추가로 확인한 맥락** — PR 본문에는 이슈 번호만 있습니다. gimi의 맥락 수집은 `gh`로 이슈 #41 본문을 읽어 맥락 묶음에 넣었습니다.

> 이슈 #41 — 품절 상품은 숨기지 않고 메뉴 맨 아래로 보낸다. 품절 표시와 막힌 담기 버튼은 지금처럼 둔다.

평가에서는 실제 GitHub 대신 가짜 `gh`(`scripts/fake-gh.mjs`)가 두 리뷰어에게 같은 이슈를 줍니다.

**리뷰 결과** — 실제 실행 2026-10-27, `claude-opus-5-5`, 리뷰어마다 2번

| 리뷰어 | 요구사항과 어긋난다고 짚음(제가 출력을 읽고 셈) |
|---|---|
| gimi | 2번 중 2번 — 두 번 모두 이슈 #41을 인용 |
| `/code-review` | 2번 중 1번 — 1회차는 옛 테스트에서 "숨기면 품절 상태가 안 보인다"고 추론, 2회차는 빈 목록·죽은 코드·장바구니만 짚음 |

gimi 1회차 출력에서 옮겼습니다(일부, $0.26 · 52초).

```text
고쳐야 함
1. 요구사항과 반대로 구현됐습니다 (web/src/pages/MenuPage.tsx:27). 이슈 #41은 "품절 상품은 숨기지 않고 메뉴 맨 아래로 보낸다",
   "품절 표시와 막힌 담기 버튼은 지금처럼 둔다"를 요구합니다. 그런데 이 PR은 .filter(!soldOut)로 품절 상품을 숨깁니다.
   커밋 메시지의 closes #41 때문에 머지하면 이슈도 닫힙니다.
2. 이슈가 그대로 두라고 한 동작의 테스트를 지웠습니다 (web/src/pages/menu.test.tsx:6).
```

이 사례는 위치 점수의 한계도 보여 줍니다. 그때 채점표는 위치(정답 줄 ±3)로 셌고, 두 리뷰어 모두 2번 중 2번이었습니다. 그런데 `/code-review` 2회차는 정답 줄 근처의 다른 문제(필터 뒤 죽은 코드)로 위치만 맞았습니다([결과 문서](../evals/review/results/2026-10-27-intent.md)). 그래서 요구사항을 짚었는지는 출력을 읽고 따로 셌습니다. 지금은 평가에 사람이 판정하는 양식(`judgments.json`)이 있습니다([평가 안내](../evals/review/README.md)).

**고치는 법** — `filter` 대신 품절 상품을 뒤로 보내는 안정 정렬을 씁니다. 지운 테스트(품절 버튼이 막혀 있다)를 되살리고, 품절 상품이 마지막 카드인지도 확인합니다.

## 3. 과거 버그 수정을 되돌리는 경우 — `HIST-001`

**짧은 diff** — PR 제목 "refactor: 반품 기한 계산을 읽기 쉽게 정리한다", 본문 "결과는 같다"

```diff
 // server/src/orders/returns-policy.ts
-  const kst = new Date(deliveredAt.getTime() + KST_OFFSET_MS)
-  const startOfDeliveryDay = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - KST_OFFSET_MS
+  // 받은 날 0시(한국 시간)를 한 줄로 구한다
+  const startOfDeliveryDay = Date.UTC(deliveredAt.getUTCFullYear(), deliveredAt.getUTCMonth(), deliveredAt.getUTCDate()) - KST_OFFSET_MS
```

**추가로 확인한 맥락** — gimi의 맥락 수집은 지운 줄을 넣은 커밋을 찾았습니다.

- 커밋 "fix: 새벽에 받은 주문의 반품 기한이 하루 짧던 문제 — 받은 날을 한국 날짜로 센다". 지운 `kst` 줄이 이 수정이다.
- 그 커밋이 더한 회귀 테스트: "새벽에 받은 주문도 받은 날을 한국 날짜로 센다"(이 PR에서 안 바뀜)

**리뷰 결과** — 실제 실행 2026-10-26, `claude-opus-5-5`, 리뷰어마다 2번

| 리뷰어 | 찾음(위치) | 한 번의 비용·시간(1회차) |
|---|---|---|
| gimi | 2번 중 2번 | $0.20 · 29초 |
| `/code-review` | 2번 중 2번 | $0.14 · 29초 |

gimi 1회차 출력에서 옮겼습니다(일부).

```text
[고쳐야 함] 이력
"결과는 같다"는 리팩터링이 직전 버그 수정(71291ef)을 그대로 되돌린다

바뀐 곳  server/src/orders/returns-policy.ts:14
근거    git show 71291ef — "새벽에 받은 주문의 반품 기한이 하루 짧던 문제"를 고친 커밋이다.
         그 커밋에서 지운 줄과 이번 PR의 14번째 줄이 한 글자도 다르지 않다.
상황    2026-10-20 02:30(KST)에 받은 주문(2026-10-19T17:30Z)의 마감:
         수정 전 2026-10-27T15:00Z → 이번 PR 2026-10-26T15:00Z, 하루 짧아진다.
테스트  위 회귀 테스트가 실패할 것으로 추정한다. 테스트 스위트는 돌려 보지 않았다(DB가 필요하다).
```

`/code-review` 1회차도 "drops … the bug 71291ef fixed"라며 같은 커밋을 짚었습니다.

**고치는 법** — 중간 변수를 없애더라도 날짜를 구하기 전에 한국 시간 오프셋을 더하는 단계는 남깁니다(`new Date(deliveredAt.getTime() + KST_OFFSET_MS)`). 회귀 테스트가 이 경우를 지킵니다.

## 직접 돌려 보기

준비할 것은 다음과 같습니다.

- Node.js 22 이상, git
- 로그인한 Claude Code CLI(`claude`) — 실제 모델을 부르므로 비용이 듭니다. 위 기록과 2026-10-31 평가(gimi 평균 $0.41·57초) 기준으로 리뷰 한 번에 약 $0.1~0.5, 30초~1분입니다.
- gimi 저장소의 개발 의존성과 예제 앱 의존성

```bash
git clone https://github.com/Guksu/gimi && cd gimi
npm ci && (cd evals/shop-fixture && npm ci)
node scripts/review-eval.mjs run COM-024 INTENT-001 HIST-001 --reviewer gimi --model claude-opus-5-5 --out /tmp/gimi-cases
node scripts/review-eval.mjs score /tmp/gimi-cases
```

`run`은 결함마다 임시 저장소(정상 버전 `main`, 결함 PR `feature/pr`)를 만들고 가짜 `gh`로 이슈를 줍니다. `score`는 `/tmp/gimi-cases/score.md`에 채점표를, `judgments.json`에 판정 양식을 씁니다.

예상 결과는 다음과 같습니다.

- `COM-024` — `web/src/pages/OrderPage.tsx`의 버튼이나 계약 파일을 근거로 한 "고쳐야 함"
- `INTENT-001` — 이슈 #41을 인용한 "고쳐야 함"
- `HIST-001` — "새벽에 받은 주문…" 수정 커밋을 인용한 "고쳐야 함"

모델 출력은 실행마다 다르고, 지금 gimi는 위 기록의 판과 다릅니다. 같은 문장이 나온다고 기대하지는 마세요.

손으로 보려면 결함 PR 저장소만 만들고 그 안에서 gimi를 부릅니다.

```bash
node scripts/defects.mjs materialize COM-024 /tmp/pr --branch feature/pr --link-deps
cd /tmp/pr   # 여기서 Claude Code를 열고 "gimi-review로 지금 브랜치를 리뷰해줘"
```

이 방법에는 가짜 `gh`가 없습니다. 그래서 `INTENT-001`은 이슈 #41을 읽지 못합니다. 대신 이슈 본문(`evals/shop-fixture/defects/INTENT-001/defect.json`의 `issues`)을 붙여 넣어 주세요.
