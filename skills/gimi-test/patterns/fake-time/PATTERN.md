---
name: fake-time
description: 시간에 기대는 프론트 코드(debounce·폴링·만료·카운트다운·날짜 표시)를 가짜 시계와 고정한 시간대로 테스트한다 — vi.useFakeTimers·setSystemTime으로 시간을 앞으로 돌리고, 기기 시간대를 한국과 다른 곳으로 바꿔 날짜 표시가 흔들리지 않는지 단언한다. 실제 시간을 기다리거나 현재 시각에 기대지 않는다. "가짜 타이머, fake timers, debounce 테스트, 폴링 테스트, 카운트다운, 만료, 현재 시각 고정, setSystemTime, 시간대, 타임존, 날짜 표시" 요청에 쓴다.
target: 프론트
---

# fake-time — 시간은 테스트가 정한다

## 언제 쓰는가

시간이 들어간 화면을 쓰거나 바꿀 때 쓴다. 입력이 멈춘 뒤 검색하기(debounce), 몇 초마다 결제 결과 다시 묻기(폴링), 쿠폰 만료·남은 시간 표시, 마감 날짜 표시 같은 것이다. 이런 테스트가 실제 시간을 기다리면 느리고 가끔 깨진다. 현재 시각이나 기기의 시간대에 기대면 날마다, 컴퓨터마다 결과가 달라진다.

관련 규칙은 `COM-012`(시각은 UTC로 저장하고 KST는 경계 정의와 표시에만 쓴다)와 `test/real-wait`(실제 시간을 기다리지 않는다)다.

## 무엇을 단언하는가

| 상황 | 단언 |
|---|---|
| debounce | 정해진 시간 전에는 요청이 없고, 시간을 돌린 뒤 한 번 |
| 폴링 | 간격마다 한 번씩, 결과가 확정되면 멈춤 |
| 만료·남은 시간 | 현재 시각을 고정하고 경계 직전·직후의 표시 |
| 날짜 표시 | 기기 시간대가 한국과 달라도 같은 날짜(서버가 준 시각을 한국 시간으로) |

## 예시

| 파일 | 무엇을 |
|---|---|
| `assets/deadline-display.test.tsx` | 좋은 예시 — 기기 시간대를 UTC+14로 바꾸고 반품 마감 날짜가 한국 날짜인지, 달이 바뀌는 마감, 가짜 Date로 현재 시각을 고정해도 표시가 같은지 |
| `assets/deadline-display.slop.test.tsx` | 슬롭 예시 — 테스트를 한국 시간대로 고정한다. 화면이 기기 시간대로 날짜를 계산해도 통과한다 |

기기 시간대는 모듈을 불러오기 전에 바꾼다. 날짜 포맷터(`Intl.DateTimeFormat`)는 만들 때 시간대를 굳힌다.

```tsx
const originalTimeZone = vi.hoisted(() => {
  const before = process.env.TZ
  process.env.TZ = 'Pacific/Kiritimati' // UTC+14 — 한국과 날짜가 다르다
  return before
})
afterAll(() => {
  process.env.TZ = originalTimeZone
})
```

debounce·폴링은 가짜 타이머로 시간을 돌린다.

```tsx
vi.useFakeTimers()
await user.type(search, '국수') // userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
expect(requests).toHaveLength(0)
await vi.advanceTimersByTimeAsync(300)
expect(requests).toHaveLength(1)
```

마감 날짜를 기기 시간대로 보이게 바꾸면 좋은 예시는 UTC+14에서 날짜가 하루 뒤로 보여 실패하고, 한국 시간대로 고정한 슬롭 예시는 그대로 통과한다.

## AI가 흔히 쓰는 테스트 / 대신

| 흔히 | 왜 놓치나 | 대신 |
|---|---|---|
| `await new Promise((r) => setTimeout(r, 500))` | 느리고, 기계가 바쁘면 깨진다 | `vi.useFakeTimers()` + `advanceTimersByTimeAsync` |
| 현재 시각(`new Date()`)으로 기대값을 계산 | 테스트도 같은 실수를 하고, 날마다 결과가 바뀐다 | `vi.setSystemTime`으로 고정하고 기대값은 글자로 |
| 시간대를 정하지 않는다 | 개발자 컴퓨터(한국)와 CI(UTC)에서는 결함이 숨는다 | 한국과 날짜가 다른 시간대를 일부러 쓴다 |
| 테스트를 한국 시간대로 고정 | 해외 기기·UTC 서버의 결함을 시험하지 않는다 | 고정하려면 한국과 다른 시간대로 |
| 가짜 타이머를 켜고 끄지 않는다 | 다음 테스트의 `findBy…`·MSW가 멈춘다 | `afterEach`에서 `vi.useRealTimers()` |

## Jest와 다른 줄

| Vitest | Jest |
|---|---|
| `vi.useFakeTimers({ toFake: ['Date'] })` | `jest.useFakeTimers({ doNotFake: […] })` — 끌 것을 적는다 |
| `vi.setSystemTime`·`vi.advanceTimersByTimeAsync` | `jest.setSystemTime`·`jest.advanceTimersByTimeAsync` |
| `vi.hoisted`로 모듈보다 먼저 `TZ` | `globalSetup`이나 설정의 `TZ` 환경 변수 |

## 주의사항

- 가짜 타이머를 켜면 Testing Library의 `findBy…`·`waitFor`와 user-event가 멈출 수 있다. `toFake: ['Date']`로 시계만 바꾸거나, user-event에 `advanceTimers`를 넘긴다.
- `process.env.TZ`는 같은 프로세스의 다른 테스트 파일에 남는다. 끝나면 되돌린다.
- 날짜만 있는 문자열(`'2026-10-28'`)은 UTC 자정으로 해석된다. 서버는 시각(타임존 포함)을 주고, 화면은 그것을 한국 시간으로 보인다.
