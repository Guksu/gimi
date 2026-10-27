# 결함 PR

리뷰 품질 평가(설계 결정 15)와 프리셋 근거(결정 41)에 쓰는 결함 PR이다. 결함마다 폴더 하나를 둔다.

```text
defects/{ID}/
  change.patch   정상 버전(예제 저장소에서 defects/를 뺀 것)에 붙이는 diff. 경로는 예제 저장소 루트 기준
  defect.json    어긴 규칙·맥락 종류·PR 제목과 본문·정답·잡는 테스트
```

이 폴더는 리뷰하는 쪽에 보이지 않는다. 평가용 저장소를 만들 때 정상 버전에서 `defects/`를 뺀다. 정상 버전의 코드·주석·README에도 결함이나 평가를 가리키는 말을 쓰지 않는다.

## defect.json

```json
{
  "id": "COM-007",
  "rules": ["COM-007"],
  "context": "도메인 규칙",
  "layer": "백엔드",
  "pr": { "title": "feat: …", "body": "## 배경\n…" },
  "findings": [
    {
      "level": "고쳐야 함",
      "summary": "무엇이 왜 틀렸는지 한두 문장",
      "path": "server/src/orders/orders.service.ts",
      "line": 65,
      "endLine": 68,
      "evidence": [{ "path": "server/src/orders/orders.service.ts", "line": 54 }]
    }
  ],
  "catches": ["server/test/orders.test.ts"]
}
```

| 필드 | 뜻 |
|---|---|
| `id` | 폴더 이름과 같다. 프리셋 규칙의 결함이면 규칙 ID를 쓴다. 공통 금지선(`code/…`·`test/…`)의 결함이면 `/` 뒤의 이름을 쓴다 |
| `rules` | 어긴 규칙 ID. `슬롭`·`도메인 규칙` 결함은 하나 이상 적는다. `영향 범위`·`의도`·`이력` 결함은 비워도 된다 |
| `context` | 맥락 종류 — 영향 범위·의도·이력·슬롭·도메인 규칙 |
| `layer` | 프론트·백엔드·둘 다 |
| `pr` | 결함 커밋의 메시지가 된다. 제목은 첫 줄, 본문은 그 아래 |
| `findings` | 정답. 단계(고쳐야 함·고치면 좋음·확인 질문) + 결함 버전의 `path:line`(범위면 `endLine`까지). `evidence`는 지적에 필요한 맥락이다 — 위치(`{ "path", "line" }`), 이력 커밋(`{ "commit": "커밋 메시지 앞부분" }`, `history`에 있어야 한다), 이슈(`{ "issue": 번호 }`, `issues`에 있어야 한다). 채점에서 맥락 묶음에 이 근거가 없으면 "수집 실패", 있는데 지적하지 못하면 "판단 실패"로 나눈다 |
| `clean` | `true`면 결함이 없는 PR이다(오탐을 잰다). `findings`·`catches`를 비운다 |
| `history` | 이력 결함만(선택). 평가용 저장소의 `main`에 쌓을 예전 커밋 목록 — `{ "message": "fix: …", "patch": "history/01-….patch" }`. 패치는 그 커밋 앞의 상태 → 뒤의 상태이고, 마지막 커밋 뒤가 정상 버전이다 |
| `issues` | 의도 결함만(선택). 리뷰 평가의 가짜 gh가 돌려줄 GitHub 이슈 — `{ "number": 41, "title": "…", "body": "…" }`. PR 본문에는 `closes #41`처럼 번호만 두고 요구사항은 이슈 본문에만 둔다. 평가용 저장소에는 들어가지 않는다 |
| `catches` | 결함을 잡는 테스트 파일(선택). 정상 버전에 있고 패치가 고치지 않는 파일이어야 한다. 정상 버전에서 통과하고 결함 버전에서 실패해야 한다 |

## 명령

gimi 저장소 루트에서 돌린다.

```bash
node scripts/defects.mjs check [ID…]           # 패치가 붙는지, defect.json 형식·정답 위치, 잡는 테스트, 패턴 예시
node scripts/defects.mjs check --no-tests      # 잡는 테스트를 빼고(PostgreSQL 없이)
node scripts/defects.mjs materialize <ID> <폴더> # 평가용 저장소 — main = 정상 버전, defect/<ID> = 결함 PR
node scripts/defects.mjs materialize <ID> <폴더> --branch feature/pr --link-deps
                                               # 결함 브랜치 이름을 바꾸고, 예제 저장소의 node_modules를 링크한다(리뷰 평가가 쓴다)
node scripts/defects.mjs base <폴더>             # 정상 버전만 — 새 결함을 만들 때
```

잡는 테스트와 패턴 예시는 예제 저장소의 의존성(`npm ci`)과 PostgreSQL(`npm run db:up`)이 있어야 돌린다. 커밋 작성자와 시각을 고정해, 같은 결함은 언제 만들어도 커밋 해시가 같다.

## 패턴 예시

gimi-test의 패턴 예시(`skills/gimi-test/patterns/{패턴}/assets/`)도 결함 버전에서 돌려 본다. `evals/patterns/{패턴}.json`에 예시마다 두는 자리(`at`)와 대는 결함(`defect`)을 적는다.

```json
{ "pattern": "concurrency", "assets": [{ "file": "stock-race.test.ts", "at": "server/test/stock-race.test.ts", "defect": "COM-007" }] }
```

`check`는 그 결함의 정상·결함 버전에 예시를 복사한다. 정상 버전에서 워크스페이스 타입 검사와 예시가 통과해야 하고, 결함 버전에서 좋은 예시(`*.test.ts(x)`)는 실패·슬롭 예시(`*.slop.test.ts(x)`)는 통과해야 한다. `at`은 정상 버전에 없는 새 테스트 파일이어야 한다.

## 새 결함 만들기

1. `node scripts/defects.mjs base <폴더>`로 정상 버전 저장소를 만든다.
2. 그 저장소에서 결함을 심는다. 실제 PR처럼 기능 하나를 하는 변경 안에 둔다. 결함을 알려 주는 주석이나 이름은 쓰지 않는다.
3. `git diff > defects/{ID}/change.patch`로 패치를 저장하고 `defect.json`을 쓴다.
4. 결함을 잡는 테스트가 정상 버전에 없으면 예제 저장소에 먼저 더한다(정상 버전에서 통과해야 한다).
5. `node scripts/defects.mjs check {ID}`가 통과하는지 본다. 정답 줄은 `materialize`로 만든 저장소에서 확인한다.

이력 결함(예전 수정을 되돌리는 PR)은 그 수정 커밋도 만든다. 정상 버전 저장소에서 수정 전 상태로 되돌린 뒤 `git diff -R > defects/{ID}/history/01-….patch`로 저장한다(수정 전 → 정상 버전). `materialize`는 이 패치를 거꾸로 풀어 처음 상태를 커밋하고, 다시 올려 수정 커밋을 쌓는다. 수정 커밋에 재현 테스트가 있으면 정상 버전에도 그 테스트가 있어야 한다.

정상 버전을 고쳐 패치가 붙지 않게 되면 `check`가 실패한다. 그 결함의 패치를 새 정상 버전에서 다시 만든다.

## 지금 있는 결함

| ID | 층 | 무엇을 심었나 | 잡는 테스트 · 패턴 예시 |
|---|---|---|---|
| COM-003 | 백엔드 | 요청 본문의 total을 주문 금액으로 저장한다 — 요청을 바꾸면 그 금액으로 결제된다 | `server/test/orders.test.ts` 요청의 금액 무시 · `test-principles` |
| COM-007 | 백엔드 | 남은 수량을 알려 주려고 재고를 읽고 앱에서 비교한 뒤 계산한 값으로 덮어쓴다 — 동시 주문이 모두 통과한다 | `server/test/orders.test.ts` 동시 주문 · `concurrency` |
| COM-015 | 프론트 | 서버가 확인 중(202)이라고 해도 주문을 불러와 완료 화면을 보인다 — 결제 대기 주문이 '결제가 끝났어요'로 보인다 | `web/src/pages/payment.test.tsx` 확인 중 · `async-ui-states` |
| COM-012 | 프론트 | 반품 마감 날짜를 기기 시간대로 보인다('23:59까지'는 그대로) — 한국보다 빠른 시간대에서 날짜가 하루 뒤로 보인다 | 없음(정상 버전의 테스트는 한국·UTC에서 돌아 못 잡는다) · `fake-time` |
| COM-016 | 프론트 | 결제하기를 누를 때마다 새 멱등 키를 만든다 — 응답이 끊긴 뒤 다시 누르면 주문이 하나 더 생긴다 | `web/src/pages/checkout.test.tsx` 응답이 끊긴 뒤 재시도 · `api-boundary` |
| COM-028 | 프론트 | 보낸 구매 이벤트를 기록하지 않는다 — 결과 화면을 새로 고칠 때마다 다시 나간다 | `web/src/pages/payment.test.tsx` 구매 이벤트 한 번 · `race-and-duplicate` |
| COM-018 | 백엔드 | 결제 완료를 반영할 때마다 포인트를 쌓는다(이미 반영했는지 확인보다 앞) — 확정 요청과 웹훅이 겹치면 두 번 쌓인다 | `server/test/webhooks.test.ts` 확정 뒤 웹훅 · `idempotency` |
| COM-019 | 백엔드 | 승인 요청의 타임아웃을 확실한 거절로 처리한다 — PG는 승인했는데 주문은 결제 실패 | `server/test/payments.test.ts` 늦은 응답 · `external-api-fake` |
| COM-021 | 백엔드 | 웹훅 본문의 상태로 바로 반영하고 PG를 다시 조회하지 않는다 — 본문만 결제 완료인 웹훅으로 주문이 확정된다 | `server/test/webhooks.test.ts` 본문을 믿지 않음 · `webhook-contract` |
| KCL-005 | 프론트 | 결제 동의 체크를 처음부터 켜 둔다 — 원클릭 구매가 된다 | `web/src/pages/checkout.test.tsx` 동의는 비어 있음 · `user-interaction` |
| COM-024 | 둘 다 | 주문 응답에서 canCancel·canReturn을 뺀다(계약·web은 그대로) — web의 취소·반품 버튼이 사라진다 | `server/test/refunds-returns.test.ts` canCancel · `api-contract` |
| COM-029 | 백엔드 | 무료 배송을 쿠폰 전 상품 금액으로 정한다 — PR 본문의 요구사항(쿠폰 뒤 금액)과 다르다(의도) | `server/test/pricing.test.ts` 쿠폰 뒤 금액 · `requirement-cases` |
| HIST-001 | 백엔드 | 받은 날 0시를 "한 줄로 정리"하며 예전 수정(한국 시간 날짜 경계)을 되돌린다 — 새벽 배송의 마감이 하루 이르다(이력) | `server/test/refunds-returns.test.ts` 새벽 배송 · `regression-first` |
| KCL-001 | 백엔드 | 반품 기한을 배송 시각 + 7×24시간으로 따로 계산한다 — 화면이 보이는 마감(7일째 23:59)보다 일찍 막는다 | `server/test/refunds-returns.test.ts` 7일째 경계 · `domain-boundaries` |
| missing-ownership | 백엔드 | 주문을 기본 키로만 조회한다(요청자 조건을 뺌) — 남의 주문을 조회·취소할 수 있다 | `server/test/orders.test.ts` 남의 주문 · `db-integration` |
| IMPACT-001 | 백엔드 | 상태 전이 실패를 false 대신 409 예외로 바꾼다 — false에 기대던 호출처(카드 재거절·결제 반영·취소)가 깨진다. 근거는 바꾸지 않은 호출처에만 있다 | `server/test/payments.test.ts` 다시 결제해 또 거절 · 없음 |
| IMPACT-002 | 프론트 | 결제 뒤 뒤로 가기를 막으려고 공용 navigate를 replaceState로 바꾼다 — 앱 전체의 뒤로 가기가 깨진다. 근거는 바꾸지 않은 호출처에만 있다 | `web/src/pages/cart.test.tsx` 주문하기 뒤 뒤로 가기 · 없음 |
| CONTRACT-001 | 둘 다 | 견적 응답의 freeShippingThreshold를 freeShippingRemaining으로 바꾸고 web·생성 타입은 그대로 둔다 — 무료 배송 안내가 조용히 사라진다 | `server/test/pricing.test.ts` 견적 응답 · 없음 |
| HIST-002 | 백엔드 | 재고 차감을 결제가 끝날 때로 옮긴다 — 예전에 같은 변경을 했다가 되돌렸다(결제창에 있는 동안 재고가 팔렸다). 근거는 되돌린 커밋에만 있다(이력) | `server/test/orders.test.ts` 동시 주문 · 없음 |
| INTENT-001 | 프론트 | 이슈 #41은 품절 상품을 맨 아래로 보내라는데 숨긴다(테스트도 "보이지 않는다"로 바꿈). 요구사항은 이슈에만 있다 | 없음 · 없음 |
| INTENT-002 | 프론트 | 이슈 #44는 무료 배송 안내를 남은 금액 5,000원 "이하"일 때 보이라는데 미만으로 막는다. 새 테스트는 경계를 놓친다 | 없음 · 없음 |
| INTENT-003 | 백엔드 | 이슈 #45는 수량을 모두 합쳐 20개까지라는데 주문 줄 수를 센다 | 없음 · 없음 |
| INTENT-004 | 백엔드 | 이슈 #46은 사유가 달라도 주문당 반품 한 번이라는데 사유마다 한 번 받는다 | 없음 · 없음 |

## 결함 없는 PR

리뷰어가 문제 없는 변경에 지적을 다는지(오탐) 잰다. `clean: true`로 적고 `findings`·`catches`는 비운다. 정상 버전의 타입 검사와 테스트를 그대로 통과한다.

| ID | 층 | 무엇을 바꿨나 |
|---|---|---|
| CLEAN-001 | 프론트 | 빈 장바구니 문구에 메뉴에서 담으라는 안내를 덧붙인다 |
| CLEAN-002 | 백엔드 | 결제 금액 계산에서 주문 한 줄 검사를 `toLine` 함수로 뺀다 — 검사 순서·오류 코드·메시지는 그대로다 |
| CLEAN-003 | 프론트 | 메뉴를 불러오지 못하면 다시 시도 버튼을 보인다 — 화면 테스트를 함께 더한다 |
| CLEAN-004 | 백엔드 | 정률 할인·포인트 적립의 원 미만 버림 경계값 테스트만 더한다(코드는 그대로) |
| CLEAN-005 | 둘 다 | 주문 응답에 couponCode를 더하고 주문 상세에 쿠폰과 할인 금액을 보인다 — 계약·생성 타입·서버·화면 테스트를 함께 고친다 |
