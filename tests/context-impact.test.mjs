import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { collectContext } from '../skills/gimi-review/scripts/lib/collect.mjs'
import { execFor, makeRepo } from './helpers/repo.mjs'

const TSCONFIG = JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', noEmit: true, skipLibCheck: true }, include: ['src'] })

const BASE = {
  'tsconfig.json': TSCONFIG,
  'src/order.ts': [
    'export function getStatus(id: string): string {',
    '  return id',
    '}',
    'export function legacy(): number {',
    '  return 1',
    '}',
    'export function stable(): number {',
    '  return 2',
    '}',
    "export const LABEL = '주문'",
    '',
  ].join('\n'),
  'src/badge.ts': "import { getStatus } from './order'\nexport const badge = (id: string) => getStatus(id) === 'PAID'\n",
  'src/list.ts': "import { getStatus, legacy } from './order'\nexport const list = () => [getStatus('a'), legacy()]\n",
  'src/legacy-user.ts': "import { legacy } from './order'\nexport const old = () => legacy()\n",
  // 이름만 같은 지역 함수 — import하지 않았으니 getStatus의 사용처가 아니다
  'src/other.ts': "function getStatus() {\n  return 'local'\n}\nexport const other = getStatus()\n",
  'src/keys.ts': "export const ORDERS_KEY = 'orders/list'\n",
  'src/cache.ts': "export const cacheKey = 'orders/list'\n",
}

const CHANGED = {
  'src/order.ts': [
    'export function getStatus(id: string): { code: string } {',
    '  return { code: id }',
    '}',
    'export function stable(): number {',
    '  return 3',
    '}',
    "export const LABEL = '주문'",
    'export function fresh(): number {',
    '  return 4',
    '}',
    '',
  ].join('\n'),
  'src/list.ts': "import { getStatus } from './order'\nexport const list = () => [getStatus('a')]\n",
  'src/keys.ts': "export const ORDERS_KEY = 'orders/all'\n",
}

const buildRepo = () => {
  const repo = makeRepo()
  repo.write(BASE)
  repo.commit('feat: 처음')
  repo.git('switch', '-q', '-c', 'feat/status-object')
  repo.write(CHANGED)
  repo.commit('feat: 주문 상태를 객체로')
  return repo
}

const symbolOf = (impact, name) => impact.symbols.find((s) => s.name === name)
const where = (usages) => usages.map((u) => [u.path, u.line, u.changedInPr])

describe('영향 범위 — 프로젝트의 TypeScript로', () => {
  let repo
  let impact
  before(() => {
    repo = buildRepo()
    impact = collectContext({ exec: execFor({ dir: repo.dir }), useGh: false, loadTs: () => ({ ts, reason: null }) }).impact
  })
  after(() => repo.cleanup())

  it('참조 찾기로 사용처를 찾는다고 적는다', () => {
    assert.equal(impact.method, 'typescript')
    assert.equal(impact.reason, null)
  })

  it('시그니처가 바뀐 export의 사용처를 찾고, 이 변경에서 함께 바뀌었는지 표시한다 — 이름만 같은 지역 함수와 import 줄은 뺀다', () => {
    const status = symbolOf(impact, 'getStatus')
    assert.equal(status.change, 'signature')
    assert.equal(status.method, 'typescript')
    assert.deepEqual(where(status.usages), [
      ['src/badge.ts', 2, false],
      ['src/list.ts', 2, true],
    ])
  })

  it('사용처마다 앞뒤 2줄의 문맥을 담는다', () => {
    const [first] = symbolOf(impact, 'getStatus').usages
    assert.match(first.text, /getStatus\(id\) === 'PAID'/)
    assert.equal(first.context.length, 2)
  })

  it('지운 export는 심볼이 없으니 이름으로 찾는다', () => {
    const legacy = symbolOf(impact, 'legacy')
    assert.equal(legacy.change, 'removed')
    assert.equal(legacy.method, 'text')
    assert.deepEqual(where(legacy.usages), [['src/legacy-user.ts', 2, false]])
  })

  it('본문만 바뀐 export도 담고, 사용처가 없으면 빈 목록이다', () => {
    const stable = symbolOf(impact, 'stable')
    assert.equal(stable.change, 'body')
    assert.deepEqual(stable.usages, [])
    assert.equal(stable.total, 0)
  })

  it('바뀌지 않은 export는 빼고, 새 export는 따로 적는다', () => {
    assert.equal(symbolOf(impact, 'LABEL'), undefined)
    assert.deepEqual(impact.added, [{ name: 'fresh', path: 'src/order.ts' }])
  })

  it('바뀐 문자열을 저장소에서 찾는다', () => {
    assert.deepEqual(
      impact.literals.map((l) => [l.value, l.path, where(l.usages)]),
      [['orders/list', 'src/keys.ts', [['src/cache.ts', 1, false]]]],
    )
  })
})

describe('영향 범위 — tsconfig에 없는 파일', () => {
  it('그 파일의 export는 문자열로 찾고, 심볼마다가 아니라 파일 수로 한 번 알린다', () => {
    const repo = makeRepo()
    try {
      const { 'tsconfig.json': _, ...noConfig } = BASE
      repo.write(noConfig)
      repo.commit('feat: 처음')
      repo.git('switch', '-q', '-c', 'feat/x')
      repo.write(CHANGED)
      repo.commit('feat: 바꿈')
      const { impact } = collectContext({ exec: execFor({ dir: repo.dir }), useGh: false, loadTs: () => ({ ts, reason: null }) })
      assert.ok(impact.symbols.every((s) => s.method === 'text'))
      const notes = impact.notes.filter((n) => /tsconfig/.test(n))
      // order.ts(getStatus 등)·keys.ts(ORDERS_KEY 값)·list.ts(list 값) — 바뀐 export가 있는 파일 셋
      assert.equal(notes.length, 1)
      assert.match(notes[0], /파일 3개\(src\/keys\.ts, src\/list\.ts, src\/order\.ts\)/)
    } finally {
      repo.cleanup()
    }
  })
})

describe('영향 범위 — TypeScript가 없을 때', () => {
  it('문자열 검색으로 내려가고 이유를 적는다 — 이름만 같은 지역 함수도 잡힌다(정확도 낮음)', () => {
    const repo = buildRepo()
    try {
      const { impact } = collectContext({ exec: execFor({ dir: repo.dir }), useGh: false, loadTs: () => ({ ts: null, reason: '이 프로젝트에 typescript가 없다' }) })
      assert.equal(impact.method, 'text')
      assert.match(impact.reason, /typescript가 없다/)
      const status = symbolOf(impact, 'getStatus')
      assert.equal(status.method, 'text')
      assert.ok(status.usages.some((u) => u.path === 'src/other.ts'))
    } finally {
      repo.cleanup()
    }
  })
})
