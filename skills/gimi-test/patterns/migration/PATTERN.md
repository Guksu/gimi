---
name: migration
description: DB 마이그레이션을 빈 DB가 아니라 데이터가 있는 DB에 올려, 실패하지 않고 있던 데이터가 남는지 테스트한다 — 따로 만든 스키마에 이전 마이그레이션까지 올리고 운영처럼 데이터를 넣은 뒤 새 마이그레이션을 하나씩 올린다. "마이그레이션 테스트, 데이터가 있는 DB에서 올리기, NOT NULL 열 추가, 스키마 변경 뒤 기존 데이터, 마이그레이션 올리기·내리기, 열 이름 바꾸기·지우기" 요청에 쓴다.
target: 백엔드
---

# migration — 빈 DB가 아니라 데이터가 있는 DB에 올린다

## 언제 쓰는가

마이그레이션 파일을 더하거나 바꿀 때 쓴다. 테스트는 보통 빈 DB에 모든 마이그레이션을 올리고 시작한다. 그래서 기본값 없는 `NOT NULL` 열 추가처럼 **데이터가 있어야 실패하는 마이그레이션**은 테스트를 통과하고 배포에서 멈춘다. 이 패턴은 운영 DB처럼 데이터가 쌓인 상태에 새 마이그레이션을 올려 본다.

관련 규칙은 공통 금지선 `code/unsafe-migration`(되돌리기 어려운 마이그레이션을 한 번에 하지 않는다)이다.

## 무엇을 단언하는가

| 단언 | 왜 |
|---|---|
| 첫 마이그레이션 뒤에 데이터를 넣고 나머지를 하나씩 올려도 실패하지 않는다 | 새 열·제약이 기존 행과 부딪히는지는 행이 있어야 드러난다 |
| 올린 뒤에도 있던 행과 값이 그대로다 | 열 이름 바꾸기·지우기·형 바꾸기는 실패 없이 데이터를 잃는다 |
| 마이그레이션은 앱과 같은 방식(파일마다 트랜잭션 하나)으로 올린다 | 다르게 올리면 운영에서 실패할 것이 테스트에서 통과한다 |
| 되돌리기(down)가 있는 프로젝트면 내린 뒤 다시 올려도 같다 | 배포를 되돌릴 때 쓰는 길이다 |

## 예시

| 파일 | 무엇을 |
|---|---|
| `assets/migrations.test.ts` | 좋은 예시 — 따로 만든 스키마에 첫 마이그레이션을 올리고 시드와 옛 주문을 넣은 뒤, 나머지를 하나씩 올리고 주문이 그대로인지 본다 |
| `assets/migrations.slop.test.ts` | 슬롭 예시 — 빈 스키마에 모두 올리고 표가 생겼는지만 본다. 기본값 없는 `NOT NULL`을 더해도 통과한다 |

다른 테스트가 쓰는 스키마를 건드리지 않게, 연결의 `search_path`로 테스트 전용 스키마를 쓴다.

```ts
pool = new Pool({ connectionString: TEST_URL, options: '-c search_path=migration_check' })
await pool.query('DROP SCHEMA IF EXISTS migration_check CASCADE; CREATE SCHEMA migration_check')

const [first, ...rest] = MIGRATIONS
await apply(first)
await fillLikeProduction() // 첫 마이그레이션에 있던 열만 쓴다
for (const name of rest) await apply(name)
```

주문 표에 기본값 없는 `NOT NULL` 메모 열을 더하면 좋은 예시는 `column "memo" of relation "orders" contains null values`로 실패하고, 슬롭 예시는 그대로 통과한다.

## AI가 흔히 쓰는 테스트 / 대신

| 흔히 | 왜 놓치나 | 대신 |
|---|---|---|
| 빈 DB에 모두 올리고 표가 있는지 본다 | 데이터가 있어야 실패하는 마이그레이션을 놓친다 | 이전 단계까지 올리고 데이터를 넣은 뒤 새 것을 올린다 |
| 마이그레이션 테스트를 쓰지 않고 앱 테스트가 통과하면 됐다고 한다 | 앱 테스트는 빈 DB에서 시작한다 | 마이그레이션만 따로 시험한다 |
| 공용 테스트 스키마를 지우고 다시 만든다 | 다른 테스트 파일의 데이터를 망친다 | 테스트 전용 스키마를 만들고 끝나면 지운다 |
| 넣는 데이터를 지금 스키마에 맞춰 쓴다 | 옛 스키마에 없는 열이라 데이터를 넣지 못한다 | 데이터를 넣는 시점의 스키마에 있던 열만 쓴다 |
| 올라가는지만 본다 | 이름 바꾸기·지우기는 실패 없이 데이터를 잃는다 | 올린 뒤 있던 행의 값을 본다 |

## Jest와 다른 줄

다른 줄이 없다. `pg`와 `beforeAll`·`afterAll`은 Jest에서도 같다.

## 주의사항

- 테스트 파일이 같은 DB를 쓰면 파일을 하나씩 돌린다(Vitest `fileParallelism: false`). 전용 스키마도 이름이 겹치지 않게 한다.
- 시드가 지금 스키마에 맞춰 커지면 옛 스키마에 넣을 수 없게 된다. 그때는 이 테스트가 넣을 데이터를 따로 적는다.
- 큰 표의 잠금 시간(인덱스 만들기 등)은 이 테스트로 보지 못한다. 리뷰에서 본다(`code/unsafe-migration`).
- 마이그레이션 도구(Prisma Migrate·TypeORM·Flyway)가 있으면 도구의 "특정 버전까지 올리기"를 쓴다.

## 다른 언어

| 언어 | 특정 버전까지 올리기 |
|---|---|
| Java·Kotlin | Flyway `target` 설정, Liquibase `update-count` |
| Python | Alembic `command.upgrade(config, "<리비전>")` 뒤 `upgrade(config, "head")` |
| Go | golang-migrate `m.Migrate(version)` 뒤 `m.Up()` |
