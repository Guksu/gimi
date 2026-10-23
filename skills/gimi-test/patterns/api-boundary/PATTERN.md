---
name: api-boundary
description: 화면 테스트에서 API를 네트워크 경계(MSW)에서 바꿔 성공·4xx·5xx·네트워크 끊김·느린 응답마다 사용자가 보는 결과(안내 문구·버튼 상태)와 보낸 요청(본문·멱등 키)을 단언한다. fetch·axios·api 모듈을 mock하지 않는다. "MSW, API mocking, 서버 오류 화면, 500 에러, 409 응답, 네트워크 끊김, 재시도 화면, 응답 mock, 컴포넌트 API 테스트" 요청에 쓴다.
target: 프론트
---

# api-boundary — API는 네트워크 경계에서만 바꾼다

## 언제 쓰는가

서버를 부르는 화면(목록·폼 제출·결제)을 테스트할 때 쓴다. 화면부터 `fetch`까지는 실물로 두고, 네트워크 밖(서버의 응답)만 MSW 핸들러로 바꾼다. 그러면 api 모듈·응답 파싱·오류 변환·재시도까지 함께 시험된다.

MSW(Mock Service Worker)는 요청을 네트워크 단계에서 가로채 정해 둔 응답을 돌려주는 도구다.

## 무엇을 단언하는가

| 응답 | 단언 |
|---|---|
| 성공 | 다음 화면이나 이동, 그리고 **보낸 요청**(본문·머리). 보내면 안 되는 값(금액)이 없는지, 멱등 키가 있는지 |
| 4xx(검증·충돌) | 오류 코드에 맞는 안내 문구, 입력·버튼을 다시 쓸 수 있는 상태 |
| 5xx | 서버의 문장이 아닌 화면의 안내 문구, 다음 단계로 가지 않음 |
| 네트워크 끊김 | 안내 문구, 그리고 다시 시도할 때 **같은 멱등 키**. 서버는 이미 처리했을 수 있다 |
| 느린 응답 | 기다리는 동안의 상태(버튼 잠금·로딩)와 응답 뒤의 결과 |

## 예시

| 파일 | 무엇을 |
|---|---|
| `assets/checkout-api.test.tsx` | 좋은 예시 — 주문 API의 201·409·500·끊김·느린 응답 |
| `assets/checkout-api.slop.test.tsx` | 슬롭 예시 — api 모듈을 `vi.mock`하고 mock이 두 번 불렸는지만 본다. 다시 누를 때 멱등 키가 바뀌어도 통과한다 |

응답이 끊긴 경우는 `HttpResponse.error()`로 만든다. 보낸 요청은 핸들러에서 모은다.

```tsx
const keys: (string | null)[] = []
server.use(
  http.post(`${API}/orders`, ({ request }) => {
    keys.push(request.headers.get('idempotency-key'))
    return keys.length === 1 ? HttpResponse.error() : orderCreated()
  }),
)
// … 결제하기 → 오류 안내 → 다시 결제하기
expect(keys[1]).toBe(keys[0])
```

느린 응답은 시간을 기다리지 않는다. 핸들러가 약속(Promise)을 기다리게 하고, 중간 상태를 단언한 뒤 손으로 놓아준다.

```tsx
let release = () => {}
const answered = new Promise<void>((resolve) => (release = resolve))
server.use(http.post(`${API}/orders`, async () => (await answered, orderCreated())))
await pay()
expect(screen.getByRole('button', { name: PAY })).toBeDisabled()
release()
```

결제하기를 누를 때마다 새 멱등 키를 만들게 바꾸면 좋은 예시는 끊김 뒤 재시도에서 실패하고, 슬롭 예시는 그대로 통과한다.

## AI가 흔히 쓰는 테스트 / 대신

| 흔히 | 왜 놓치나 | 대신 |
|---|---|---|
| `vi.mock('../api/client')`·`vi.mock('axios')` 뒤 `toHaveBeenCalled` | 부른 것만 보고 무엇을 보냈는지 안 본다. 파싱과 오류 변환이 빠진다 | MSW 핸들러, 그리고 핸들러에서 요청 모으기 |
| 성공 응답 하나 | 오류 화면과 재시도가 시험되지 않는다 | 201·4xx·5xx·끊김·느림을 한 묶음으로 |
| `fetch`를 `vi.fn()`으로 바꿔 `{ ok: true, json }` 반환 | 실제 `Response`와 다르다(`res.ok`·상태 코드·본문 파싱) | `HttpResponse.json(…, { status })` |
| 느린 응답을 `setTimeout`·`delay(1000)`으로 | 테스트가 느리고 가끔 깨진다 | 핸들러가 약속을 기다리게 하고 손으로 놓기 |
| 오류 문구로 서버의 `message`를 기대 | 서버 문장이 바뀌면 깨지고, 내부 오류가 화면에 새는 것을 놓친다 | 오류 코드 → 화면 문구 표의 문구 |

## Jest와 다른 줄

| Vitest | Jest |
|---|---|
| `vi.fn()`·`vi.waitFor` | `jest.fn()`·Testing Library의 `waitFor` |
| `vi.stubGlobal(이름, 값)`·`vi.unstubAllGlobals()` | 대응하는 함수가 없다. 직접 바꾸고 `afterEach`에서 되돌린다 |
| MSW 2 `setupServer`(`msw/node`) | 같은 API다. jsdom 환경에는 Node 전역(`fetch`·`Response`)이 없어, 그것을 되살리는 환경(MSW 문서는 `jest-fixed-jsdom`)을 쓴다 |

## 주의사항

- `server.listen({ onUnhandledRequest: 'error' })`로 핸들러가 없는 요청을 실패로 만든다. 모르는 요청이 조용히 지나가지 않는다.
- 테스트마다 `server.resetHandlers()`로 덮은 핸들러를 되돌린다.
- 응답의 모양은 계약(OpenAPI의 생성 타입)을 따른다. 예시는 `order()`처럼 계약 타입으로 만든 응답 생성기를 쓴다.
- 결제창 이동처럼 jsdom이 하지 못하는 것(`location.assign`)은 앱을 띄운 뒤에 가로챈다. 라우터는 처음 그릴 때 실제 주소를 읽는다.
