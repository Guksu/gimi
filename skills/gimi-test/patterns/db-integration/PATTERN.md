---
name: db-integration
description: 저장소·SQL을 쓰는 백엔드 코드를 실제 DB(테스트 전용 데이터베이스·컨테이너)로 테스트한다 — 조회 조건(남의 데이터가 안 보이는지), 유니크·CHECK·외래키 제약이 막는지를 DB에 직접 써 보고 단언하며, 테스트마다 데이터를 비워 격리한다. 저장소·ORM·쿼리 함수를 mock하지 않는다. "DB 테스트, 실제 DB로 테스트, 저장소 테스트, 통합 테스트, 유니크 제약, CHECK 제약, 외래키, 테스트 격리, PostgreSQL 테스트, Testcontainers" 요청에 쓴다.
target: 백엔드
---

# db-integration — 저장소는 실제 DB로 테스트한다

## 언제 쓰는가

SQL·ORM으로 데이터를 읽고 쓰는 코드를 쓰거나 바꿀 때 쓴다. 이 코드의 결함은 대개 SQL 안에 있다. 조건 하나가 빠지거나(남의 주문이 보인다), 조인이 틀리거나, 제약이 없어 중복이 저장된다. 저장소를 mock하면 SQL은 한 번도 실행되지 않는다. mock은 어떤 SQL에도 정해 둔 행을 돌려준다.

관련 규칙은 `code/missing-ownership`(ID로 조회만 하고 요청자의 것인지 빼먹지 않는다)과 `test/mock-repository`(저장소·ORM을 통째로 mock하지 않는다)다.

## 무엇을 단언하는가

| 단언 | 왜 |
|---|---|
| 남의 데이터는 조회·수정·삭제 모두 없는 것과 같다(404) | 조회 조건이 빠진 SQL을 잡는다 |
| 같은 키의 중복 저장을 DB가 막는다(유니크) | 앱의 확인을 건너뛰는 동시 요청에도 남는 마지막 방어선이다 |
| 규칙을 어기는 값은 저장되지 않는다(CHECK·외래키) | 환불 누적액 > 결제액, 없는 상품 같은 값 |
| 테스트가 빈 표와 시드에서 시작한다 | 앞 테스트의 데이터에 따라 결과가 바뀌지 않는다 |

제약 위반은 오류 코드로 단언한다. PostgreSQL은 `23505`(유니크), `23514`(CHECK), `23503`(외래키)이다. 오류 문장은 버전·언어 설정에 따라 바뀐다.

## 예시

| 파일 | 무엇을 |
|---|---|
| `assets/order-store.test.ts` | 좋은 예시 — 빈 표에서 시작, 남의 주문 404, 멱등 키 유니크, 환불 CHECK, 상품 외래키 |
| `assets/order-store.slop.test.ts` | 슬롭 예시 — DB를 `vi.fn()`으로 바꾸고 mock이 돌려준 주문을 다시 확인한다. 조회 조건이 빠져도 통과한다 |

남의 데이터는 실제 사용자 두 명으로 확인한다.

```ts
const { order } = await orderWithCheckout(t) // 사용자 1의 주문

expect((await t.as(2).get(`/orders/${order.id}`)).status).toBe(404)
expect((await t.as(2).post(`/orders/${order.id}/cancel`).send({ reason: '단순 변심' })).status).toBe(404)
expect(await one('SELECT status AS n FROM orders WHERE id = $1', [order.id])).toBe('pending_payment')
```

주문을 기본 키로만 조회하게 바꾸면(요청자 조건을 뺌) 좋은 예시는 남의 주문 경우에서 200이 와서 실패하고, 슬롭 예시는 그대로 통과한다.

## AI가 흔히 쓰는 테스트 / 대신

| 흔히 | 왜 놓치나 | 대신 |
|---|---|---|
| 저장소·ORM·`pool.query`를 mock | SQL이 실행되지 않는다. 조건이 빠져도 mock은 행을 돌려준다 | 테스트 전용 실제 DB |
| mock이 돌려준 값을 단언(`order.id === '7'`) | mock에 넣은 값을 다시 읽을 뿐이다 | DB에 쓴 뒤 다른 경로로 읽어 확인 |
| 사용자 한 명으로만 테스트 | 남의 데이터가 보이는 결함을 못 본다 | 사용자 두 명 |
| 인메모리 DB(SQLite 등)로 대신 | 제약·잠금·SQL 문법이 실제 DB와 다르다 | 운영과 같은 DB(컨테이너) |
| 테스트끼리 데이터를 공유 | 순서에 따라 결과가 바뀐다 | 테스트마다 비우고 시드를 넣는다 |

## Jest와 다른 줄

| Vitest | Jest |
|---|---|
| 파일을 하나씩: `fileParallelism: false` | `--runInBand` |
| `globalSetup`에서 마이그레이션 | 같다(`globalSetup`) |

## 주의사항

- 테스트 전용 데이터베이스를 쓴다. 개발용 데이터베이스를 비우면 안 된다. 예시의 도우미는 `shop_test`를 만들어 쓴다.
- 비우기는 `TRUNCATE … RESTART IDENTITY CASCADE`처럼 한 번에 한다. 순서대로 `DELETE`하면 외래키에 걸린다.
- 트랜잭션을 열고 끝에 되돌리는 격리도 있다. 다만 앱이 연결 풀로 다른 연결을 쓰면 그 트랜잭션 밖이라 보이지 않는다.

## 다른 언어

| 언어 | 실제 DB |
|---|---|
| Java·Kotlin | Testcontainers + `@DataJpaTest`(인메모리 대신 `@AutoConfigureTestDatabase(replace = NONE)`) |
| Python | pytest + 테스트 전용 데이터베이스, `pytest-postgresql` |
| Go | testcontainers-go, `database/sql` |
