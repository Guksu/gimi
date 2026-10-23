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
| `id` | 폴더 이름과 같다. 프리셋 규칙의 결함이면 규칙 ID를 쓴다 |
| `rules` | 어긴 규칙 ID. `슬롭`·`도메인 규칙` 결함은 하나 이상 적는다. `영향 범위`·`의도`·`이력` 결함은 비워도 된다 |
| `context` | 맥락 종류 — 영향 범위·의도·이력·슬롭·도메인 규칙 |
| `layer` | 프론트·백엔드·둘 다 |
| `pr` | 결함 커밋의 메시지가 된다. 제목은 첫 줄, 본문은 그 아래 |
| `findings` | 정답. 단계(고쳐야 함·고치면 좋음·확인 질문) + 결함 버전의 `path:line`(범위면 `endLine`까지). `evidence`는 지적에 필요한 맥락의 위치다. 채점에서 맥락 묶음에 이 위치가 없으면 "수집 실패", 있는데 지적하지 못하면 "판단 실패"로 나눈다 |
| `clean` | `true`면 결함이 없는 PR이다(오탐을 잰다). `findings`·`catches`를 비운다 |
| `catches` | 결함을 잡는 테스트 파일(선택). 정상 버전에 있고 패치가 고치지 않는 파일이어야 한다. 정상 버전에서 통과하고 결함 버전에서 실패해야 한다 |

## 명령

gimi 저장소 루트에서 돌린다.

```bash
node scripts/defects.mjs check [ID…]           # 패치가 붙는지, defect.json 형식·정답 위치, 잡는 테스트, 패턴 예시
node scripts/defects.mjs check --no-tests      # 잡는 테스트를 빼고(PostgreSQL 없이)
node scripts/defects.mjs materialize <ID> <폴더> # 평가용 저장소 — main = 정상 버전, defect/<ID> = 결함 PR
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

정상 버전을 고쳐 패치가 붙지 않게 되면 `check`가 실패한다. 그 결함의 패치를 새 정상 버전에서 다시 만든다.

## 지금 있는 결함

| ID | 층 | 무엇을 심었나 | 잡는 테스트 · 패턴 예시 |
|---|---|---|---|
| COM-007 | 백엔드 | 남은 수량을 알려 주려고 재고를 읽고 앱에서 비교한 뒤 계산한 값으로 덮어쓴다 — 동시 주문이 모두 통과한다 | `server/test/orders.test.ts` 동시 주문 · `concurrency` |
| COM-016 | 프론트 | 결제하기를 누를 때마다 새 멱등 키를 만든다 — 응답이 끊긴 뒤 다시 누르면 주문이 하나 더 생긴다 | `web/src/pages/checkout.test.tsx` 응답이 끊긴 뒤 재시도 · `api-boundary` |
| COM-018 | 백엔드 | 결제 완료를 반영할 때마다 포인트를 쌓는다(이미 반영했는지 확인보다 앞) — 확정 요청과 웹훅이 겹치면 두 번 쌓인다 | `server/test/webhooks.test.ts` 확정 뒤 웹훅 · `idempotency` |
| COM-019 | 백엔드 | 승인 요청의 타임아웃을 확실한 거절로 처리한다 — PG는 승인했는데 주문은 결제 실패 | `server/test/payments.test.ts` 늦은 응답 · `external-api-fake` |
| COM-021 | 백엔드 | 웹훅 본문의 상태로 바로 반영하고 PG를 다시 조회하지 않는다 — 본문만 결제 완료인 웹훅으로 주문이 확정된다 | `server/test/webhooks.test.ts` 본문을 믿지 않음 · `webhook-contract` |
| KCL-001 | 백엔드 | 반품 기한을 배송 시각 + 7×24시간으로 따로 계산한다 — 화면이 보이는 마감(7일째 23:59)보다 일찍 막는다 | `server/test/refunds-returns.test.ts` 7일째 경계 · `domain-boundaries` |
