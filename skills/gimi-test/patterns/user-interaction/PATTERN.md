---
name: user-interaction
description: 화면을 손님처럼 조작해 테스트한다 — 역할과 이름(getByRole·라벨)으로 찾고 user-event로 누르고 입력해, 처음 상태와 조작 뒤의 결과(버튼이 켜지는지·문구·보낸 요청)를 단언한다. 내부 state·클래스명·DOM 구조(querySelector)·fireEvent로 테스트하지 않는다. "user-event, getByRole, 클릭 테스트, 폼 입력 테스트, 체크박스, 라디오 버튼, 버튼이 켜지는지, 사용자처럼 조작, fireEvent 대신" 요청에 쓴다.
target: 프론트
---

# user-interaction — 손님처럼 찾고 손님처럼 누른다

## 언제 쓰는가

버튼·체크박스·라디오·입력란이 있는 화면을 테스트할 때 쓴다. 손님은 화면을 DOM 구조나 state로 보지 않는다. 글자(이름)와 모양(역할)으로 찾고, 누르고, 결과를 본다. 테스트도 그렇게 하면 구현을 바꿔도 깨지지 않고, 손님에게 보이는 결함은 잡는다.

user-event는 실제 사용자처럼 눌림·포커스·키 입력을 차례로 일으키는 Testing Library의 도구다. `fireEvent`는 이벤트 하나만 보낸다.

관련 규칙은 `KCL-005`(결제 직전 확인 화면, 결제 동의 체크는 비워 둔다)다. 처음 상태도 손님이 보는 결과다.

## 무엇을 단언하는가

| 단언 | 왜 |
|---|---|
| 처음 상태(동의는 비어 있음, 버튼은 꺼짐) | 기본값을 바꾼 결함은 조작 뒤 결과만 봐서는 못 잡는다 |
| 조작 뒤 결과(버튼이 켜짐·꺼짐, 고른 결제수단) | 손님이 기대하는 반응이다 |
| 라벨로도 조작된다 | 라벨이 이어지지 않으면 문구를 눌러도 반응이 없고, 화면 읽기 프로그램이 이름을 못 읽는다 |
| 조작이 보낸 요청(바뀐 결제수단으로 다시 물음) | 화면만 바뀌고 서버에는 예전 값이 가는 결함을 잡는다 |

## 예시

| 파일 | 무엇을 |
|---|---|
| `assets/checkout-consent.test.tsx` | 좋은 예시 — 결제 동의의 처음 상태, 켜고 끄기, 라벨로 켜기, 결제수단 바꾸기 |
| `assets/checkout-consent.slop.test.tsx` | 슬롭 예시 — 체크박스를 `querySelector`로 찾아 `fireEvent`로 누르고, 상태가 뒤집혔는지만 본다 |

찾을 때는 역할과 이름을 쓴다. 이름은 화면의 문구다.

```tsx
openAt('/checkout', CART)

const consent = await screen.findByRole('checkbox', { name: CONSENT })

expect(consent).not.toBeChecked()
expect(screen.getByRole('button', { name: PAY })).toBeDisabled()
```

결제 동의를 처음부터 켜 두게 바꾸면 좋은 예시는 처음 상태에서 실패하고, 슬롭 예시는 그대로 통과한다. 슬롭 예시는 "누르면 뒤집힌다"만 봐서, 처음에 켜져 있어도 꺼져 있어도 같다.

## AI가 흔히 쓰는 테스트 / 대신

| 흔히 | 왜 놓치나 | 대신 |
|---|---|---|
| `container.querySelector('input[type=checkbox]')` | 구조가 바뀌면 깨지고, 이름 없는 체크박스도 통과한다 | `getByRole('checkbox', { name })` |
| `fireEvent.click` | 포커스·눌림 순서가 빠져 실제와 다르게 동작할 수 있다 | `await user.click` |
| 상태가 뒤집혔는지만(`toBe(!before)`) | 처음 상태가 틀려도 통과한다 | 처음 상태를 먼저 단언한다 |
| 컴포넌트 state·props·핸들러 호출 횟수를 단언 | 손님이 보는 결과와 상관없다 | 버튼 상태·문구·보낸 요청 |
| `getByTestId`부터 쓴다 | 이름 없는 요소를 그대로 둔다 | 역할 → 라벨 → 글자 순, test id는 마지막 |

## Jest와 다른 줄

| Vitest | Jest |
|---|---|
| `vi.waitFor` | Testing Library의 `waitFor` |

user-event·Testing Library 쿼리는 두 도구에서 같다.

## 주의사항

- `userEvent.setup()`을 테스트마다 한 번 부르고 그 `user`로 조작한다. 예시의 `openAt`이 해 준다.
- 조작은 `await`한다. 기다리지 않으면 다음 단언이 이전 화면을 본다.
- 키보드 조작(탭 이동·Space·Esc)은 2차 패턴 `keyboard-focus`에서 따로 다룬다.
