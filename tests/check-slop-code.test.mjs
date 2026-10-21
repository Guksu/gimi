import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { checkSlop, slopTargetOf } from '../skills/gimi-test/scripts/lib/slop.mjs'

const run = (files, { stacks } = {}) =>
  checkSlop({
    files: Object.entries(files).map(([path, text]) => ({ path, text, lines: { all: true, added: new Set(), hunks: [] } })),
    changedPaths: Object.keys(files),
    stacks,
  })
const ids = (result) => result.findings.map((f) => `${f.id}:${f.line}`)
const one = (text, path = 'src/pay.ts') => ids(run({ [path]: text }))

describe('slopTargetOf — 어떤 파일을 어떤 규칙으로 보나', () => {
  it('테스트 파일·코드 파일·스냅샷을 가른다 — 타입 선언·압축 파일·도구 폴더·다른 언어는 보지 않는다', () => {
    assert.deepEqual(
      ['src/a.test.ts', 'src/__tests__/b.tsx', 'e2e/c.spec.mjs', 'src/a.ts', 'vitest.config.ts', 'src/__snapshots__/a.test.ts.snap', 'src/types.d.ts', 'dist/x.min.js', '.agents/x.js', 'app/order.py', 'README.md'].map(slopTargetOf),
      ['test', 'test', 'test', 'code', 'code', 'snapshot', null, null, null, null, null],
    )
  })

  it('테스트 설정(jest.setup·setupTests)과 테스트 도우미 폴더(test/·tests/·__mocks__/)는 테스트 파일로 본다', () => {
    assert.deepEqual(
      ['jest.setup.ts', 'vitest.setup.ts', 'src/setupTests.ts', 'src/test/setDevMode.ts', 'tests/helpers/repo.mjs', 'src/__mocks__/expo.ts', 'src/testing.ts', 'src/latest/a.ts'].map(slopTargetOf),
      ['test', 'test', 'test', 'test', 'test', 'test', 'code', 'code'],
    )
  })
})

describe('code/empty-catch (error)', () => {
  it('빈 catch와 빈 .catch(() => {})는 error다', () => {
    const result = run({ 'src/pay.ts': 'try {\n  pay()\n} catch (e) {}\nload().catch(() => {})\nload().catch(function () {})\n' })
    assert.deepEqual(ids(result), ['code/empty-catch:3', 'code/empty-catch:4', 'code/empty-catch:5'])
    assert.ok(result.findings.every((f) => f.severity === 'error'))
  })

  it('이유를 주석으로 단 catch와 처리하는 catch는 보지 않는다', () => {
    assert.deepEqual(one('try {\n  pay()\n} catch {\n  // 결제 위젯이 없는 브라우저 — 버튼을 숨긴 채로 둔다\n}\nload().catch((e) => report(e))\n'), [])
  })

  it('실패를 대체값으로 바꾸는 .catch(() => null)은 삼키는 것이 아니라 보지 않는다', () => {
    assert.deepEqual(one('const data = await res.json().catch(() => null)\nif (!data) throw new Error(\'응답 형식 오류\')\n'), [])
  })
})

describe('code/type-escape (warn)', () => {
  it('as any·as unknown as·@ts-ignore·@ts-nocheck·이유 없는 @ts-expect-error는 warn이다', () => {
    const text = '// @ts-nocheck\nconst a = b as any\nconst c = d as unknown as Order\n// @ts-ignore\nfoo()\n// @ts-expect-error\nbar()\n// @ts-expect-error 라이브러리 타입이 v3 옵션을 모른다\nbaz()\n'
    assert.deepEqual(one(text), ['code/type-escape:1', 'code/type-escape:2', 'code/type-escape:3', 'code/type-escape:4', 'code/type-escape:6'])
  })

  it('테스트 파일의 as any는 보지 않는다 — 가짜 객체에 흔하고 테스트 슬롭 규칙이 따로 본다', () => {
    assert.deepEqual(one("it('a', () => { expect(total(cart as any)).toBe(1) })\n", 'src/a.test.ts'), [])
  })
})

describe('code/commented-out (warn)', () => {
  it('주석 처리한 코드는 이어진 줄을 하나로 묶어 첫 줄에 알린다', () => {
    const result = run({ 'src/pay.ts': 'const a = 1\n// const b = 2\n// if (b) {\n//   pay(b)\n// }\nconst c = 3\n// console.log(c)\n' })
    assert.deepEqual(ids(result), ['code/commented-out:2', 'code/commented-out:7'])
    assert.match(result.findings[0].message, /4줄/)
  })

  it('설명 주석·지시 주석(eslint·@ts-·prettier)·코드 뒤에 붙은 주석·예시 한 줄이 섞인 설명은 보지 않는다', () => {
    const text = [
      '// 쿠폰은 결제 직전에 다시 확인한다',
      '// return early when empty',
      '// eslint-disable-next-line no-console',
      'foo() // bar()',
      '// 금액 형식 — 예시는 아래와 같다',
      '//   formatPrice(1000)',
      '// 반올림은 원 단위에서 한다',
      'const x = 1',
    ].join('\n')
    assert.deepEqual(one(text), [])
  })
})

describe('code/debug-leftover (debugger는 error, 나머지 warn)', () => {
  it('debugger는 error, console.log·localhost 주소·이슈 번호 없는 TODO는 warn이다', () => {
    const result = run({ 'src/pay.ts': "debugger\nconsole.log(order)\nconst api = 'http://localhost:3000/api'\n// TODO 금액 검증\n// TODO(#12) 부분 환불\n// FIXME SHOP-31 반올림\nconsole.error(e)\n" })
    assert.deepEqual(
      result.findings.map((f) => [f.id, f.line, f.severity]),
      [
        ['code/debug-leftover', 1, 'error'],
        ['code/debug-leftover', 2, 'warn'],
        ['code/debug-leftover', 3, 'warn'],
        ['code/debug-leftover', 4, 'warn'],
      ],
    )
  })

  it('#!로 시작하는 실행 스크립트의 console.log는 출력이라 보지 않는다. 테스트 파일의 localhost 주소(MSW 핸들러 등)도 보지 않는다', () => {
    assert.deepEqual(one('#!/usr/bin/env node\nconsole.log(USAGE)\n', 'scripts/run.mjs'), [])
    assert.deepEqual(one("const message = 'localhost 주소는 설정으로 뺀다'\n"), [])
    assert.deepEqual(one("const handler = http.get('http://localhost/api/cart', () => {})\nit('a', () => { expect(a).toBe(1) })\n", 'src/a.test.ts'), [])
  })
})

describe('code/index-key (warn, 프론트만)', () => {
  it('목록의 key가 map의 index면 warn이다 — 문자열로 바꿔도', () => {
    assert.deepEqual(one('const a = items.map((item, i) => <li key={i}>{item.name}</li>)\nconst b = items.map((item, index) => <Row key={`row-${index}`} {...item} />)\nconst c = items.map((item) => <li key={item.id}>{item.name}</li>)\n', 'src/List.tsx'), ['code/index-key:1', 'code/index-key:2'])
  })

  it('index와 고유 값을 함께 쓰면 보지 않는다. stacks에 frontend-ts가 없으면 보지 않는다', () => {
    assert.deepEqual(one('const a = items.map((item, i) => <li key={`${item.id}-${i}`}>{item.name}</li>)\n', 'src/List.tsx'), [])
    assert.deepEqual(ids(run({ 'src/List.tsx': 'items.map((item, i) => <li key={i} />)\n' }, { stacks: ['backend'] })), [])
  })
})

describe('무시 주석 — // gimi-ignore: {ID} — {이유}', () => {
  it('같은 줄이나 바로 윗줄의 무시 주석에 이유가 있으면 지적을 무시 목록으로 옮긴다', () => {
    const result = run({ 'src/pay.ts': "// gimi-ignore: code/debug-leftover — 운영에서 결제 오류를 추적하는 로그\nconsole.log(order)\nconst a = b as any // gimi-ignore: code/type-escape, code/debug-leftover — SDK 타입이 틀렸다(#40)\n" })
    assert.deepEqual(ids(result), [])
    assert.deepEqual(result.ignored.map((f) => [f.id, f.line, f.reason]), [
      ['code/debug-leftover', 2, '운영에서 결제 오류를 추적하는 로그'],
      ['code/type-escape', 3, 'SDK 타입이 틀렸다(#40)'],
    ])
  })

  it('이유가 없는 무시 주석은 무시하지 않고 그렇다고 적는다', () => {
    const result = run({ 'src/pay.ts': '// gimi-ignore: code/debug-leftover\nconsole.log(order)\n' })
    assert.deepEqual(ids(result), ['code/debug-leftover:2'])
    assert.match(result.findings[0].note, /이유가 없/)
  })

  it('블록 단위 지적(단언 없는 테스트)은 테스트를 시작하는 줄 위의 주석으로 무시한다', () => {
    const result = run({ 'src/a.test.ts': "// gimi-ignore: test/no-assertion — 던지지 않는 것만 확인하는 스모크 테스트\nit('boots', () => {\n  boot()\n})\n" })
    assert.deepEqual(ids(result), [])
    assert.equal(result.ignored.length, 1)
  })
})

describe('바뀐 줄만 본다', () => {
  it('바뀌지 않은 줄의 슬롭은 알리지 않는다 — 블록 단위 지적은 블록 안의 줄이 하나라도 바뀌면 알린다', () => {
    const text = "console.log(a)\nconsole.log(b)\nit('a', () => {\n  run()\n})\n"
    const result = checkSlop({ files: [{ path: 'src/a.test.ts', text, lines: { all: false, added: new Set([2, 4]), hunks: [] } }], changedPaths: ['src/a.test.ts'] })
    assert.deepEqual(ids(result), ['code/debug-leftover:2', 'test/no-assertion:3'])
  })

  it('파일별로 줄 순서대로 돌려주고, 지적마다 그 줄의 원문을 담는다', () => {
    const result = run({ 'src/b.ts': 'debugger\n', 'src/a.ts': 'const x = 1\ndebugger\n' })
    assert.deepEqual(result.findings.map((f) => [f.path, f.line, f.excerpt]), [
      ['src/a.ts', 2, 'debugger'],
      ['src/b.ts', 1, 'debugger'],
    ])
    assert.deepEqual(result.checked, { test: 0, code: 2, snapshot: 0 })
  })
})

describe('RULE_SEVERITY — check.mjs가 내는 지적의 목록', () => {
  it('규칙 코드가 내는 ID를 모두 담고, 등급(error·warn)이 코드와 같다', async () => {
    const { RULE_SEVERITY } = await import('../skills/gimi-test/scripts/lib/slop.mjs')
    const { readFileSync } = await import('node:fs')
    const source = ['slop-test.mjs', 'slop-code.mjs'].map((name) => readFileSync(new URL(`../skills/gimi-test/scripts/lib/${name}`, import.meta.url), 'utf8')).join('\n')
    const emitted = new Set([...source.matchAll(/(?:add\(|id: )'((?:test|code|done)\/[a-z-]+)'/g)].map((m) => m[1]))
    assert.deepEqual([...emitted].sort(), Object.keys(RULE_SEVERITY).sort())
    assert.equal(RULE_SEVERITY['test/only-left'], 'error')
    assert.equal(RULE_SEVERITY['code/debug-leftover'], 'warn')
  })
})
