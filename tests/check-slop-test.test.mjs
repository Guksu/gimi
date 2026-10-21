import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { checkSlop } from '../skills/gimi-test/scripts/lib/slop.mjs'

/** 파일마다 모든 줄이 바뀐 것으로(새 파일) 검사한다 */
const run = (files, { stacks, changedPaths } = {}) =>
  checkSlop({
    files: Object.entries(files).map(([path, text]) => ({ path, text, lines: { all: true, added: new Set(), hunks: [] } })),
    changedPaths: changedPaths ?? Object.keys(files),
    stacks,
  })
const ids = (result) => result.findings.map((f) => `${f.id}:${f.line}`)
const one = (text, path = 'src/cart.test.ts') => ids(run({ [path]: text }))

describe('test/only-left (error)', () => {
  it('.only·fit·fdescribe가 남으면 error다', () => {
    const result = run({ 'src/a.test.ts': "it.only('a', () => { expect(1 + 1).toBe(2) })\nfdescribe('b', () => {})\ntest.concurrent.only('c', () => { expect(f()).toBe(2) })\n" })
    assert.deepEqual(ids(result), ['test/only-left:1', 'test/only-left:2', 'test/only-left:3'])
    assert.ok(result.findings.every((f) => f.severity === 'error'))
  })

  it('문자열·주석 안의 .only와 다른 객체의 only 메서드는 보지 않는다', () => {
    assert.deepEqual(one("// it.only('x')\nconst s = 'it.only('\nit('a', () => { expect(list.only(1)).toBe(1) })\n").filter((id) => id.startsWith('test/')), [])
  })
})

describe('test/skip-without-reason (warn) · done/test-bent (warn)', () => {
  it('이유 주석 없는 skip·xit·todo는 warn이다', () => {
    assert.deepEqual(one("it.skip('a', () => { expect(f()).toBe(1) })\nxit('b', () => { expect(f()).toBe(1) })\nit.todo('c')\n"), ['test/skip-without-reason:1', 'test/skip-without-reason:2', 'test/skip-without-reason:3'])
  })

  it('같은 줄이나 바로 윗줄에 이유 주석이 있으면 skip 대신 "건너뛰게 했다"를 보고하라고 알린다(done/test-bent)', () => {
    assert.deepEqual(one("// 결제 샌드박스 점검 중 — SHOP-12\nit.skip('a', () => { expect(f()).toBe(1) })\nit.skip('b', () => { expect(f()).toBe(1) }) // #34 고칠 때까지\n"), ['done/test-bent:2', 'done/test-bent:3'])
  })

  it('건너뛰게 한 테스트는 보고에 밝힐 지적으로 표시한다(disclose)', () => {
    const result = run({ 'src/a.test.ts': "it.skip('a', () => { expect(f()).toBe(1) })\n// #1 대기\nit.skip('b', () => { expect(f()).toBe(1) })\n" })
    assert.deepEqual(result.findings.map((f) => [f.id, f.disclose]), [['test/skip-without-reason', true], ['done/test-bent', true]])
  })

  it('Playwright의 조건부 test.skip(조건, 이유)는 이유가 있는 것으로 본다', () => {
    assert.deepEqual(one("test('a', async ({ page, browserName }) => {\n  test.skip(browserName === 'webkit', '사파리는 결제 위젯 미지원')\n  await expect(page).toHaveTitle('x')\n})\n", 'e2e/pay.spec.ts'), ['done/test-bent:2'])
  })
})

describe('test/no-assertion (error)', () => {
  it('단언이 없는 테스트는 error다 — 테스트 이름의 줄을 가리킨다', () => {
    const result = run({ 'src/cart.test.tsx': "import { render } from '@testing-library/react'\n\nit('renders without crashing', () => {\n  render(<Cart />)\n})\n" })
    assert.deepEqual(ids(result), ['test/no-assertion:3'])
    assert.equal(result.findings[0].severity, 'error')
  })

  it('expect·assert·supertest의 .expect·getBy 조회·t.assert는 단언이다', () => {
    const text = [
      "it('a', () => { expect(sum(1, 2)).toBe(3) })",
      "it('b', () => { assert.equal(sum(1, 2), 3) })",
      "it('c', async () => { await request(app).get('/').expect(200) })",
      "it('d', () => { render(<A />); screen.getByRole('button', { name: '결제' }) })",
      "test('e', (t) => { t.assert.ok(sum(1, 2)) })",
      "it('f', async () => { await expectTotal(cart, 3) })",
    ].join('\n')
    assert.deepEqual(one(text, 'src/cart.test.tsx'), [])
  })

  it('같은 파일에서 정의한, 단언하는 도우미를 부르면 단언이 있는 것으로 본다 — 도우미가 다른 도우미를 불러도', () => {
    const text = [
      'const check = (cart, total) => {',
      '  expect(sum(cart)).toBe(total)',
      '}',
      'function verifyAll(cases) {',
      '  for (const c of cases) check(c.cart, c.total)',
      '}',
      "it('a', () => verifyAll([{ cart: [], total: 0 }]))",
    ].join('\n')
    assert.deepEqual(one(text), [])
  })

  it('assert 모듈에서 가져온 함수(ok·equal)는 단언이다', () => {
    assert.deepEqual(one("import { ok } from 'node:assert/strict'\nit('a', () => { ok(sum(1, 2) === 3) })\n"), [])
  })

  it('테스트 도우미 모듈에서 가져온 함수는 안을 볼 수 없어 판단하지 않는다 — 단 render·setup처럼 단언하지 않는 이름은 예외다', () => {
    assert.deepEqual(one("import { assertCart, runCase } from './helpers'\nit('a', () => { runCase(1) })\n"), [])
    assert.deepEqual(one("import { renderWithProviders } from '../test-utils'\nit('a', () => { renderWithProviders(<Cart />) })\n", 'src/cart.test.tsx'), ['test/no-assertion:2'])
  })

  it('테스트 대상을 부르기만 하고 단언하지 않으면 error다', () => {
    assert.deepEqual(one("import { addItem } from './cart'\nit('adds', () => {\n  addItem(cart, item)\n})\n"), ['test/no-assertion:2'])
  })

  it('함수를 넘기지 않은 테스트(it.todo·도우미 이름만 넘김)는 판단하지 않는다', () => {
    assert.deepEqual(one("it('a', sharedCase)\n"), [])
  })

  it('it.each는 표 다음의 호출을 테스트 본문으로 본다', () => {
    assert.deepEqual(one("it.each([[1, 2]])('a %i', (a, b) => {\n  sum(a, b)\n})\nit.each`\n  a | b\n`('b', ({ a }) => { expect(a).toBe(1) })\n"), ['test/no-assertion:1'])
  })
})

describe('test/tautology (warn)', () => {
  it('리터럴을 단언하거나, 같은 식을 양쪽에 두거나, render 결과를 toBeTruthy로 보면 warn이다', () => {
    const text = [
      "it('a', () => {",
      '  expect(true).toBe(true)',
      '  expect(total).toBe(total)',
      '  assert.equal(1, 1)',
      "  expect(render(<A />)).toBeTruthy()",
      '})',
    ].join('\n')
    assert.deepEqual(one(text, 'src/a.test.tsx'), ['test/tautology:2', 'test/tautology:3', 'test/tautology:4', 'test/tautology:5'])
  })

  it('같은 호출을 양쪽에 둔 결정성 확인(같은 입력이면 같은 값, 두 번 부르면 다른 값)은 보지 않는다', () => {
    assert.deepEqual(one("it('a', () => {\n  expect(nickname({ id: 1 })).toBe(nickname({ id: 1 }))\n  expect(newId()).not.toBe(newId())\n})\n"), [])
  })

  it('값이 틀리면 실패하는 단언은 보지 않는다 — getBy 결과의 toBeTruthy(React Native 관용구)는 조회가 이미 있는지 확인하므로 넘긴다', () => {
    assert.deepEqual(one("it('a', () => {\n  expect(sum(1, 2)).toBe(3)\n  expect(screen.getByText('합계')).toBeInTheDocument()\n  expect(screen.queryByText('x')).toBeNull()\n  expect(screen.getByTestId('pay')).toBeTruthy()\n})\n", 'src/a.test.ts').filter((id) => id.startsWith('test/tautology')), [])
  })
})

describe('test/mock-echo (warn)', () => {
  it('mock이 돌려준 값을 같은 테스트에서 그대로 기대값으로 쓰면 warn이다 — beforeEach에서 정한 mock도 본다', () => {
    const text = [
      "beforeEach(() => { api.getCoupons.mockResolvedValue(coupons) })",
      "it('a', async () => {",
      '  api.getUser.mockResolvedValue({ id: 1, name: "kim" })',
      '  const user = await service.getUser(1)',
      '  expect(user).toEqual({ id: 1, name: "kim" })',
      '  expect(await service.coupons()).toEqual(coupons)',
      '})',
    ].join('\n')
    assert.deepEqual(one(text), ['test/mock-echo:5', 'test/mock-echo:6'])
  })

  it('true·null·빈 배열처럼 흔한 값이 같은 것은 우연일 수 있어 보지 않는다', () => {
    assert.deepEqual(one("it('a', async () => {\n  repo.save.mockResolvedValue(true)\n  expect(await service.save(order)).toBe(true)\n})\n"), [])
  })
})

describe('test/mock-subject (error)', () => {
  it('테스트 파일과 이름이 같은, 테스트 대상 모듈을 통째로 mock하면 error다 — __tests__ 폴더도', () => {
    assert.deepEqual(one("import { total } from './cart'\nvi.mock('./cart')\nit('a', () => { expect(total()).toBe(3) })\n"), ['test/mock-subject:2'])
    assert.deepEqual(one("jest.mock('../cart', () => ({ total: () => 3 }))\nit('a', () => { expect(total()).toBe(3) })\n", 'src/__tests__/cart.test.ts'), ['test/mock-subject:1'])
  })

  it('일부만 바꾸는 mock(importActual·importOriginal)과 다른 모듈의 mock은 보지 않는다', () => {
    assert.deepEqual(one("vi.mock('./cart', async (importOriginal) => ({ ...(await importOriginal()), now: () => 1 }))\nvi.mock('../api/cart')\nit('a', () => { expect(total()).toBe(3) })\n"), [])
  })
})

describe('test/swallowed-failure (error)', () => {
  it('try 안의 단언 실패를 catch가 삼키면 error다', () => {
    assert.deepEqual(one("it('a', async () => {\n  try {\n    expect(await pay()).toBe('ok')\n  } catch (e) {\n    console.log(e)\n  }\n})\n").filter((id) => id.startsWith('test/')), ['test/swallowed-failure:4'])
  })

  it('단언이 catch 안에만 있으면 오류가 나지 않아도 통과하므로 error다 — expect.assertions가 있으면 보지 않는다', () => {
    assert.deepEqual(one("it('a', async () => {\n  try {\n    await pay(-1)\n  } catch (e) {\n    expect(e.message).toBe('금액 오류')\n  }\n})\n"), ['test/swallowed-failure:4'])
    assert.deepEqual(one("it('a', async () => {\n  expect.assertions(1)\n  try {\n    await pay(-1)\n  } catch (e) {\n    expect(e.message).toBe('금액 오류')\n  }\n})\n"), [])
  })

  it('단언이 else 없는 if 안에만 있으면 error다 — else에서도 단언하거나 던지면 보지 않는다', () => {
    assert.deepEqual(one("it('a', () => {\n  const r = parse(x)\n  if (r.ok) {\n    expect(r.value).toBe(1)\n  }\n})\n"), ['test/swallowed-failure:3'])
    assert.deepEqual(one("it('a', () => {\n  const r = parse(x)\n  if (r.ok) expect(r.value).toBe(1)\n  else throw new Error(r.error)\n})\n"), [])
    assert.deepEqual(one("it('a', () => {\n  if (!r.ok) throw new Error('x')\n  expect(r.value).toBe(1)\n})\n"), [])
  })

  it('if 밖에도 단언이 있으면 보지 않는다. if 안에서 getBy로 찾아 누르기만 하면 단언이 아니다', () => {
    assert.deepEqual(one("it('a', async () => {\n  for (const [k, v] of map) {\n    if (k.includes('.')) expect(v.length).toBeLessThan(10)\n  }\n  expect(keys.length).toBe(3)\n})\n"), [])
    assert.deepEqual(one("it('a', () => {\n  for (const i of [0, 1, 2]) {\n    expect(current()).toBe(i)\n    if (i < 2) {\n      fireEvent.press(screen.getByLabelText('다음'))\n    }\n  }\n})\n", 'src/a.test.tsx'), [])
  })
})

describe('test/rewritten-expectation (warn)', () => {
  const hunk = (removed, added, at) => ({ oldStart: at, oldLines: removed.length, newStart: at, newLines: added.length, removed: removed.map((text, i) => ({ line: at + i, text })), added: added.map((text, i) => ({ line: at + i, text })) })
  const text = "it('total', () => {\n  expect(total(cart)).toBe(3100)\n})\n"
  const file = { path: 'src/cart.test.ts', text, lines: { all: false, added: new Set([2]), hunks: [hunk(['  expect(total(cart)).toBe(3000)'], ['  expect(total(cart)).toBe(3100)'], 2)] } }

  it('구현을 바꾼 변경에서 같은 단언의 기대값만 바꿨으면 warn이다 — 바뀌기 전과 뒤의 값을 적는다', () => {
    const result = checkSlop({ files: [file], changedPaths: ['src/cart.ts', 'src/cart.test.ts'] })
    assert.deepEqual(ids(result), ['test/rewritten-expectation:2'])
    assert.match(result.findings[0].message, /3000 → 3100/)
  })

  it('테스트만 바뀌었으면(구현은 그대로) 보지 않는다', () => {
    assert.deepEqual(ids(checkSlop({ files: [file], changedPaths: ['src/cart.test.ts'] })), [])
  })
})

describe('test/implementation-detail · test/testid-first · test/waitfor-misuse (warn, 프론트만)', () => {
  const text = [
    "it('a', async () => {",
    '  render(<Cart />)',
    "  expect(container.querySelector('.total')).toHaveTextContent('3,000원')",
    "  expect(screen.getByRole('status')).toHaveClass('is-active')",
    "  expect(screen.getByTestId('pay')).toBeEnabled()",
    '  await waitFor(() => {',
    "    fireEvent.click(screen.getByRole('button'))",
    "    expect(a).toBe(1)",
    '  })',
    "  await waitFor(() => { expect(a).toBe(1); expect(b).toBe(2) })",
    "  await waitFor(() => screen.getByText('완료'))",
    '})',
  ].join('\n')

  it('querySelector·클래스명 단언·testid 찾기·waitFor 안의 동작·여러 단언·조회만 하는 waitFor는 warn이다', () => {
    assert.deepEqual(one(text, 'src/cart.test.tsx'), [
      'test/implementation-detail:3',
      'test/implementation-detail:4',
      'test/testid-first:5',
      'test/waitfor-misuse:6',
      'test/waitfor-misuse:10',
      'test/waitfor-misuse:11',
    ])
  })

  it('React Native Testing Library는 testID로 찾는 것이 관례라 testid-first를 보지 않는다', () => {
    assert.deepEqual(one("import { render, screen } from '@testing-library/react-native'\nit('a', () => {\n  render(<Cart />)\n  expect(screen.getByTestId('pay')).toBeOnTheScreen()\n})\n", 'src/cart.test.tsx'), [])
  })

  it('설정 stacks에 frontend-ts가 없으면 프론트 전용 줄은 보지 않는다', () => {
    assert.deepEqual(ids(run({ 'src/cart.test.tsx': text }, { stacks: ['backend'] })), [])
  })
})

describe('test/real-wait (warn)', () => {
  it('실제 시간 기다리기와 고정하지 않은 현재 시각은 warn이다', () => {
    const text = "it('a', async () => {\n  await new Promise((r) => setTimeout(r, 500))\n  await sleep(100)\n  expect(isExpired(new Date())).toBe(false)\n})\n"
    assert.deepEqual(one(text), ['test/real-wait:2', 'test/real-wait:3', 'test/real-wait:4'])
  })

  it('가짜 타이머·setSystemTime을 쓰는 파일과 0초 기다리기(마이크로태스크 비우기)는 보지 않는다', () => {
    assert.deepEqual(one("beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-21')) })\nit('a', async () => {\n  setTimeout(done, 1000)\n  vi.advanceTimersByTime(1000)\n  expect(isExpired(new Date())).toBe(true)\n})\n"), [])
    assert.deepEqual(one("it('a', async () => {\n  await new Promise((r) => setTimeout(r, 0))\n  expect(a).toBe(1)\n})\n"), [])
  })

  it("Playwright의 waitForTimeout은 늘 warn이다", () => {
    assert.deepEqual(one("test('a', async ({ page }) => {\n  await page.waitForTimeout(1000)\n  await expect(page).toHaveURL('/done')\n})\n", 'e2e/a.spec.ts'), ['test/real-wait:2'])
  })
})

describe('test/network-module-mock · test/silenced-console · test/retry-mask (warn)', () => {
  it('axios·fetch를 직접 mock하면 warn이다', () => {
    assert.deepEqual(one("vi.mock('axios')\nglobal.fetch = vi.fn()\nvi.spyOn(globalThis, 'fetch')\nit('a', () => { expect(a).toBe(1) })\n"), ['test/network-module-mock:1', 'test/network-module-mock:2', 'test/network-module-mock:3'])
  })

  it('원래 fetch로 되돌리는 대입은 보지 않는다', () => {
    assert.deepEqual(one("afterEach(() => { globalThis.fetch = originalFetch })\nit('a', () => { expect(a).toBe(1) })\n"), [])
  })

  it('console.error·warn을 막으면 warn이다 — 막은 경고를 단언하면 보지 않는다', () => {
    assert.deepEqual(one("beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })\nit('a', () => { expect(a).toBe(1) })\n"), ['test/silenced-console:1'])
    assert.deepEqual(one("it('a', () => {\n  const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})\n  run()\n  expect(spy).toHaveBeenCalledWith('deprecated')\n})\n"), [])
    assert.deepEqual(one("let warnSpy\nbeforeEach(() => { warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {}) })\nit('a', () => { run(); expect(warnSpy).toHaveBeenCalled() })\n"), [])
    assert.deepEqual(one("beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}) })\nit('a', () => { run(); expect(console.warn).toHaveBeenCalledWith('x') })\n"), [])
    assert.deepEqual(one("const spies = { error: vi.spyOn(console, 'error').mockImplementation(() => {}) }\nit('a', () => { run(); expect(spies.error).toHaveBeenCalled() })\n"), [])
  })

  it('테스트의 재시도 옵션과 테스트 설정 파일의 retry는 warn이다 — 0이면 보지 않는다', () => {
    assert.deepEqual(one("it('a', { retry: 3 }, () => { expect(a).toBe(1) })\njest.retryTimes(2)\n"), ['test/retry-mask:1', 'test/retry-mask:2'])
    assert.deepEqual(ids(run({ 'playwright.config.ts': "export default { retries: process.env.CI ? 2 : 0 }\n", 'vitest.config.ts': 'export default { test: { retry: 0 } }\n' })), ['test/retry-mask:1'])
  })

  it('앱 코드의 retry 옵션(React Query 등)은 테스트 재시도가 아니라 보지 않는다', () => {
    assert.deepEqual(ids(run({ 'src/query.ts': 'export const client = new QueryClient({ defaultOptions: { queries: { retry: 3 } } })\n' })), [])
  })
})

describe('test/snapshot-dump (warn)', () => {
  it('화면 전체를 스냅샷하면 warn이다', () => {
    assert.deepEqual(one("it('a', () => {\n  const { container, asFragment } = render(<Cart />)\n  expect(container).toMatchSnapshot()\n  expect(asFragment()).toMatchSnapshot()\n  expect(total(cart)).toMatchInlineSnapshot('3000')\n})\n", 'src/cart.test.tsx'), ['test/snapshot-dump:3', 'test/snapshot-dump:4'])
  })

  it('같은 변경에서 스냅샷 파일을 고쳤으면 warn이다 — 새로 만든 스냅샷은 보지 않는다', () => {
    const changed = { path: 'src/__snapshots__/cart.test.tsx.snap', text: 'exports[`a 1`] = `<div>3,100원</div>`;\n', lines: { all: false, added: new Set([1]), hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, removed: [{ line: 1, text: 'exports[`a 1`] = `<div>3,000원</div>`;' }], added: [{ line: 1, text: 'exports[`a 1`] = `<div>3,100원</div>`;' }] }] } }
    assert.deepEqual(ids(checkSlop({ files: [changed], changedPaths: [changed.path] })), ['test/snapshot-dump:1'])
    assert.deepEqual(ids(checkSlop({ files: [{ ...changed, lines: { all: true, added: new Set(), hunks: [] } }], changedPaths: [changed.path] })), [])
  })
})
