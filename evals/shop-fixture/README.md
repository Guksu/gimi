# 국수집 주문 앱

국수 가게의 온라인 주문 앱이다. 메뉴를 장바구니에 담고, 쿠폰·포인트를 쓰고, 가짜 PG로 결제한 뒤 취소·환불·반품까지 한다. 금액은 모두 원 단위 정수다.

| 폴더 | 내용 |
|---|---|
| `web/` | React 19 + Vite. 메뉴·장바구니·주문 확인·결제 결과·주문 상세 화면 |
| `server/` | NestJS 11 + pg(SQL을 직접 쓴다). 가격 계산·주문·결제 승인·웹훅·취소·환불·반품 |
| `fake-pg/` | 가짜 PG 서버. 결제창·승인·조회·취소·웹훅을 흉내 낸다. 실제 PG사의 API가 아니다 |
| `contracts/openapi.yaml` | server API 계약. `web/src/api/schema.d.ts`는 이 파일에서 만든다 |
| `docker-compose.yml` | PostgreSQL 16. 포트 54329, 로컬 전용 trust 인증(비밀번호 없음) |

## 테스트

Node 22 이상과 Docker가 필요하다.

```bash
npm ci
npm run db:up        # PostgreSQL을 띄운다
npm test             # fake-pg·server·web
npm run typecheck
```

- server 테스트는 `shop_test` 데이터베이스를 만들고, 돌 때마다 비운 뒤 마이그레이션한다. 개발용 `shop` 데이터베이스는 건드리지 않는다.
- server 테스트는 가짜 PG를 테스트 안에서 띄운다. 따로 띄울 것은 PostgreSQL뿐이다.
- 다른 PostgreSQL을 쓰려면 `DATABASE_URL`을 준다. 테스트는 그 주소의 데이터베이스 이름만 `shop_test`로 바꿔 쓴다.

## 로컬에서 띄우기

```bash
DATABASE_URL=postgres://shop@localhost:54329/shop npm run migrate -w server -- --seed
```

`--seed`는 빈 데이터베이스에 한 번만 넣는다. 처음부터 다시 하려면 `npm run db:down` 뒤 `npm run db:up`을 돌린다.

터미널 셋에서 각각 띄운다. 키 값은 가짜 PG와 server가 같기만 하면 된다.

```bash
PG_SECRET_KEY=local_secret PG_CLIENT_KEY=local_client PG_WEBHOOK_SECRET=local_webhook PG_WEBHOOK_URL=http://localhost:4000/webhooks/pg npm start -w fake-pg
```

```bash
npm run build -w server && DATABASE_URL=postgres://shop@localhost:54329/shop PG_BASE_URL=http://localhost:4010 PG_SECRET_KEY=local_secret PG_CLIENT_KEY=local_client PG_WEBHOOK_SECRET=local_webhook WEB_BASE_URL=http://localhost:5173 npm start -w server
```

```bash
npm run dev -w web   # http://localhost:5173 — /api를 server(4000)로 넘긴다
```

로그인은 없다. web은 사용자 1(`x-user-id: 1`)로 요청한다.

## API 계약을 바꿀 때

`contracts/openapi.yaml`을 먼저 고치고 타입을 다시 만든다.

```bash
npm run generate:api -w web
```
