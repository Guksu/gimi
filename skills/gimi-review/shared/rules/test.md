# 테스트 금지선 — `test/`

AI가 쓴 테스트에서 흔히 나오는 슬롭이다. PR에 든 테스트 코드를 리뷰할 때 쓴다. 규칙 하나가 `## {ID} {한 줄}` 절 하나다.

- `대상`은 프론트·백엔드·둘 다 중 하나다. `scripts/rules.mjs`가 설정 `.agents/gimi.json`의 `stacks`로 걸러 보인다.
- `검사`는 잡는 곳이다. 모두 리뷰다 — gimi-review가 PR의 테스트 코드에서 찾는다. `확인`은 리뷰에서 볼 코드 신호다.
- `근거`는 측정 결과다 — 기능 구현·테스트 작성 요청 12개를 gimi 없이·있이 2번씩 실행해 그 줄이 나온 실행 수("N번 중 M번"). SKILL.md 표에는 gimi 없이 한 번 이상 나온 줄만 올라간다. 측정 전인 줄과 셀 수 없던 줄은 그렇게 적는다.
- 일부러 남긴 줄은 그 줄 끝이나 바로 윗줄에 `// gimi-ignore: {ID} — {이유}`를 단다. 리뷰는 이유가 있는 줄을 짚지 않는다.

## 프론트·공통

## test/only-left .only·fit을 남기지 않는다
- 대상: 둘 다
- 왜: 그 파일의 다른 테스트가 돌지 않는다. CI에서도 일부만 돌고 통과한다
- 대신: 지운다
- 확인: `it.only`·`test.only`·`describe.only`(체인 포함 — `test.concurrent.only`), `fit`·`fdescribe`. 주석·문자열 안은 보지 않는다
- 검사: 리뷰
- 근거: 측정 2026-10-27 — gimi 없이 24번 중 0번 · gimi 있이 24번 중 0번

## test/skip-without-reason 이유 없이 테스트를 건너뛰게 두지 않는다
- 대상: 둘 다
- 왜: 건너뛴 테스트는 아무것도 지키지 않는데, 왜 건너뛰었는지 아무도 모른 채 남는다
- 대신: 같은 줄이나 바로 윗줄에 이유와 이슈 번호를 주석으로 단다. 아니면 지운다
- 확인: `.skip`·`.todo`·`.fixme`·`xit`·`xdescribe`에 설명 주석이 없다. Playwright의 `test.skip(조건, 이유)`는 이유가 있는 것으로 본다. 이유가 있으면 대신 `done/test-bent`로 보고에 밝히라고 알린다
- 검사: 리뷰
- 근거: 측정 2026-10-27 — gimi 없이 24번 중 0번 · gimi 있이 24번 중 0번

## test/no-assertion 단언이 없는 테스트를 쓰지 않는다
- 대상: 둘 다
- 왜: 무엇이 틀려도 통과한다. "renders without crashing"은 화면이 맞는지 확인하지 않는다
- 대신: 사용자가 보는 결과(화면·응답·저장된 값)를 단언한다
- 확인: 함수를 넘긴 `it`·`test`(`.each` 포함) 본문에 `expect`·`assert`·`should`·`verify`·`t.assert`, supertest `.expect`, Testing Library `getBy`·`findBy`가 없다. 같은 파일의 도우미는 안을 본다. 테스트 도우미 모듈(`test-utils`·`helpers` 등)에서 가져온 함수는 판단하지 않는다(`render`·`setup` 같은 이름은 예외)
- 검사: 리뷰
- 근거: 측정 2026-10-27 — gimi 없이 24번 중 0번 · gimi 있이 24번 중 0번

## test/tautology 늘 참인 단언을 쓰지 않는다
- 대상: 둘 다
- 왜: 값이 틀려도 실패하지 않아 확인한 척만 한다
- 대신: 값이 틀리면 실패하는 단언으로 바꾼다
- 확인: 리터럴을 단언(`expect(true).toBe(true)`), 호출 없는 같은 식을 양쪽에 둠(`expect(total).toBe(total)`), `render()` 결과의 `toBeDefined`·`toBeTruthy`, `assert.equal(1, 1)`. 같은 호출을 양쪽에 둔 결정성 확인(`expect(f(x)).toBe(f(x))`)과 getBy 결과의 `toBeTruthy`(React Native 관용구)는 넘긴다
- 검사: 리뷰
- 근거: 측정 2026-10-27 — gimi 없이 24번 중 0번 · gimi 있이 24번 중 0번

## test/mock-echo mock이 돌려준 값을 그대로 단언하지 않는다
- 대상: 둘 다
- 왜: 대상 코드가 틀려도 통과한다. mock을 시험한 것이다
- 대신: 입력에 따른 출력·부수효과를 단언한다
- 확인: 같은 테스트(또는 beforeEach·beforeAll)의 `mockReturnValue`·`mockResolvedValue`·`mockImplementation(() => 값)`에 넣은 값이 `toBe`·`toEqual`·`toStrictEqual`·`toMatchObject`·`assert.equal`의 기대값과 같다. `true`·`null`·`[]` 같은 흔한 값은 우연일 수 있어 넘긴다
- 검사: 리뷰
- 근거: 측정 2026-10-27 — gimi 없이 24번 중 0번 · gimi 있이 24번 중 0번

## test/mock-subject 테스트 대상 모듈을 통째로 mock하지 않는다
- 대상: 둘 다
- 왜: 대상 코드가 실행되지 않으니 무엇이 틀려도 통과한다
- 대신: 대상은 실물로 두고 경계(네트워크·시간·외부 결제)만 바꾼다
- 확인: 테스트 파일과 이름이 같은 모듈(`cart.test.ts`의 `./cart`, `__tests__/cart.test.ts`의 `../cart`)을 `vi.mock`·`jest.mock`으로 통째로 바꾼다. `importActual`·`importOriginal`로 일부만 바꾸면 넘긴다
- 검사: 리뷰
- 근거: 측정 2026-10-27 — gimi 없이 24번 중 0번 · gimi 있이 24번 중 0번

## test/rewritten-expectation 실패하자 기대값을 실제값으로 고치지 않는다
- 대상: 둘 다
- 왜: 결함이 있는 구현을 정답으로 굳힌다
- 대신: 실패 원인을 코드에서 찾는다. 요구사항이 바뀐 것이라면 그 출처를 보고에 적는다
- 확인: 구현 파일도 바뀐 변경에서, 같은 대상·matcher의 단언이 기대값만 바뀌었다(한 줄 단언). 테스트만 바뀐 변경은 테스트를 고친 것일 수 있어 넘긴다. 리뷰는 확인 질문으로 올린다
- 검사: 리뷰(확인 질문)
- 근거: 측정 2026-10-27 — gimi 없이 24번 중 0번 · gimi 있이 24번 중 0번

## test/implementation-detail 내부 구현을 단언하지 않는다
- 대상: 프론트
- 왜: 리팩터링하면 깨지고, 사용자가 보는 결과가 틀려도 통과한다
- 대신: 역할·이름으로 찾고 화면 결과를 단언한다
- 확인: `querySelector`·`getElementsByClassName`으로 찾기, `toHaveClass`, enzyme의 `.state()`·`.instance()`. 내부 함수의 호출 횟수만 보는 단언은 리뷰가 본다
- 검사: 리뷰
- 근거: 측정 2026-10-27 — gimi 없이 24번 중 0번 · gimi 있이 24번 중 0번

## test/real-wait 실제 시간을 기다리거나 고정하지 않은 현재 시각에 기대지 않는다
- 대상: 둘 다
- 왜: 느리고 가끔 깨진다. 실행 시각에 따라 결과가 바뀐다
- 대신: 가짜 타이머로 시간을 넘기고 `setSystemTime`으로 시각을 고정한다. 결과는 `findBy`·`waitFor`로 기다린다
- 확인: 0이 아닌 지연의 `setTimeout`, `sleep`·`delay`·`wait(숫자)`, Playwright `waitForTimeout`, Cypress `cy.wait(숫자)`, 고정하지 않은 `new Date()`·`Date.now()`. 가짜 타이머·`setSystemTime`을 쓰는 파일과 0초 기다리기(마이크로태스크 비우기)는 넘긴다
- 검사: 리뷰
- 근거: 측정 2026-10-27 — gimi 없이 24번 중 1번 · gimi 있이 24번 중 0번

## test/waitfor-misuse waitFor 안에서 동작을 실행하거나 단언을 여러 개 넣지 않는다
- 대상: 프론트
- 왜: 기다리는 동안 동작이 여러 번 실행되고, 첫 단언이 통과할 때까지 나머지를 보지 못한다
- 대신: 동작은 밖에서 하고, `waitFor`에는 단언 하나만 둔다. 요소를 기다리기만 하면 `findBy`를 쓴다
- 확인: `waitFor` 콜백 안의 `fireEvent`·`userEvent`·`user.click`·`render`, `expect` 두 개 이상, 빈 콜백, `getBy`만 있는 콜백
- 검사: 리뷰
- 근거: 측정 2026-10-27 — gimi 없이 24번 중 0번 · gimi 있이 24번 중 0번

## test/network-module-mock fetch·axios 모듈을 mock하지 않는다
- 대상: 둘 다
- 왜: 요청 주소·본문이 틀려도 통과한다
- 대신: 네트워크 경계에서 바꾼다 — 프론트는 MSW, 백엔드는 HTTP 가짜 서버
- 확인: `vi.mock`·`jest.mock`의 `axios`·`node-fetch`·`cross-fetch`·`ky`·`got`·`undici`·`superagent`, `global.fetch = …`, `spyOn(globalThis, 'fetch')`, `stubGlobal('fetch')`. 원래 fetch로 되돌리는 대입은 넘긴다
- 검사: 리뷰
- 근거: 측정 2026-10-27 — gimi 없이 24번 중 0번 · gimi 있이 24번 중 0번

## test/swallowed-failure try/catch로 실패를 삼키거나 단언을 if 안에만 두지 않는다
- 대상: 둘 다
- 왜: 단언이 실패해도, 또는 아무것도 확인하지 않고 통과한다
- 대신: 단언은 늘 실행되게 하고, 오류는 `rejects`·`toThrow`로 단언한다
- 확인: try 안의 단언을 다시 던지지 않는 catch가 삼킨다. 단언이 catch 안에만 있고 `expect.assertions`가 없다. 단언이 모두 else 없는 if 안에만 있다(if 밖에도 단언이 있으면 넘기고, if 안에서 getBy로 찾기만 하는 것은 단언으로 치지 않는다)
- 검사: 리뷰
- 근거: 측정 2026-10-27 — gimi 없이 24번 중 0번 · gimi 있이 24번 중 0번

## test/silenced-console console.error·warn을 막아 경고를 숨기지 않는다
- 대상: 둘 다
- 왜: act 경고·key 경고처럼 결함을 알리는 경고가 사라진다
- 대신: 경고의 원인을 고친다. 기대한 경고라면 그 호출을 단언한다
- 확인: `spyOn(console, 'error' 또는 'warn').mockImplementation(…)`, `console.error = …`, `stubGlobal('console')`. 막은 spy나 `console.error`를 단언하면 넘긴다
- 검사: 리뷰
- 근거: 측정 2026-10-27 — gimi 없이 24번 중 0번 · gimi 있이 24번 중 0번

## test/snapshot-dump 화면 전체를 스냅샷하거나 말없이 갱신하지 않는다
- 대상: 둘 다
- 왜: 무엇이 바뀌어도 갱신하면 통과한다. 갱신은 결함을 정답으로 굳힌다
- 대신: 필요한 값만 단언한다. 스냅샷은 작게, 갱신은 이유와 함께 보고에 적는다
- 확인: `container`·`asFragment()`·`document.body`·`render()` 결과의 `toMatchSnapshot`. 같은 변경에서 고친 `.snap` 파일과 인라인 스냅샷(새로 만든 스냅샷은 넘긴다)
- 검사: 리뷰
- 근거: 측정 2026-10-27 — gimi 없이 24번 중 0번 · gimi 있이 24번 중 0번

## test/testid-first 역할로 찾을 수 있는데 testid로 찾지 않는다
- 대상: 프론트
- 왜: 사용자가 보는 것(역할·이름)과 무관하게 통과하고, 접근성 결함을 놓친다
- 대신: `getByRole` + 이름으로 찾는다
- 확인: `getByTestId`·`findByTestId` 등. React Native Testing Library는 testID가 관례라 넘긴다
- 검사: 리뷰
- 근거: 측정 2026-10-27 — gimi 없이 24번 중 0번 · gimi 있이 24번 중 0번

## test/retry-mask 재시도 설정으로 가끔 깨지는 테스트를 덮지 않는다
- 대상: 둘 다
- 왜: 깨지는 원인(시간·순서·공유 상태)이 그대로 남고, 실제 결함이 재시도에 묻힌다
- 대신: 원인을 찾는다
- 확인: 테스트 옵션의 `retry`·`retries`(0이 아님), `jest.retryTimes`, `this.retries`, `describe.configure({ retries })`, 테스트 설정 파일(vitest·jest·playwright·cypress)의 `retry`·`retries`. 앱 코드의 retry 옵션(React Query 등)은 넘긴다
- 검사: 리뷰
- 근거: 측정 2026-10-27 — gimi 없이 24번 중 0번 · gimi 있이 24번 중 0번

## 백엔드

## test/mock-repository 저장소·ORM을 통째로 mock하지 않는다
- 대상: 백엔드
- 왜: 쿼리·제약·트랜잭션이 틀려도 통과한다
- 대신: 실제 DB로 저장소를 테스트한다
- 확인: 저장소·ORM 클라이언트(`prisma`·`repository`·`EntityManager`)를 mock으로 바꾼 저장소 테스트
- 검사: 리뷰
- 근거: 측정 2026-10-27 — gimi 없이 24번 중 0번 · gimi 있이 24번 중 0번

## test/shared-db-state 테스트끼리 DB 데이터를 공유하지 않는다
- 대상: 백엔드
- 왜: 순서에 따라 결과가 바뀌고, 하나만 돌리면 깨진다
- 대신: 테스트마다 격리한다(트랜잭션 롤백·초기화)
- 확인: `beforeAll`에서 넣은 데이터를 여러 테스트가 고치는데 정리가 없다. 고정 ID로 넣은 행
- 검사: 리뷰
- 근거: 측정 2026-10-27 — gimi 없이 24번 중 0번 · gimi 있이 24번 중 0번

## test/sequential-only 동시성 규칙을 순차 호출로만 테스트하지 않는다
- 대상: 백엔드
- 왜: 재고 1개에 주문 두 번을 차례로 보내면 늘 통과하지만, 동시 요청에서는 둘 다 성공한다(COM-007)
- 대신: 동시 요청(`Promise.all`·스레드)으로 테스트하고 성공 수를 단언한다
- 확인: 재고·쿠폰·포인트·멱등 키 테스트에 동시 요청이 없다
- 검사: 리뷰
- 근거: 측정 2026-10-27 — gimi 없이 24번 중 1번 · gimi 있이 24번 중 0번

## test/happy-status-only API 테스트가 200만 보지 않는다
- 대상: 백엔드
- 왜: 권한·검증·멱등 결함은 실패 경로에서 나온다
- 대신: 4xx, 권한 없음, 검증 실패, 멱등 재요청도 본다
- 확인: 엔드포인트 테스트에 2xx 단언만 있다
- 검사: 리뷰
- 근거: 측정 2026-10-27 — gimi 없이 24번 중 0번 · gimi 있이 24번 중 0번

## test/real-external 테스트가 실제 외부 API를 부르지 않는다
- 대상: 백엔드
- 왜: 느리고 가끔 깨진다. 결제 샌드박스도 장애·요금 정책에 흔들리고, 시크릿이 테스트에 들어간다
- 대신: HTTP 수준의 가짜 서버를 쓴다
- 확인: 테스트에서 PG·메일·SMS의 실제 주소나 샌드박스 키를 쓴다
- 검사: 리뷰
- 근거: 측정 2026-10-27 — gimi 없이 24번 중 0번 · gimi 있이 24번 중 0번
