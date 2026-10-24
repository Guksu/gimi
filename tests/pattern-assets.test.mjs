import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { parseRuleFile, itemText } from '../skills/gimi-review/scripts/lib/rulefile.mjs'
import { checkSlop } from '../skills/gimi-test/scripts/lib/slop.mjs'

const skill = new URL('../skills/gimi-test/', import.meta.url)
const read = (path) => readFileSync(new URL(path, skill), 'utf8')
/** 프로젝트에 그 이름으로 둔 것처럼 슬롭을 검사한다 — 테스트 대상 모듈은 파일 이름으로 정해진다(cart.test.tsx → ./cart) */
const scan = (text, path) => checkSlop({ files: [{ path, text, lines: { all: true, added: new Set(), hunks: [] } }], changedPaths: [path] }).findings
// test-audit PATTERN.md의 규칙표 — | `test/only-left` | error | … |
const tableOf = (md) => new Map([...md.matchAll(/^\| `(test\/[\w-]+)` \| (error|warn|리뷰) \|/gm)].map((match) => [match[1], match[2]]))
// 바뀐 줄이 있어야 나오는 규칙 — 새 파일 하나로는 보일 수 없다
const NEEDS_DIFF = ['test/rewritten-expectation', 'test/snapshot-dump']

describe('test-audit — check.mjs가 잡는 테스트 슬롭', () => {
  it('PATTERN.md의 규칙표는 규칙 파일(shared/rules/test.md)의 "검사"와 같다 — 규칙마다 한 줄, 등급도 같다', () => {
    const expected = new Map(
      parseRuleFile(read('shared/rules/test.md')).rules.map((rule) => {
        const check = itemText(rule, '검사')
        return [rule.id, check.startsWith('error') ? 'error' : check.startsWith('warn') ? 'warn' : '리뷰']
      }),
    )
    assert.deepEqual(tableOf(read('patterns/test-audit/PATTERN.md')), expected)
  })

  it('슬롭 예시를 cart.test.tsx로 두면 표의 검사 규칙(error·warn)을 모두 찾는다', () => {
    const found = [...new Set(scan(read('patterns/test-audit/assets/cart.slop.test.tsx'), 'src/cart.test.tsx').map((finding) => finding.id))].sort()
    const expected = [...tableOf(read('patterns/test-audit/PATTERN.md'))].filter(([id, level]) => level !== '리뷰' && !NEEDS_DIFF.includes(id)).map(([id]) => id).sort()
    assert.deepEqual(found, expected)
  })

  it('좋은 예시를 cart.test.tsx로 두면 아무것도 찾지 않는다', () => {
    assert.deepEqual(scan(read('patterns/test-audit/assets/cart.test.tsx'), 'src/cart.test.tsx'), [])
  })
})

describe('패턴의 좋은 예시', () => {
  it('모든 패턴의 좋은 예시(*.test.ts(x))는 check.mjs가 아무것도 찾지 않는다 — 사용자가 복사해 쓸 정본이다', () => {
    const patterns = readdirSync(new URL('patterns/', skill)).filter((name) => existsSync(new URL(`patterns/${name}/assets`, skill)))
    const findings = patterns.flatMap((name) =>
      readdirSync(new URL(`patterns/${name}/assets`, skill))
        .filter((file) => /\.test\.tsx?$/.test(file) && !/\.slop\.test\.tsx?$/.test(file))
        .flatMap((file) => scan(read(`patterns/${name}/assets/${file}`), `src/${file}`).map((finding) => `${name}/${file}:${finding.line} ${finding.id}`)),
    )
    assert.deepEqual(findings, [])
  })
})
