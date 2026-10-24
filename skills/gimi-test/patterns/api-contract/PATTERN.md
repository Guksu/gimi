---
name: api-contract
description: API 응답을 계약 파일(OpenAPI 스키마)과 대조해 테스트한다 — 엔드포인트마다 실제 응답을 계약의 스키마로 검사해 필수 필드가 빠지거나 형이 바뀌면 어느 필드가 왜 틀렸는지 실패로 보인다. 오류 응답도 계약의 오류 형식과 맞춘다. 상태 코드와 눈에 띄는 필드 두어 개만 보지 않는다. "API 계약 테스트, OpenAPI 대조, 응답 스키마 검증, 필수 필드, 계약과 응답 비교, openapi.yaml, 프론트 타입과 서버 응답, JSON 스키마" 요청에 쓴다.
target: 백엔드
---

# api-contract — 응답을 계약과 대조한다

## 언제 쓰는가

프론트·다른 서비스가 쓰는 API의 응답을 바꾸거나 새로 만들 때 쓴다. 계약 파일(OpenAPI 등)이 있으면 프론트는 그 파일로 타입을 만든다. 서버가 계약과 어긋나게 바꾸면 서버 테스트는 통과하고, 프론트는 배포한 뒤에 깨진다. 응답을 계약의 스키마로 검사하면 이 어긋남이 서버 테스트에서 드러난다.

관련 규칙은 `COM-024`(취소·환불 가능 여부는 서버가 준 값으로 판단)다. 계약이 바뀌면 리뷰의 맥락 수집이 바뀐 엔드포인트·필드와 그 사용처를 찾는다.

## 무엇을 단언하는가

| 단언 | 왜 |
|---|---|
| 응답이 계약의 스키마에 맞는다(필수 필드·형·enum·nullable) | 필드가 빠지거나 이름·형이 바뀐 것을 잡는다 |
| 상태마다 응답을 본다(결제 대기, 배송 완료처럼 값이 달라지는 상태) | `null`이 되는 필드, 상태에 따라 생기는 필드를 잡는다 |
| 오류 응답도 계약의 오류 형식이다 | 화면은 오류 코드로 문구를 고른다 |
| 어긋나면 어느 필드가 왜 틀렸는지 보인다 | "스키마 불일치"만으로는 고칠 곳을 못 찾는다 |

## 예시

| 파일 | 무엇을 |
|---|---|
| `assets/order-contract.test.ts` | 좋은 예시 — 상품 목록, 금액 계산, 주문 생성·상세, 배송 완료 주문, 오류 응답을 `contracts/openapi.yaml`의 스키마로 검사한다 |
| `assets/order-contract.slop.test.ts` | 슬롭 예시 — 상태 코드와 `id`·`status`만 본다. 계약의 필수 필드가 빠져도 통과한다 |

계약 파일을 읽어 JSON 스키마 검사기(ajv)에 넣고, 어긋난 곳을 목록으로 돌려받는다.

```ts
const contract = parse(readFileSync(join(__dirname, '../../contracts/openapi.yaml'), 'utf8'))
const ajv = new Ajv({ strict: false, validateFormats: false, allErrors: true })
ajv.addSchema({ components: contract.components }, 'contract')

const mismatches = (schema: string, body: unknown) => {
  const validate = ajv.getSchema(`contract#/components/schemas/${schema}`)
  return validate(body) ? [] : validate.errors.map((error) => `${error.instancePath} ${error.message}`)
}

expect(mismatches('Order', detail.body)).toEqual([])
```

`toEqual([])`로 단언하면 실패 메시지에 "`(전체)` must have required property 'canCancel'"처럼 틀린 곳이 그대로 나온다.

주문 응답에서 `canCancel`·`canReturn`을 빼게 바꾸면 좋은 예시는 주문 경우들에서 실패하고, 슬롭 예시는 그대로 통과한다.

## AI가 흔히 쓰는 테스트 / 대신

| 흔히 | 왜 놓치나 | 대신 |
|---|---|---|
| 상태 코드만(`200`) | 응답 내용이 시험되지 않는다 | 스키마로 검사 |
| 눈에 띄는 필드 두어 개만 | 나머지 필드가 빠져도 통과한다 | 계약의 필수 필드 전체 |
| 기대 응답 전체를 스냅샷 | 계약이 아니라 지금 응답을 굳힌다. 바뀌면 말없이 갱신된다 | 계약 파일을 기준으로 |
| 성공 응답만 | 오류 형식이 어긋나면 화면이 문구를 못 고른다 | 오류 응답도 검사 |
| 계약을 테스트 안에 다시 적는다 | 계약 파일과 테스트가 따로 바뀐다 | 계약 파일을 직접 읽는다 |

## Jest와 다른 줄

다른 줄이 없다. ajv·yaml은 테스트 도구와 상관없다.

## 주의사항

- OpenAPI 3.0의 `nullable`은 JSON 스키마 표준이 아니다. ajv 8은 이 키워드를 읽는다. 다른 검사기를 쓰면 확인한다.
- `format`(date-time 등)까지 보려면 `ajv-formats`를 더한다. 예시는 형만 보고 형식 검사는 끈다.
- 계약을 일부러 바꾼 PR이면 계약 파일도 같은 PR에서 바뀌어야 한다. 테스트가 통과하려고 계약을 고치는 것은 리뷰에서 본다.

## 다른 언어

| 언어 | 응답을 계약과 대조 |
|---|---|
| Java·Kotlin | rest-assured + `swagger-request-validator`, Spring Cloud Contract |
| Python | `openapi-core`, schemathesis |
| Go | `kin-openapi`의 `openapi3filter` |
