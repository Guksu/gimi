# 분야 프리셋 — `commerce` (커머스·결제 기술 규칙)

커머스·결제에서 깨지기 쉬운 곳의 기술 규칙이다. 설정 `.agents/gimi.json`의 `presets`에 `commerce`를 넣으면 리뷰(gimi-review)가 쓴다. 규칙 하나가 `## {ID} {한 줄}` 절 하나이고, 회사 규칙(`docs/gimi/rules.md`)과 형식이 같다.

- `대상`은 프론트(React·TypeScript)·백엔드(언어 무관)·둘 다 중 하나다. `scripts/rules.mjs`가 설정의 `stacks`로 걸러 보인다. 언어별 코드 신호는 예로만 든다.
- `확인`은 리뷰에서 볼 코드 신호다. 리뷰가 영향 범위·의도와 함께 판단한다.
- `경계값`은 리뷰가 짚을 경계 입력이다(그 경계를 테스트가 덮는지도 본다). 프론트(입력·표시)와 백엔드(동시 요청·재시도·순서가 바뀐 웹훅)를 나눠 적었다.
- `근거`는 공개 출처다. 2026-10-19에 페이지를 직접 열어 확인했고(일부는 2026-10-21에 다시 확인했다), 인용은 줄이고 바꿔 썼다. 출처가 없는 규칙은 "출처 없음"으로 표시했다.
- 팀의 사정이 다르면 회사 규칙의 `## 끈 프리셋 규칙` 절에 `- COM-004 — 이유`처럼 적어 끈다.

## 금액

## COM-001 금액은 통화의 최소 단위 정수로 다루고 통화 코드를 함께 둔다
- 대상: 둘 다
- 왜: 부동소수 오차로 PG 금액과 1원이 어긋난다. 통화마다 소수 자릿수가 달라(KRW 0, USD 2, KWD 3) 일괄 `× 100`이면 1,000원이 100,000원으로 청구된다
- 대신: 금액은 최소 단위 정수 + 통화 코드로 둔다. 소수가 생기는 중간 계산은 십진 타입(Java `BigDecimal`은 문자열 생성자)에서 하고 COM-002의 함수로 정수로 만든다. PG에 보내는 단위는 PG 문서를 따른다(ISO 표와 다른 통화가 있다)
- 확인: 금액에 `toFixed`, 실수 타입(`double`·`float`) 금액 필드, `new BigDecimal(double)`, `BigDecimal.equals` 비교(2.0 ≠ 2.00), PostgreSQL `money` 타입, `amount * 100` 하드코딩
- 경계값:
  - 프론트: 999원의 10% 할인 표시
  - 백엔드: 1/3 나눗셈, KRW·JPY(0자리)·USD(2자리)·KWD(3자리)
- 근거:
  - Stripe 통화 — zero-decimal 통화와 ISO 표와 다르게 보내야 하는 통화 https://docs.stripe.com/currencies
  - ISO 4217 목록 — KRW 0자리, KWD 3자리 https://www.six-group.com/en/products-services/financial-information/market-reference-data/data-standards.html
  - 토스페이먼츠 Quick Reference — KRW는 정수 https://docs.tosspayments.com/guides/v2/get-started/llms-quick-reference
  - Java `BigDecimal` — double 생성자는 예측하기 어렵고 문자열 생성자를 권한다 https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/math/BigDecimal.html
  - PostgreSQL Don't Do This — `money` 대신 numeric·integer https://wiki.postgresql.org/wiki/Don't_Do_This
  - Python 부동소수 — 10진 소수 대부분은 2진수로 정확히 표현되지 않는다 https://docs.python.org/3/tutorial/floatingpoint.html

## COM-002 반올림·절사는 한 함수에서 하고, 반올림 방식을 명시한다
- 대상: 둘 다
- 왜: 화면마다 `Math.round`·`floor`가 달라 장바구니와 결제 금액이 1원 다르다. Java `divide`를 반올림 방식 없이 부르면 나누어떨어지지 않을 때 예외가 난다. Kotlin BigDecimal `/`는 피제수의 스케일을 유지해 의도와 다르게 반올림된다
- 대신: 모든 금액 계산이 반올림 함수 하나를 거친다. 정책(내림·반올림·HALF_EVEN)을 그 함수에 명시한다
- 확인: 금액 계산에 직접 쓴 `Math.round·floor·ceil`, 반올림 방식 없는 `BigDecimal.divide`, Kotlin BigDecimal `/`
- 경계값:
  - 프론트: 0.5원이 생기는 할인
  - 백엔드: 1000 ÷ 3, 같은 주문을 장바구니·결제·환불에서 계산한 값이 같은가
- 근거:
  - Java `RoundingMode` — HALF_EVEN은 누적 오차를 줄인다 https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/math/RoundingMode.html
  - Kotlin BigDecimal `div` — 피제수 스케일 유지, HALF_EVEN https://kotlinlang.org/api/core/kotlin-stdlib/kotlin/div.html
  - 가격표시제 실시요령 제8조② — 표시단위가격은 1원 단위이고 1원 이하는 반올림한다(2021년 개정본 조문. 국가법령정보센터 현행 본문은 열지 못했다) https://www.ulex.co.kr/%EB%B2%95%EB%A5%A0/2100000207888-33397-%EA%B0%80%EA%B2%A9%ED%91%9C%EC%8B%9C%EC%A0%9C
  - 산업통상자원부 — 2025.4 개정으로 연간 거래금액 10조 원 이상 온라인쇼핑몰도 단위가격 표시 대상(1년 유예) https://www.korea.kr/news/policyNewsView.do?newsId=148934673

## COM-003 결제 금액은 서버가 계산·저장하고, 승인 직전에 대조한 저장값만 PG에 보낸다
- 대상: 둘 다
- 왜: 브라우저 콘솔에서 결제창 요청 금액을 50,000원에서 100원으로 바꾸면, 서버가 리다이렉트로 돌아온 금액을 그대로 승인해 100원 결제로 출고된다
- 대신: 결제창을 열기 전에 주문번호·최종 금액·결제수단을 서버에 저장한다. 승인 직전에 리다이렉트 값과 대조하고, 승인 API에는 저장값만 보낸다. 클라이언트 요청에는 상품 ID와 수량만 받는다
- 확인: 영향 범위 — 결제 요청 금액의 출처. 주문·결제 요청 DTO·스키마의 `price`·`amount`·`total`·`currency` 필드, PG 호출에 그대로 넘긴 `req.query.amount`·`req.body.amount`, 화면 합계로 만든 결제 요청, 숨은 입력칸의 가격
- 경계값:
  - 프론트: 화면이 보낸 금액이 무시되는가(가격을 바꾼 요청)
  - 백엔드: 저장 금액과 1원 다른 승인 요청은 승인하지 않는다, 가격·통화를 바꾼 주문 요청
- 근거:
  - 토스페이먼츠 결제 흐름 — 요청 전에 저장하고 승인 전에 대조 https://docs.tosspayments.com/guides/v2/get-started/payment-flow
  - 토스페이먼츠 Quick Reference §2.2 — 위변조는 인증 전 콘솔에서 일어난다
  - NHN KCP — 승인 요청 때 금액·결제수단·주문번호를 함께 검증 https://developer.kcp.co.kr/guide/pay-check
  - 나이스페이먼츠 — 금액·signature·주문번호 일치를 확인한 뒤 승인 https://github.com/nicepayments/nicepay-manual/blob/main/api/payment-window-server.md
  - KG이니시스 — 결제 요청 해시에 금액이 들어간다 https://manual.inicis.com/pay/stdpay_pc.html
  - 포트원 — 서버가 결제를 조회해 금액을 주문과 비교 https://developers.portone.io/opi/ko/integration/start/v2/checkout
  - Stripe — 청구 금액은 서버에서 정한다 https://docs.stripe.com/payments/accept-a-payment?payment-ui=elements&api-integration=paymentintents
  - OWASP WSTG 결제 기능 — 가격·합계·통화 변조 시험, 클라이언트에서는 상품 ID·수량만 https://wstg.owasp.org/latest/4-Web_Application_Security_Testing/10-Business_Logic/10-Payment_Functionality

## COM-004 금액 표시는 공통 포맷터로 하고, PG 요청에는 포맷한 문자열을 넣지 않는다
- 대상: 프론트
- 왜: 0원·음수·무료 표시가 화면마다 다르다. `toLocaleString()` 결과("10,000")를 결제 요청에 넣으면 거절된다
- 대신: 표시는 `formatPrice` 하나(`Intl.NumberFormat` + 통화)로 한다. 요청에는 정수 숫자를 넣는다(토스 V2 SDK는 `{ value, currency }`)
- 확인: `toLocaleString`과 `'원'` 이어 붙이기, 결제 요청의 `String(price)`·포맷 문자열
- 경계값:
  - 프론트: 0원, 음수(환불), 1,000만 원 이상
- 근거:
  - 토스페이먼츠 Quick Reference — KRW 정수, 문자열 금지
  - KG이니시스 — 금액은 숫자만 https://manual.inicis.com/pay/stdpay_pc.html
  - MDN `Intl.NumberFormat` — 통화 소수 자릿수를 ISO 4217에서 가져온다(표시 쪽 근거는 약하다) https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat

## COM-005 할인 뒤 금액은 0원 이상이고, 0원 주문은 PG를 거치지 않으며, 결제수단별 최소 금액을 지킨다
- 대상: 둘 다
- 왜: 정액 쿠폰이 상품가보다 크면 음수 결제가 된다. 쿠폰으로 50원이 되면 카드 결제가 최소 금액 미달로 실패한다
- 대신: 합계 하한은 0이고 줄마다 음수를 막는다. 0원 주문은 PG 없이 확정하는 경로로 보낸다. 결제수단별 최소 금액을 상수로 두고 결제 전에 막는다
- 확인: 영향 범위 — 할인 계산 사용처. 하한 처리 없음, 0원도 PG 호출, 최소 금액 상수 없음, 묶음 결제에서 줄 단위 음수 허용
- 경계값:
  - 프론트: 쿠폰 = 상품가, 쿠폰 > 상품가일 때 결제 버튼과 안내
  - 백엔드: −1·0·1원, 카드 99/100원, 계좌이체 199/200원, 휴대폰 299/300원(토스 기준 — 다른 PG는 그 문서)
- 근거:
  - OWASP WSTG 결제 기능 — 0원·음수·개별 항목 음수 시험
  - Stripe 통화 — 통화별 최소 청구액 https://docs.stripe.com/currencies
  - 토스페이먼츠 결제수단 — 결제수단별 최소 금액 https://docs.tosspayments.com/guides/v2/get-started/payment-methods
  - 토스페이먼츠 에러 코드 — `BELOW_MINIMUM_AMOUNT` https://docs.tosspayments.com/reference/error-codes

## 할인·재고·수량·시각

## COM-006 할인 적용 순서와 중복 규칙은 한 곳에서 정한다
- 대상: 둘 다
- 왜: 상품 할인·쿠폰·포인트의 적용 순서가 화면마다 달라 상세·장바구니·결제의 합계가 다르다
- 대신: 할인 계산 함수는 서버에 하나 둔다. 프론트는 서버가 준 할인 내역을 표시한다
- 확인: 의도 — 요구사항의 적용 순서·중복 조건. 영향 범위 — 할인 계산이 여러 곳에 있는가
- 경계값:
  - 프론트: 상세·장바구니·결제의 합계가 같다
  - 백엔드: 중복 불가 쿠폰 2장, 정률·정액 순서를 바꿨을 때
- 근거: 출처 없음 — 도메인 관례. 팀의 요구사항으로 확인한다

## COM-007 재고·쿠폰·포인트는 확인과 차감을 원자적으로 하고, 사용 한도는 DB 제약으로 막는다
- 대상: 백엔드
- 왜: 재고 1개에 주문 2건이 동시에 오면 둘 다 확인을 통과해 초과 판매된다. 1회용 쿠폰이 동시에 두 번 쓰이고, 포인트 잔액이 음수가 된다
- 대신: 조건부 갱신(`UPDATE … SET qty = qty - :n WHERE id = :id AND qty >= :n` 뒤 바뀐 행 수 확인), 쿠폰은 `WHERE used_at IS NULL`, 또는 행 잠금(`SELECT … FOR UPDATE`)·버전 컬럼을 쓴다. 쿠폰 사용 기록에 유니크 제약을 둔다
- 확인: 조회 → 앱에서 비교 → 저장(`find → if → save`), JPA `findById` 뒤 setter만 있고 `@Version`·`@Lock` 없음, Prisma `updateMany`의 `count`를 보지 않음, Redis GET 뒤 SET
- 경계값:
  - 백엔드: 재고 1에 동시 N건 → 성공 1건, 같은 쿠폰 동시 N건 → 1건, 잔액과 같은 금액 동시 2건 → 1건
- 근거:
  - OWASP WSTG 결제 기능 — 잔액·재고·1회용 쿠폰의 경쟁 상태, 행 잠금·버전 컬럼·멱등 키
  - OWASP WSTG 기능 사용 횟수 제한 — 할인 1회 제한 우회, DB 수준에서 막을 것 https://wstg.owasp.org/latest/4-Web_Application_Security_Testing/10-Business_Logic/05-Number_of_Times_a_Function_Can_Be_Used_Limits
  - OWASP ASVS 5.0 V2 2.3.3·2.3.4 — 수량 한정 자원의 이중 예약을 잠금으로 막는다 https://github.com/OWASP/ASVS/blob/master/5.0/en/0x11-V2-Validation-and-Business-Logic.md
  - PostgreSQL 격리 수준 — 동시 UPDATE는 갱신된 행에 WHERE를 다시 평가한다 https://www.postgresql.org/docs/current/transaction-iso.html
  - Hibernate 낙관적 잠금 — `@Version` 충돌 통보 https://docs.hibernate.org/orm/6.6/userguide/html_single/Hibernate_User_Guide.html#locking-optimistic

## COM-008 포인트는 사용 단위·보유량·결제 금액 안에서만 쓴다
- 대상: 둘 다
- 왜: 보유량보다 많이, 사용 단위(예: 10원)에 맞지 않게, 결제 금액보다 많이 쓴다
- 대신: 프론트는 입력을 막고 서버가 다시 검증한다(차감은 COM-007). 이용 조건·기간·소멸 조건을 게시한다
- 확인: 영향 범위 — 포인트 입력·차감 경로
- 경계값:
  - 프론트: 단위 미만 입력, 보유량 + 1 입력
  - 백엔드: 보유량과 같은 금액, 보유량 + 1, 결제 금액 초과
- 근거:
  - OWASP WSTG 결제 기능 — 잔액 경쟁
  - 전자상거래 소비자보호 지침 Ⅱ16 — 적립금의 이용 조건·기간·소멸 조건 게시 https://www.law.go.kr/행정규칙/전자상거래등에서의소비자보호지침

## COM-009 품절이면 모든 담기 경로를 막고, 서버도 재고를 검사한다
- 대상: 둘 다
- 왜: 상세에서만 막고 목록의 빠른 담기·장바구니 수량 변경은 열려 있다. 화면 차단만으로는 요청을 직접 보내면 뚫린다
- 대신: 담기·수량 변경이 같은 판정 함수를 거친다(프론트). 서버는 담기·주문 때 재고를 검사한다(COM-007)
- 확인: 영향 범위 — 품절·재고 판정과 담기 경로 전부
- 경계값:
  - 프론트: 재고 0에서 목록 빠른 담기·장바구니 + 버튼
  - 백엔드: 재고 0에 직접 보낸 담기 요청
- 근거:
  - OWASP ASVS 5.0 V2 2.2.1·2.2.2 — 업무 규칙은 신뢰할 수 있는 서버 층에서 검증하고, 클라이언트 검증은 보안 통제로 보지 않는다 https://github.com/OWASP/ASVS/blob/master/5.0/en/0x11-V2-Validation-and-Business-Logic.md

## COM-010 수량은 서버에서 양의 정수인지, 상한을 넘지 않는지 모든 경로에서 검증한다
- 대상: 둘 다
- 왜: `quantity=-1`이나 삭제 반복으로 수량이 음수가 되면 합계가 준다. 0.1개 주문, 중복 파라미터도 통과한다. JavaScript `Number("")`는 0이고 `parseInt`는 소수를 버린다
- 대신: 담기·수정·삭제 모든 경로에서 `1 ≤ 수량 ≤ min(재고, 구매 제한)`인 정수만 받는다. TypeScript `Number.isSafeInteger`, Java·Kotlin `@Min(1)`·`@Max`. 수량에 실수 타입을 쓰지 않는다
- 확인: `Number(q)`·`parseInt(q)` 뒤 범위 검사 없음, 수량 타입 `Double`
- 경계값:
  - 프론트: 직접 입력·붙여 넣기로 0, 소수, 최대 + 1
  - 백엔드: −1, 0, 0.5, 재고, 재고 + 1, 구매 제한 + 1, 중복 파라미터, 빈 문자열
- 근거:
  - OWASP WSTG 결제 기능 — 소수·음수 수량, 삭제 반복, 파라미터 오염
  - OWASP ASVS 5.0 V2 2.2.1·2.2.2 https://github.com/OWASP/ASVS/blob/master/5.0/en/0x11-V2-Validation-and-Business-Logic.md
  - MDN `Number` — `Number("")`는 0, 정확한 정수는 2^53 − 1까지 https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number

## COM-011 주문 확정 단계에서 가격·재고·한도를 다시 검사하고, 단계 순서는 서버가 강제한다
- 대상: 둘 다
- 왜: 담은 뒤 가격이 오르거나 품절됐는데 옛 값으로 주문된다. 가격을 미리 고정해 두고 유리할 때 결제하거나, 단계를 건너뛴다
- 대신: 확정 직전에 다시 검사하고, 바뀌었으면 사용자에게 보여 다시 확인받는다. 확인 뒤 데이터가 바뀌면 그 확인을 무효로 한다. 결제 가능 시간을 제한한다
- 확인: 의도 — 요구사항의 재확인 흐름. 영향 범위 — 확정 API가 재검사 함수를 부르는가
- 경계값:
  - 프론트: 장바구니에 둔 사이 가격이 바뀐 주문의 안내
  - 백엔드: 확인 뒤 가격 변경, 단계를 건너뛴 요청
- 근거:
  - OWASP WSTG 결제 기능 — 확정 단계에서 한도·잔액 검사
  - OWASP WSTG 처리 시간 — 가격을 고정해 두는 공격, 최대 거래 시간 https://wstg.owasp.org/latest/4-Web_Application_Security_Testing/10-Business_Logic/04-Process_Timing
  - OWASP ASVS 5.0 V2 2.3.1 — 단계를 건너뛰지 못하게
  - OWASP Transaction Authorization — 확인 뒤 데이터가 바뀌면 인가 무효 https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html
  - 포트원 수동 승인 — 승인 전 재고 확인, 승인은 가능한 한 바로 https://developers.portone.io/opi/ko/extra/manual-confirm/readme-v2

## COM-012 시각은 UTC로 저장하고 서버에서 [시작, 끝)으로 비교한다. KST는 경계 정의와 표시에만 쓴다
- 대상: 둘 다
- 왜: 기기 시각으로 쿠폰 만료를 판정하면 자정 전후로 어긋난다. `BETWEEN … '06-08'`은 그날 0시 이후를 빠뜨린다. `new Date("2025-06-08")`은 UTC로 해석돼 KST 오전 9시가 경계가 된다. PG마다 시각 형식이 달라(RFC 3339, 오프셋 없는 문자열) 타임존을 가정하면 틀린다
- 대신: `timestamptz`·`Instant`로 저장하고 서버에서 `시작 ≤ t < 끝`으로 비교한다. 할인 경계는 `Asia/Seoul`로 정의해 UTC로 바꾼다. 외부 시각은 타임존을 명시해 파싱한다
- 확인: 만료 판정에 쓴 클라이언트 `new Date()`·`Date.now()`, `timestamp without time zone`·`LocalDateTime` 만료 시각, 종료 비교의 `BETWEEN`·`<=`
- 경계값:
  - 프론트: 날짜만 있는 문자열 파싱
  - 백엔드: 종료 정각은 제외·1ms 전은 포함, KST 00:00 = UTC 전날 15:00
- 근거:
  - PostgreSQL Don't Do This — `BETWEEN`은 닫힌 구간, `timestamptz` 권장
  - MDN `Date.parse` — 날짜만 있는 문자열은 UTC, 오프셋 없는 날짜·시각은 로컬로 해석 https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/parse
  - 포트원 웹훅 v2 — RFC 3339 시각 https://developers.portone.io/opi/ko/integration/webhook/readme-v2
  - NHN KCP 웹훅 — 오프셋 없는 `yyyyMMddHHmmss` https://developer.kcp.co.kr/reference/webhook
  - 토스페이먼츠 Quick Reference — 오프셋이 없으면 KST로 해석

## 주문·결제 상태

## COM-013 주문 상태는 전이 함수에서만 바꾸고, 되돌아가는 전이도 전이표에 넣는다
- 대상: 둘 다
- 왜: 화면·핸들러마다 상태를 대입하면 결제를 취소했는데 배송 준비로 넘어간다. 입금 오류로 완료가 입금 대기로 돌아가고, 입금 취소가 오고, 실패 처리한 결제가 나중에 승인되기도 한다
- 대신: 전이 함수 하나와 허용·금지 전이표를 둔다(되돌아가는 전이 포함). 늦게 온 이벤트가 상태를 되돌리지 못하게 전이표로 막는다
- 확인: 영향 범위 — 상태 대입·`setStatus` 사용처
- 경계값:
  - 프론트: 상태별 버튼·배지
  - 백엔드: 허용·금지 전이의 모든 쌍, 완료 → 입금 대기, 실패 → 승인, 늦게 온 처리 중 이벤트
- 근거:
  - 토스페이먼츠 웹훅 이벤트 — 완료가 입금 대기로 바뀌는 경우 https://docs.tosspayments.com/reference/using-api/webhook-events
  - 포트원 웹훅 v1 — 실패 처리된 결제가 나중에 승인돼 웹훅이 다시 올 수 있다 https://developers.portone.io/opi/ko/integration/webhook/readme-v1
  - Stripe 웹훅 — 이벤트 순서를 보장하지 않는다 https://docs.stripe.com/webhooks

## COM-014 우리 상태 값은 빠짐없이 처리하고, 외부에서 온 모르는 값은 기록한 뒤 보류한다
- 대상: 둘 다
- 왜: 새 상태(부분 취소)를 더했는데 배지·필터·버튼이 '알 수 없음'이 된다. 반대로 PG가 새 상태를 보내자 망라 검사가 예외를 던져 웹훅 재전송이 폭주한다
- 대신: 우리 코드의 상태 union은 망라 검사를 한다(TypeScript `never`, Kotlin `when` 분기 나열). 외부 값을 우리 상태로 바꾸는 경계에서는 모르는 값을 로그로 남기고 보류 상태로 둔다
- 확인: 영향 범위 — 상태 union이 바뀌면 모든 switch·매핑. 여러 상태를 한꺼번에 처리하는 `default`·`else`, 외부 값에 던지는 예외
- 경계값:
  - 프론트: 새 상태 하나
  - 백엔드: PG 상태 전체(토스 8개 — READY·IN_PROGRESS·WAITING_FOR_DEPOSIT·DONE·CANCELED·PARTIAL_CANCELED·ABORTED·EXPIRED), 모르는 값
- 근거:
  - 토스페이먼츠 API 레퍼런스 — `Payment.status` https://docs.tosspayments.com/reference
  - 포트원 웹훅 v2 — 모르는 type은 무시
  - 포트원 취소 v2 — 취소 응답 상태와 미인식 상태 처리 https://developers.portone.io/opi/ko/integration/cancel/v2/readme

## COM-015 처리 중·입금 대기를 성공으로 취급하지 않는다
- 대상: 둘 다
- 왜: 가상계좌 발급 응답만 보고 출고한다. 지연 결제 수단이 처리 중일 때 배송했다가 나중에 실패한다
- 대신: 성공 상태를 명시해서 확인한다(`status === 'DONE'`). 대기 상태는 대기 화면·대기 주문으로 둔다
- 확인: `if (status !== 'FAILED') complete()` 같은 부정 분기
- 경계값:
  - 프론트: 입금 대기 화면
  - 백엔드: 입금 기한 직전·직후
- 근거:
  - Stripe 결제 수단 — 지연 수단은 처리 중일 때 지급이 보장되지 않는다 https://docs.stripe.com/payments/payment-methods
  - 토스페이먼츠 가상계좌 https://docs.tosspayments.com/guides/v2/payment-window/integration-virtual-account
  - 토스페이먼츠 웹훅 이벤트

## 결제 흐름

## COM-016 결제 요청은 한 번만 한다
- 대상: 둘 다
- 왜: 연타·뒤로 가기·새로고침으로 주문이 두 번 생긴다. 타임아웃·500 뒤 새 키로 재시도해 두 번 청구된다
- 대신: 프론트는 진행 중에 버튼을 잠근다. 서버는 작업마다 멱등 키를 저장하고 재시도에 같은 키·같은 파라미터를 쓴다. 주문번호는 서버가 만든다. 장바구니당 결제 의도(PaymentIntent 등)를 다시 쓴다
- 확인: 이력·영향 범위. 재시도 루프 안의 `uuid()`, 저장하지 않는 키, 처리 중 응답(409)을 실패로 처리, 키에 넣은 이메일 등 개인정보, 클라이언트나 `Date.now()`로 만든 주문번호
- 경계값:
  - 프론트: 5연타 → 요청 1번, 결제 중 뒤로 가기
  - 백엔드: 타임아웃 뒤 재시도 → 결제 1건, 같은 키에 다른 금액 → 오류, 토스 멱등 키 300자·301자, 토스 주문번호 6~64자
- 근거:
  - Stripe 멱등 요청 — 파라미터가 다르면 오류, 키에 개인정보 금지 https://docs.stripe.com/api/idempotent_requests
  - Stripe 오류 처리 — 409면 같은 키로 재시도, 500이면 대사 먼저 https://docs.stripe.com/error-low-level
  - Stripe PaymentIntent — 장바구니당 하나를 다시 쓴다 https://docs.stripe.com/payments/payment-intents
  - 토스페이먼츠 인증 — 모든 POST에 멱등 키, 에러 뒤 키만 바꿔 재시도하면 위험 https://docs.tosspayments.com/reference/using-api/authorization
  - 포트원 — 같은 결제 ID로는 성공이 한 번뿐

## COM-017 결제 완료는 서버가 PG 조회나 웹훅으로 확정한다. 리다이렉트는 화면 표시용이다
- 대상: 둘 다
- 왜: `?status=success`나 콜백에 오류가 없다는 것만 보고 완료하면, 파라미터를 위조한 미결제 주문이 확정된다. 랜딩 페이지가 뜨기 전에 연결이 끊기면 결제한 주문이 확정되지 않는다
- 대신: 서버가 결제 조회 API로 상태·금액을 확인하거나 웹훅으로 확정한다
- 확인: URL 파라미터로 완료 API를 부르는 완료 페이지, 쿼리의 상태를 그대로 저장하는 서버, 웹훅 핸들러 없음
- 경계값:
  - 프론트: 위조한 성공 파라미터로 완료 화면에 들어옴
  - 백엔드: 랜딩 없이 웹훅만 온 결제
- 근거:
  - Stripe 이행 — 랜딩 페이지만으로는 이행할 수 없고 웹훅이 필요하다 https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted
  - Stripe accept-a-payment — 고객이 창을 닫거나 클라이언트가 응답을 조작할 수 있다
  - 포트원 — 서버가 결제 조회로 상태를 확인

## COM-018 결제 확정 처리는 여러 번, 동시에 불려도 한 번만 반영한다
- 대상: 백엔드
- 왜: 웹훅과 랜딩 페이지가 동시에 확정을 부르면 재고 차감·포인트 적립·알림이 두 번 일어난다
- 대신: 같은 트랜잭션에서 처리 기록(결제 ID 유니크)을 확인한 뒤 반영한다
- 확인: 이미 처리했는지 확인 없음, 처리 기록에 유니크 제약 없음
- 경계값:
  - 백엔드: 같은 결제 ID로 동시 2회 → 부수효과 1회
- 근거:
  - Stripe 이행 — 이행 함수는 같은 세션으로 여러 번, 동시에 불릴 수 있다 https://docs.stripe.com/checkout/fulfillment

## COM-019 승인 결과가 불확실하면 실패로 단정하지 않는다
- 대상: 백엔드
- 왜: 읽기 타임아웃을 실패로 보고 재결제를 유도해 이중 승인된다. 승인 뒤 DB 저장이 실패해 돈은 빠졌는데 주문이 없다
- 대신: 타임아웃·5xx면 결제를 조회해 결과를 확정하고, 필요하면 망취소·취소로 보상한다. HTTP 클라이언트에 타임아웃을 정한다
- 확인: 승인 호출의 catch에서 바로 실패 처리, 타임아웃 미설정, 승인 뒤 저장 실패에 보상 없음
- 경계값:
  - 백엔드: 읽기 타임아웃, 승인 성공 뒤 DB 저장 실패, 망취소 가능 시간(나이스 1시간, 이니시스 인증 후 10분)
- 근거:
  - 토스페이먼츠 Quick Reference §8 — 승인이 실패하면 조회한 뒤 분기
  - 나이스페이먼츠 준비 사항 — 읽기 타임아웃이면 망취소 https://github.com/nicepayments/nicepay-manual/blob/main/common/preparations.md
  - KG이니시스 — 승인 결과 수신이나 DB 저장이 실패하면 망취소 https://manual.inicis.com/pay/stdpay_pc.html

## COM-020 결제 실패·취소·창 닫힘을 처리한다
- 대상: 둘 다
- 왜: 결제창을 닫으면 아무 이벤트도 오지 않아 주문이 "결제 중"으로 남고 재고를 붙잡는다. 사용자가 취소하면 주문번호를 보내지 않는 PG가 있어, 이를 전제로 짠 실패 화면이 500을 낸다
- 대신: 실패 화면에서는 승인을 부르지 않는다. 실패 코드별 문구를 둔다. 결제 대기 주문을 만료시키는 작업을 둔다. 리다이렉트와 Promise 두 흐름을 모두 처리한다(포트원)
- 확인: 영향 범위. 주문번호를 필수로 가정하는 실패 화면, 만료 작업 없음
- 경계값:
  - 프론트: 실패 코드별 화면, 주문번호 없는 실패
  - 백엔드: 결제창 유효 시간(토스 30분)·인증 후 승인 시간(10분) 경과
- 근거:
  - 토스페이먼츠 결제위젯 — `PAY_PROCESS_CANCELED`에는 주문번호가 없다 https://docs.tosspayments.com/guides/v2/payment-widget/integration
  - 토스페이먼츠 웹훅 이벤트 — 창을 닫으면 상태도 웹훅도 없다
  - 포트원 — 두 흐름을 모두 지원해야 한다

## COM-021 웹훅 본문을 믿지 않는다
- 대상: 백엔드
- 왜: 공개된 웹훅 주소로 위조한 결제 완료 요청이 들어와 주문이 완료된다
- 대신: 원문 본문으로 서명을 검증하거나(상수 시간 비교, 시각 허용 오차) PG에 다시 조회하고 금액을 대조한다. 서명이 없는 웹훅(토스 일반 결제)은 다시 조회한다. 가상계좌 `secret`처럼 승인 응답에만 오는 값은 저장해 둔다
- 확인: `body.status`로 바로 갱신하는 핸들러, 웹훅 라우트 앞의 전역 JSON 파서(원문이 사라진다), `===`로 비교한 서명, 허용 오차 0, Spring에서 DTO에 바인딩한 뒤 검증
- 경계값:
  - 백엔드: 잘못된 서명, 허용 오차를 넘긴 타임스탬프, 금액이 다른 웹훅
- 근거:
  - Stripe 웹훅 — 원문 필요, 허용 오차 기본 5분, 0은 금지 https://docs.stripe.com/webhooks
  - 포트원 웹훅 v2 — 웹훅 메시지 내용은 기본적으로 신뢰할 수 없다
  - 토스페이먼츠 Quick Reference §7.2 — 일반 결제 웹훅은 서명이 없으니 다시 조회
  - 토스페이먼츠 가상계좌 — `secret`은 승인 응답에만 온다
  - 나이스페이먼츠 웹훅 — signature와 금액 확인 https://github.com/nicepayments/nicepay-manual/blob/main/api/hook.md

## COM-022 웹훅 처리는 멱등하고 순서와 무관해야 한다
- 대상: 백엔드
- 왜: 재전송될 때마다 적립금·알림이 중복된다. DB 저장은 실패했는데 먼저 성공 응답을 보내 재전송이 끊기고 입금이 누락된다. 늦게 온 이벤트가 상태를 되돌린다
- 대신: 이벤트 ID로 중복을 거른다. DB에 반영한 뒤 정해진 시간 안에 성공 응답을 보낸다. 순서는 전이표로 막는다(COM-013). 모르는 type은 무시한다. 주기적으로 대사한다
- 확인: 이벤트 ID 저장 없음, 먼저 200을 보내고 비동기 처리 실패를 무시, 모르는 type에 던지는 예외, 생성 시각으로 판단한 순서
- 경계값:
  - 백엔드: 같은 이벤트 2번, 역순 도착, 응답 지연(토스 10초)
- 근거:
  - Stripe 웹훅 — 이벤트 ID로 중복 판별, 최대 3일 재시도
  - Adyen — 중복 이벤트 판별, 저장한 뒤 응답 https://docs.adyen.com/development-resources/webhooks/handle-webhook-events
  - Shopify — 웹훅 ID로 중복 무시, 순서 비보장, 주기적 대사 https://shopify.dev/docs/apps/build/webhooks/best-practices
  - 토스페이먼츠 웹훅 — 최대 7회 재전송, 10초 안 응답 https://docs.tosspayments.com/guides/v2/webhook
  - 포트원 웹훅 v2 — 최대 5회 재전송, 리다이렉트와 웹훅 순서 비보장
  - KG이니시스 노티 — DB 처리에 성공했을 때만 OK, 아니면 24시간 재전송 https://manual.inicis.com/pay/etc-noti.html
  - NHN KCP 웹훅 — DB 처리 뒤 응답, 최대 10회 재전송

## COM-023 시크릿 키는 서버에서만 쓴다
- 대상: 둘 다
- 왜: `NEXT_PUBLIC_TOSS_SECRET_KEY`가 번들에 실려 제3자가 결제를 취소한다
- 대신: 시크릿 키는 서버 환경 변수에만 두고, 클라이언트는 클라이언트 키만 쓴다. 로그·쿼리스트링에 넣지 않는다. 테스트 키와 운영 키를 섞지 않는다
- 확인: `NEXT_PUBLIC_`·`VITE_`·`REACT_APP_` 접두어가 붙은 시크릿, 클라이언트 코드의 PG API 직접 호출, 요청 헤더 통째 로깅
- 경계값:
  - 프론트: 빌드 결과물(번들)에 시크릿 키 값이 없다
  - 백엔드: 운영 환경에 테스트 키를 넣으면 시작할 때 실패한다
- 근거:
  - 토스페이먼츠 Quick Reference §2.1
  - 토스페이먼츠 인증 — 키를 로그·쿼리스트링에 넣지 않는다
  - 포트원 준비 — API Secret은 서버에서만 https://developers.portone.io/opi/ko/integration/ready/readme

## 취소·환불

## COM-024 취소·환불 가능 여부는 서버가 준 값으로 판단한다
- 대상: 프론트
- 왜: 상태 이름으로 추측해 취소 버튼이 잘못 보인다
- 대신: `canCancel` 같은 서버 값으로 버튼을 보인다
- 확인: 상태 비교로 정하는 버튼 노출
- 경계값:
  - 프론트: 부분 취소된 주문, 입금 대기 주문의 버튼
- 근거:
  - OWASP ASVS 5.0 V2 2.2.2 — 업무 판단은 서버에서 https://github.com/OWASP/ASVS/blob/master/5.0/en/0x11-V2-Validation-and-Business-Logic.md

## COM-025 누적 환불액이 결제액을 넘지 않게 하고, 부분 취소에는 서버가 아는 잔액을 검증값으로 보낸다
- 대상: 백엔드
- 왜: 부분 환불을 반복하거나 관리자 두 명이 동시에 부분 취소해 결제액보다 많이 환불된다. 환불이 실패했는데 완료로 안내된다
- 대신: 누적액을 검사한다. PG의 잔액 검증 필드(토스 `refundableAmount`, 포트원 `currentCancellableAmount`, 이니시스 `confirmPrice`, KCP `rem_mny`)에 서버 잔액을 넣고 멱등 키와 함께 보낸다. 환불 실패·대기를 처리한다
- 확인: 이번 1건만 비교, 잔액 필드 없음 또는 클라이언트가 보낸 잔액, 실패 상태 처리 없음
- 경계값:
  - 백엔드: 누적 = 결제액, 결제액 + 1, 0원, 동시 부분 취소 2건. 이니시스 `confirmPrice`는 취소 후 잔액이고 다른 PG는 취소 전 잔액이다
- 근거:
  - Stripe 환불 — 원 결제액을 넘을 수 없고 실패하면 `refund.failed` https://docs.stripe.com/refunds
  - 토스페이먼츠 결제 취소 — 잔액이 맞지 않으면 거부
  - 포트원 취소 v2
  - KG이니시스 취소 https://manual.inicis.com/pay/cancel.html
  - NHN KCP 취소 https://developer.kcp.co.kr/reference/cancel
  - 나이스페이먼츠 취소 — 부분 취소는 같은 주문번호로 다시 부를 수 없다 https://github.com/nicepayments/nicepay-manual/blob/main/api/cancel.md

## COM-026 결제수단마다 취소 조건과 기한을 나눠 처리한다
- 대상: 백엔드
- 왜: 휴대폰 결제를 다음 달에 취소하려다 실패한다. 가상계좌 입금 뒤 취소에 환불 계좌가 없다
- 대신: 결제수단으로 분기한다. 가상계좌는 입금 전에는 전액 취소만 되고, 입금 뒤에는 환불 계좌가 필요하다. 환불 계좌는 받아서 저장한다
- 확인: 결제수단 분기가 없는 취소 로직, 환불 계좌 저장 없음
- 경계값:
  - 백엔드: 휴대폰 결제 해당 월 말일·다음 달 1일, 계좌이체 180일(토스 기준)
- 근거:
  - 토스페이먼츠 결제 취소 — 결제수단별 조건·기한 https://docs.tosspayments.com/guides/v2/cancel-payment
  - 포트원 취소 v2, 나이스페이먼츠 취소 — 결제수단별 표

## 로그·이벤트·배송

## COM-027 결제·개인 정보는 가려서 다루고 남길 곳을 제한한다
- 대상: 둘 다
- 왜: 요청 본문을 통째로 로깅해 CVC가 저장된다. 결제 비밀값(client_secret)이 노출되면 그것만으로 결제를 완료할 수 있다. 개인정보가 분석 도구·브라우저 저장소에 남는다
- 대신: 시크릿·토큰·세션 ID·CVC는 로그에 남기지 않는다. 카드번호는 앞 6자리·뒤 4자리까지만 보인다. 개인정보는 가려서 남긴다(PG가 요구하는 노티 로그는 남긴다). URL·분석 도구·브라우저 저장소·PG 메타데이터에 넣지 않는다. 고객 식별 키에 예측 가능한 값(이메일·전화번호)을 쓰지 않는다
- 확인: `logger.info(req.body)`, 본문을 포함하는 요청 로깅 필터, Sentry·GA로 보낸 이메일·카드 정보, `localStorage`의 개인정보, 쿼리스트링의 토큰, CVC 컬럼
- 경계값:
  - 프론트: 결제를 마친 뒤 URL·브라우저 저장소·분석 이벤트에 토큰·카드·개인 정보가 없다
  - 백엔드: 카드번호가 든 요청을 로깅하면 앞 6자리·뒤 4자리만 남고, CVC는 어디에도 남지 않는다
- 근거:
  - OWASP 로깅 치트시트 — 카드·계좌 정보, 토큰, 세션 ID는 로그에서 뺀다 https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
  - OWASP ASVS 5.0 16.2.5 — 결제 정보는 로그에 남기지 않고, 세션 토큰 같은 값은 가려서 남긴다 https://github.com/OWASP/ASVS/blob/master/5.0/en/0x25-V16-Security-Logging-and-Error-Handling.md
  - OWASP ASVS 5.0 14.2.1·14.2.3·14.3.3 — 민감 정보는 URL·쿼리 문자열, 분석·추적 도구, 브라우저 저장소에 두지 않는다 https://github.com/OWASP/ASVS/blob/master/5.0/en/0x23-V14-Data-Protection.md
  - PCI SSC 데이터 저장 — CVV·트랙·PIN은 인가 뒤 저장 불가, PAN 표시는 최대 앞 6·뒤 4 https://listings.pcisecuritystandards.org/pdfs/pci_fs_data_storage.pdf
  - PCI SSC FAQ — 고객 동의가 있어도 CVC 보관 불가 https://blog.pcisecuritystandards.org/faq-can-cvc-be-stored-for-card-on-file-or-recurring-transactions
  - Stripe PaymentIntent — client_secret 로깅·URL 노출 금지, metadata에 개인정보 금지
  - 토스페이먼츠 Quick Reference — customerKey에 예측 가능한 값 금지
  - KG이니시스 노티 — 노티 로그는 남긴다

## COM-028 구매 이벤트는 주문마다 고유한 거래 ID로 한 번만 보낸다
- 대상: 프론트
- 왜: 완료 페이지를 새로고침하거나 뒤로 갔다 오면 매출이 두 번 잡힌다. 빈 거래 ID끼리는 하나로 합쳐진다
- 대신: 주문번호를 거래 ID로 쓰고, 보낸 주문은 기록해 다시 보내지 않는다
- 확인: 영향 범위 — 완료 페이지의 이벤트 전송
- 경계값:
  - 프론트: 새로고침, 뒤로 가기 뒤 재진입, 빈 ID
- 근거:
  - Google Analytics 도움말 — 중복 제거는 웹 스트림에서만, 빈 ID는 하나로 합쳐진다 https://support.google.com/analytics/answer/12313109?hl=en

## COM-029 무료 배송 기준의 경계는 요구사항 문구대로 구현한다
- 대상: 둘 다
- 왜: "3만 원 이상"을 `>`로 구현해 정확히 3만 원일 때 배송비가 붙는다
- 대신: "이상"은 `>=`, "초과"는 `>`로 쓴다. 기준 금액에 무엇이 들어가는지(할인 전·후)를 요구사항에서 확인한다
- 확인: 의도 — 요구사항 문구
- 경계값:
  - 프론트·백엔드: 기준 − 1, 기준, 기준 + 1, 할인 전후로 기준을 넘나드는 주문
- 근거: 출처 없음 — 도메인 관례. 팀의 요구사항으로 확인한다

## 확인하지 못한 것

- 다중 통화에서 COM-001의 "최소 단위 정수"가 모든 PG에 그대로 맞는지는 PG마다 확인해야 한다(Stripe는 ISK·UGX를 ISO와 다르게 받는다).
- 국내 PG의 최소 결제 금액은 토스 문서로만 확인했다(COM-005).
- 조사 중 열지 못한 페이지: Adyen 웹훅 모범 사례(404 — 웹훅 처리 문서로 대신), 옛 OWASP WSTG 경로(새 경로로 대신), jakarta.ee `@Version` 문서(Hibernate 문서로 대신), PCI DSS v4.0.1 원문(라이선스 동의 필요 — PCI SSC 요약·FAQ로 대신, 요약은 v3 번호를 쓴다), 나이스 새 개발자센터(공식 GitHub 매뉴얼로 대신).
