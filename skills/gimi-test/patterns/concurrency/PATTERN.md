---
name: concurrency
description: 동시에 들어온 요청이 수량이 한정된 자원(재고·1회용 쿠폰·포인트 잔액)을 두 번 쓰지 않는지 실제 DB로 테스트한다 — 같은 요청 N건을 한꺼번에(Promise.all) 보내 성공 1건, 남은 수량, 진 요청의 충돌 응답(409)을 단언한다. 순차 호출 두 번으로 대신하지 않는다. "동시성 테스트, 동시 주문, 동시에 여러 건, 하나만 성공, 재고 초과 판매, 쿠폰 동시 사용, 포인트 동시 차감, 경쟁 상태, race condition" 요청에 쓴다.
target: 백엔드
---

# concurrency — 동시 요청이 한정된 자원을 두 번 쓰지 않는가

## 언제 쓰는가

재고·1회용 쿠폰·포인트 잔액·좌석처럼 **수량이 한정된 자원을 확인하고 차감하는 코드**를 쓰거나 바꿀 때 쓴다. 확인과 차감이 원자적이지 않으면(조회 → 앱에서 비교 → 저장) 동시에 온 요청이 같은 값을 읽고 모두 통과한다. 순차 테스트는 이 틈을 만들지 못해 늘 통과한다.

관련 규칙은 `COM-007`(확인과 차감을 원자적으로)이다. 경계값은 `node <이 스킬 폴더>/scripts/rules.mjs --id COM-007`의 "경계값"에서 가져온다.

## 무엇을 단언하는가

| 단언 | 왜 |
|---|---|
| 성공 응답이 정확히 1건(재고가 N이면 N건) | 더 많으면 초과 판매다 |
| 진 요청은 모두 충돌 응답(409) | 500이면 DB 제약이 막기는 했지만 앱이 그 오류를 처리하지 못한 것이다. 사용자는 서버 오류를 본다 |
| 남은 수량이 0이고 음수가 아니다 | 응답은 맞는데 저장이 틀린 경우를 잡는다 |
| 만들어진 주문 수가 성공 수와 같다 | 응답은 409인데 주문 행이 남는 경우(트랜잭션 밖의 쓰기)를 잡는다 |

## 예시

| 파일 | 무엇을 |
|---|---|
| `assets/stock-race.test.ts` | 좋은 예시 — 재고 1개에 동시 주문 10건, 사용 한도 1인 쿠폰 동시 2건, 잔액을 넘는 포인트 동시 2건 |
| `assets/stock-race.slop.test.ts` | 슬롭 예시 — 순차 주문 두 번. 확인과 차감이 원자적이지 않아도 통과한다 |

`startApp`은 실제 DB(테스트 전용 데이터베이스)와 앱을 띄우고 표를 비운 뒤 시드를 넣는 테스트 도우미다. 프로젝트에 있는 같은 역할의 도우미를 쓴다.

핵심은 요청을 기다리지 않고 한꺼번에 보내는 것이다.

```ts
await t.db.query('UPDATE products SET stock = 1 WHERE id = 1')
const results = await Promise.all(Array.from({ length: 10 }, (_, n) => order(`race-${n}`, { items: [{ productId: 1, quantity: 1 }] })))

expect(results.filter((r) => r.status === 201)).toHaveLength(1)
expect(results.filter((r) => r.status === 409)).toHaveLength(9)
expect(await one('SELECT stock AS n FROM products WHERE id = 1')).toBe(0)
```

재고를 조회한 뒤 앱에서 비교해 계산한 값으로 덮어쓰게 바꾸면 좋은 예시는 10건이 모두 성공해 실패하고, 슬롭 예시는 그대로 통과한다.

## AI가 흔히 쓰는 테스트 / 대신

| 흔히 | 왜 놓치나 | 대신 |
|---|---|---|
| `await` 두 번으로 순차 주문 | 첫 요청이 끝난 뒤에 두 번째가 온다. 경쟁이 없다 | `Promise.all`로 N건을 한꺼번에 |
| 저장소·ORM을 mock하고 `update`가 불렸는지 단언 | 원자성은 DB가 지킨다. mock에는 행 잠금도 조건부 UPDATE도 없다 | 실제 DB(테스트 전용 데이터베이스·컨테이너) |
| 동시 요청 2건 | 타이밍에 따라 겹치지 않을 때가 있다 | 10건 이상으로 겹칠 확률을 올린다 |
| 성공 응답 수만 본다 | 응답은 맞는데 저장이 틀린 경우를 놓친다 | 남은 수량과 만든 행 수까지 |
| 실패를 "4xx면 된다"로 본다 | 500도 실패이고, 다른 4xx는 다른 원인이다 | 충돌 응답 코드(409)를 정확히 |

## Jest와 다른 줄

다른 줄이 없다. `Promise.all`과 supertest는 Jest에서도 같다. 다만 Jest는 테스트 파일을 병렬로 돌린다. 같은 DB를 쓰면 `--runInBand`(Vitest는 `fileParallelism: false`)로 파일을 하나씩 돌린다.

## 주의사항

- 테스트마다 데이터를 비우고 시드를 다시 넣는다. 앞 테스트가 재고를 줄이면 경계가 흔들린다.
- DB 연결 풀이 동시 요청 수보다 작으면 요청이 줄을 서서 경쟁이 줄어든다. 풀 크기는 동시 요청 수 이상으로 둔다.
- 이 테스트가 실패하면 결함이 확실하다. 통과하면 그 타이밍에서 막았다는 뜻일 뿐이다. 확인과 차감이 한 문장(조건부 UPDATE)이거나 행 잠금 안에 있는지 코드도 함께 본다.
- 행 잠금(`SELECT … FOR UPDATE`)으로 고쳤다면 여러 상품을 서로 다른 순서로 담은 주문도 동시에 보내 교착 상태(deadlock)가 나지 않는지 본다.

## 다른 언어

| 언어 | 한꺼번에 보내기 | 실제 DB |
|---|---|---|
| Java·Kotlin | `ExecutorService` + `CountDownLatch`로 같은 순간에 출발시킨다 | Testcontainers PostgreSQL |
| Python | `asyncio.gather` 또는 `ThreadPoolExecutor` | pytest + 테스트 전용 데이터베이스 |
| Go | 고루틴 + `sync.WaitGroup` | testcontainers-go |
