---
name: test-audit
description: 다 쓴 테스트에 슬롭(AI가 쓴 티가 나는 테스트)이 없는지 점검한다 — check.mjs가 바뀐 테스트 줄에서 찾는 규칙(.only, 단언 없음, 대상 모듈 통째 mock, 실패를 삼키는 try/catch, 늘 참인 단언, 실제 시간 기다리기 등)과 사람이 리뷰에서 보는 규칙을 한 표로 보이고, 지적마다 고치는 법을 준다. "테스트 슬롭 점검, 테스트 검사, 이 테스트 괜찮아, .only 남았는지, 단언 없는 테스트, 늘 참인 단언, 실패를 삼키는 try catch, check.mjs 규칙 목록, 테스트 리뷰" 요청에 쓴다.
target: 둘 다
---

# test-audit — 다 쓴 테스트를 금지선에 대어 본다

## 언제 쓰는가

테스트를 다 쓴 뒤, 그리고 남이 쓴 테스트를 볼 때 쓴다. 통과하는 테스트라도 아무것도 지키지 않을 수 있다. `.only`가 남아 다른 테스트가 돌지 않거나, 단언이 없거나, 실패를 `try/catch`로 삼키는 경우다. 이런 것은 대부분 글자 모양으로 찾을 수 있어서 `check.mjs`가 바뀐 줄에서 찾는다. 나머지는 리뷰에서 사람이 본다.

```bash
node <이 스킬 폴더>/scripts/check.mjs
```

보고의 슬롭 줄은 `등급 ID 파일:줄 상황 — 대신`이다. `error`는 고친다. `warn`은 판단해서 고치거나, 그대로 두면 이유를 보고에 적는다. 일부러 남길 줄에는 `// gimi-ignore: {ID} — {이유}`를 단다.

## 무엇을 단언하는가

이 패턴은 테스트를 쓰는 법이 아니라 점검표다. 표의 "잡는 곳"이 `error`·`warn`이면 `check.mjs`가 찾고, `리뷰`면 사람이 본다. 한 줄의 왜·대신·확인은 `node <이 스킬 폴더>/scripts/rules.mjs --id {ID}`로 본다.

| 규칙 | 잡는 곳 | 대상 | 금지선 |
|---|---|---|---|
| `test/only-left` | error | 둘 다 | .only·fit을 남기지 않는다 |
| `test/skip-without-reason` | warn | 둘 다 | 이유 없이 테스트를 건너뛰게 두지 않는다 |
| `test/no-assertion` | error | 둘 다 | 단언이 없는 테스트를 쓰지 않는다 |
| `test/tautology` | warn | 둘 다 | 늘 참인 단언을 쓰지 않는다 |
| `test/mock-echo` | warn | 둘 다 | mock이 돌려준 값을 그대로 단언하지 않는다 |
| `test/mock-subject` | error | 둘 다 | 테스트 대상 모듈을 통째로 mock하지 않는다 |
| `test/rewritten-expectation` | warn | 둘 다 | 실패하자 기대값을 실제값으로 고치지 않는다 |
| `test/implementation-detail` | warn | 프론트 | 내부 구현을 단언하지 않는다 |
| `test/real-wait` | warn | 둘 다 | 실제 시간을 기다리거나 고정하지 않은 현재 시각에 기대지 않는다 |
| `test/waitfor-misuse` | warn | 프론트 | waitFor 안에서 동작을 실행하거나 단언을 여러 개 넣지 않는다 |
| `test/network-module-mock` | warn | 둘 다 | fetch·axios 모듈을 mock하지 않는다 |
| `test/swallowed-failure` | error | 둘 다 | try/catch로 실패를 삼키거나 단언을 if 안에만 두지 않는다 |
| `test/silenced-console` | warn | 둘 다 | console.error·warn을 막아 경고를 숨기지 않는다 |
| `test/snapshot-dump` | warn | 둘 다 | 화면 전체를 스냅샷하거나 말없이 갱신하지 않는다 |
| `test/testid-first` | warn | 프론트 | 역할로 찾을 수 있는데 testid로 찾지 않는다 |
| `test/retry-mask` | warn | 둘 다 | 재시도 설정으로 가끔 깨지는 테스트를 덮지 않는다 |
| `test/mock-repository` | 리뷰 | 백엔드 | 저장소·ORM을 통째로 mock하지 않는다 |
| `test/shared-db-state` | 리뷰 | 백엔드 | 테스트끼리 DB 데이터를 공유하지 않는다 |
| `test/sequential-only` | 리뷰 | 백엔드 | 동시성 규칙을 순차 호출로만 테스트하지 않는다 |
| `test/happy-status-only` | 리뷰 | 백엔드 | API 테스트가 200만 보지 않는다 |
| `test/real-external` | 리뷰 | 백엔드 | 테스트가 실제 외부 API를 부르지 않는다 |

## 예시

| 파일 | 무엇을 |
|---|---|
| `assets/cart.test.tsx` | 좋은 예시 — 프로젝트에 `cart.test.tsx`로 두면 `check.mjs`가 아무것도 찾지 않는다 |
| `assets/cart.slop.test.tsx` | 슬롭 예시 — 같은 자리에 두면 `check.mjs`가 표의 검사 규칙 14개를 찾는다(`test/rewritten-expectation`·`test/snapshot-dump`는 바뀐 줄이 있어야 보여 빠진다) |

슬롭 예시의 몇 줄과 대신 쓸 것이다.

| 슬롭 예시의 줄 | 찾는 규칙 | 대신 |
|---|---|---|
| `vi.mock('./cart')` | `test/mock-subject` | 대상은 실물, 경계 밖만 가짜([`test-principles`](../test-principles/PATTERN.md)) |
| `it.only('합계를 보인다', …)` | `test/only-left` | `.only`를 지운다 |
| `try { expect(…) } catch { }` | `test/swallowed-failure` | `try`를 지운다. 실패는 실패로 둔다 |
| `await new Promise((resolve) => setTimeout(resolve, 500))` | `test/real-wait` | 가짜 타이머([`fake-time`](../fake-time/PATTERN.md)) |
| `it('…', { retry: 3 }, …)` | `test/retry-mask` | 가끔 깨지는 원인(시간·순서·공유 상태)을 찾는다 |

## AI가 흔히 쓰는 테스트 / 대신

| 흔히 | 왜 놓치나 | 대신 |
|---|---|---|
| 통과하니 끝 | 통과가 무언가를 지킨다는 뜻은 아니다 | `check.mjs`로 금지선에 대어 본다 |
| `warn`을 말없이 무시 | 판단한 흔적이 남지 않는다 | 고치거나, 이유를 단 `gimi-ignore` |
| 이유 없는 `gimi-ignore` | 지적을 피하려고 단 주석이 된다 | 이유를 적는다. 이유가 없으면 무시하지 않는다 |
| 검사가 못 잡는 슬롭은 없다고 본다 | 정규식 수준이라 놓치는 것이 있다 | "리뷰" 줄은 직접 본다 |

## Jest와 다른 줄

| Vitest | Jest |
|---|---|
| `it.only`·`vi.mock` | `it.only`·`fit`·`jest.mock` — `check.mjs`는 둘 다 찾는다 |

## 주의사항

- `check.mjs`는 바뀐 줄만 본다. 오래된 테스트의 슬롭은 그 줄을 바꿀 때 드러난다.
- 슬롭 검사를 통과해도 결함을 잡는 테스트라는 뜻은 아니다. 다른 패턴의 슬롭 예시들은 이 검사를 통과하면서도 결함을 놓친다. 무엇을 단언할지는 각 패턴을 따른다.
