import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { assetsFor, formatCheck, patchedPaths, runAssets, runCatches, validateDefect, validatePatternAssets } from '../scripts/lib/defects.mjs'

const good = () => ({
  id: 'COM-007',
  rules: ['COM-007'],
  context: '도메인 규칙',
  layer: '백엔드',
  pr: { title: 'feat: 재고 부족을 상품별로 알린다', body: '요구사항 — 재고가 모자라면 어떤 상품인지 알린다' },
  findings: [{ level: '고쳐야 함', summary: '재고를 읽고 앱에서 비교해 저장한다', path: 'server/src/orders/orders.service.ts', line: 60, evidence: [{ path: 'server/db/migrations/001_init.sql', line: 14 }] }],
  catches: ['server/test/orders.test.ts'],
})
const lines = { 'server/src/orders/orders.service.ts': 120, 'server/db/migrations/001_init.sql': 30 }
const base = { 'server/test/orders.test.ts': 80 }
const validate = (json, overrides = {}) =>
  validateDefect({ dir: 'COM-007', json, ruleIds: new Set(['COM-007', 'COM-016', 'KCL-001', 'test/no-assertion']), patchedLines: (p) => lines[p] ?? null, baseLines: (p) => base[p] ?? null, touched: ['server/src/orders/orders.service.ts'], ...overrides })

describe('validateDefect — defect.json 형식', () => {
  it('형식이 맞으면 오류가 없다', () => {
    assert.deepEqual(validate(good()), [])
  })

  it('폴더 이름과 ID, 모르는 규칙, 맥락 종류·층·PR 제목·본문을 본다', () => {
    const json = { ...good(), id: 'COM-008', rules: ['COM-999'], context: '감', layer: 'mobile', pr: { title: '', body: '' } }
    const errors = validate(json)
    for (const pattern of [/폴더 이름/, /COM-999/, /맥락 종류/, /층/, /PR 제목/, /PR 본문/]) assert.ok(errors.some((e) => pattern.test(e)), `${pattern} — ${errors.join(' / ')}`)
  })

  it('정답 위치는 결함 버전에 있는 파일·줄이어야 하고, 단계는 고쳐야 함·고치면 좋음·확인 질문 중 하나다', () => {
    const json = good()
    json.findings = [
      { level: '심각', summary: 'x', path: 'server/src/nope.ts', line: 1 },
      { level: '고쳐야 함', summary: 'x', path: 'server/src/orders/orders.service.ts', line: 121 },
      { level: '확인 질문', summary: '', path: 'server/src/orders/orders.service.ts', line: 3, evidence: [{ path: 'server/db/migrations/001_init.sql', line: 31 }] },
    ]
    const errors = validate(json)
    for (const pattern of [/단계/, /server\/src\/nope\.ts.*없다/, /121.*넘는다/, /설명/, /001_init\.sql.*31/]) assert.ok(errors.some((e) => pattern.test(e)), `${pattern} — ${errors.join(' / ')}`)
  })

  it('정답은 줄 범위(line~endLine)일 수 있다 — endLine은 line 이상이고 파일 안이다', () => {
    const json = good()
    json.findings[0].endLine = 64
    assert.deepEqual(validate(json), [])
    json.findings[0].endLine = 59
    assert.ok(validate(json).some((e) => /endLine/.test(e)))
    json.findings[0].endLine = 121
    assert.ok(validate(json).some((e) => /121.*넘는다/.test(e)))
  })

  it('결함이 없는 PR(clean)만 정답이 비어 있을 수 있고, 잡는 테스트는 정상 버전에 있어야 한다', () => {
    assert.ok(validate({ ...good(), findings: [] }).some((e) => /정답이 없다/.test(e)))
    assert.deepEqual(validate({ ...good(), clean: true, findings: [], catches: [] }), [])
    assert.ok(validate({ ...good(), catches: ['server/test/nope.test.ts'] }).some((e) => /잡는 테스트.*nope/.test(e)))
    assert.ok(validate({ ...good(), clean: true }).some((e) => /결함이 없는 PR.*정답/.test(e)))
  })

  it('잡는 테스트를 패치가 고치면 안 된다 — 결함 버전에서 다른 테스트를 돌리게 된다', () => {
    const errors = validate(good(), { touched: ['server/src/orders/orders.service.ts', 'server/test/orders.test.ts'] })
    assert.ok(errors.some((e) => /server\/test\/orders\.test\.ts.*패치가 고친다/.test(e)), errors.join(' / '))
  })

  it('도메인 규칙·슬롭 결함은 어긴 규칙을 하나 이상 적는다', () => {
    assert.ok(validate({ ...good(), rules: [] }).some((e) => /규칙.*하나 이상/.test(e)))
    assert.deepEqual(validate({ ...good(), rules: [], context: '영향 범위' }), [])
  })
})

describe('validateDefect — 이력(history)', () => {
  it('이력은 예전 커밋 목록이다 — 커밋마다 메시지와 history/ 아래의 패치 파일', () => {
    const json = { ...good(), context: '이력', history: [{ message: 'fix: 새벽에 받은 주문의 반품 기한', patch: 'history/01-kst.patch' }] }
    assert.deepEqual(validate(json), [])
  })

  it('비었거나 목록이 아니면, 메시지·패치가 없거나 패치가 history/ 밖이면 오류다', () => {
    assert.ok(validate({ ...good(), history: [] }).some((e) => /history.*목록/.test(e)))
    assert.ok(validate({ ...good(), history: 'x' }).some((e) => /history.*목록/.test(e)))
    const errors = validate({ ...good(), history: [{ message: '', patch: 'history/a.patch' }, { message: 'fix: x' }, { message: 'fix: y', patch: '../change.patch' }] })
    for (const pattern of [/history 1.*메시지/, /history 2.*패치 파일/, /history 3.*history\//]) assert.ok(errors.some((e) => pattern.test(e)), `${pattern} — ${errors.join(' / ')}`)
  })
})

describe('patchedPaths', () => {
  it('패치가 고치는 파일 — 새 파일·지운 파일·이름 바꿈을 담는다', () => {
    const patch = [
      'diff --git a/server/src/a.ts b/server/src/a.ts',
      'index 1..2 100644',
      '--- a/server/src/a.ts',
      '+++ b/server/src/a.ts',
      '@@ -1 +1 @@',
      '-a',
      '+b',
      'diff --git a/web/src/new.ts b/web/src/new.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/web/src/new.ts',
      '@@ -0,0 +1 @@',
      '+x',
    ].join('\n')
    assert.deepEqual(patchedPaths(patch), ['server/src/a.ts', 'web/src/new.ts'])
  })
})

describe('runCatches — 잡는 테스트가 결함을 잡는지', () => {
  it('정상 버전에서 통과하고 결함 버전에서 실패해야 한다 — 워크스페이스 폴더에서 그 파일만 돌린다', async () => {
    const calls = []
    const run = async ({ cwd, file }) => {
      calls.push([cwd, file])
      return cwd.startsWith('/patched') ? 1 : 0
    }
    const result = await runCatches({ base: '/base', patched: '/patched', catches: ['server/test/orders.test.ts'], run })
    assert.deepEqual(result, [{ path: 'server/test/orders.test.ts', base: 0, patched: 1, ok: true }])
    assert.deepEqual(calls, [
      ['/base/server', 'test/orders.test.ts'],
      ['/patched/server', 'test/orders.test.ts'],
    ])
  })

  it('결함 버전에서도 통과하면(결함을 못 잡으면) ok가 아니다', async () => {
    const result = await runCatches({ base: '/b', patched: '/p', catches: ['web/src/pages/checkout.test.tsx'], run: async () => 0 })
    assert.equal(result[0].ok, false)
    assert.match(result[0].error, /결함 버전에서도 통과한다/)
  })

  it('정상 버전에서 실패하면 결함 버전은 돌리지 않는다 — 앱이나 테스트가 먼저 틀렸다', async () => {
    let calls = 0
    const result = await runCatches({ base: '/b', patched: '/p', catches: ['server/test/orders.test.ts'], run: async () => (calls++, 1) })
    assert.equal(calls, 1)
    assert.deepEqual([result[0].ok, result[0].patched], [false, null])
    assert.match(result[0].error, /정상 버전에서 실패한다/)
  })
})

describe('formatCheck — 보고', () => {
  it('맨 위에 수와 결론, 결함마다 한 줄, 문제는 그 아래에 적는다', () => {
    const text = formatCheck(
      [
        { id: 'COM-007', defect: good(), errors: [], catches: [{ path: 'server/test/orders.test.ts', base: 0, patched: 1, ok: true }] },
        { id: 'KCL-001', defect: { ...good(), id: 'KCL-001', layer: '둘 다' }, errors: ['패치가 정상 버전에 붙지 않는다'], catches: null },
        { id: 'COM-016', defect: null, errors: ['defect.json을 읽지 못했다', '잡는 테스트 web/src/a.test.tsx — 결함 버전에서도 통과한다'], catches: null },
      ],
      { tests: true },
    )
    const lines = text.split('\n')
    assert.equal(lines[0], '결함 PR 3개 — 문제 3개')
    assert.equal(lines[1], '  COM-007  백엔드 · 도메인 규칙 · 정답 1 · 잡는 테스트 1개(정상 통과, 결함 실패)')
    assert.equal(lines[2], '  KCL-001  둘 다 · 도메인 규칙 · 정답 1')
    assert.equal(lines[3], '    ✗ 패치가 정상 버전에 붙지 않는다')
    assert.equal(lines[4], '  COM-016')
    assert.equal(lines.length, 7)
  })

  it('문제가 없으면 그렇게 적고, 잡는 테스트를 돌리지 않았으면 그것도 적는다', () => {
    const text = formatCheck([{ id: 'COM-007', defect: good(), errors: [], catches: null }], { tests: false })
    assert.equal(text, ['결함 PR 1개 — 문제 없음', '  COM-007  백엔드 · 도메인 규칙 · 정답 1', '잡는 테스트와 패턴 예시는 돌리지 않았다(--no-tests)'].join('\n'))
    assert.match(formatCheck([{ id: 'X-001', defect: { ...good(), clean: true, findings: [], catches: [] }, errors: [], catches: [] }], { tests: true }), /X-001 {2}백엔드 · 도메인 규칙 · 결함 없음/)
  })
})

describe('validatePatternAssets — 패턴 예시 검증 설정(evals/patterns/{패턴}.json)', () => {
  const spec = () => ({
    pattern: 'concurrency',
    assets: [
      { file: 'stock-race.test.ts', at: 'server/test/stock-race.test.ts', defect: 'COM-007' },
      { file: 'stock-race.slop.test.ts', at: 'server/test/stock-race.slop.test.ts', defect: 'COM-007' },
    ],
  })
  const check = (json, overrides = {}) =>
    validatePatternAssets({
      file: 'evals/patterns/concurrency.json',
      spec: json,
      assetsOf: (name) => (name === 'concurrency' ? ['stock-race.test.ts', 'stock-race.slop.test.ts'] : null),
      defectIds: new Set(['COM-007']),
      workspaces: ['fake-pg', 'server', 'web'],
      baseHas: (path) => path === 'server/test/orders.test.ts',
      ...overrides,
    })

  it('형식이 맞으면 오류가 없다', () => {
    assert.deepEqual(check(spec()), [])
  })

  it('패턴·예시 파일·결함이 있어야 하고, 두는 곳(at)은 워크스페이스 안의 새 테스트 파일이어야 한다', () => {
    assert.ok(check({ ...spec(), pattern: 'nope' }).some((e) => /nope.*패턴이 없다/.test(e)))
    const json = spec()
    json.assets[0] = { file: 'missing.test.ts', at: 'mobile/test/a.test.ts', defect: 'COM-999' }
    json.assets[1] = { ...json.assets[1], at: 'server/test/orders.test.ts' }
    const errors = check(json)
    for (const pattern of [/missing\.test\.ts.*assets에 없다/, /mobile.*워크스페이스/, /COM-999.*없는 결함/, /orders\.test\.ts.*정상 버전에 이미 있다/]) assert.ok(errors.some((e) => pattern.test(e)), `${pattern} — ${errors.join(' / ')}`)
  })

  it('assets의 테스트 예시는 모두 검증하고, 좋은 예시와 슬롭 예시가 하나 이상씩이다', () => {
    const errors = check({ ...spec(), assets: [spec().assets[0]] })
    assert.ok(errors.some((e) => /stock-race\.slop\.test\.ts.*검증하지 않는다/.test(e)), errors.join(' / '))
    assert.ok(errors.some((e) => /슬롭 예시가 없다/.test(e)), errors.join(' / '))
  })
})

describe('assetsFor — 결함 하나에 돌릴 패턴 예시', () => {
  it('그 결함을 가리키는 예시만, 좋은 예시·슬롭 예시를 파일 이름으로 가른다', () => {
    const specs = [
      { pattern: 'concurrency', assets: [{ file: 'a.test.ts', at: 'server/test/a.test.ts', defect: 'COM-007' }, { file: 'a.slop.test.ts', at: 'server/test/a.slop.test.ts', defect: 'COM-007' }] },
      { pattern: 'api-boundary', assets: [{ file: 'b.test.tsx', at: 'web/src/b.test.tsx', defect: 'COM-016' }] },
    ]
    assert.deepEqual(assetsFor(specs, 'COM-007'), [
      { pattern: 'concurrency', file: 'a.test.ts', at: 'server/test/a.test.ts', kind: 'good' },
      { pattern: 'concurrency', file: 'a.slop.test.ts', at: 'server/test/a.slop.test.ts', kind: 'slop' },
    ])
    assert.deepEqual(assetsFor(specs, 'KCL-001'), [])
  })
})

describe('runAssets — 좋은 예시는 결함을 잡고, 슬롭 예시는 놓친다', () => {
  const assets = [
    { pattern: 'concurrency', file: 'a.test.ts', at: 'server/test/a.test.ts', kind: 'good' },
    { pattern: 'concurrency', file: 'a.slop.test.ts', at: 'server/test/a.slop.test.ts', kind: 'slop' },
  ]

  it('정상 버전에서 타입 검사·둘 다 통과, 결함 버전에서 좋은 예시는 실패·슬롭 예시는 통과해야 한다', async () => {
    const calls = []
    const run = async ({ cwd, file }) => (calls.push([cwd, file]), cwd.startsWith('/patched') && file === 'test/a.test.ts' ? 1 : 0)
    const typecheck = async ({ cwd }) => (calls.push([cwd, 'tsc']), 0)
    const results = await runAssets({ base: '/base', patched: '/patched', assets, run, typecheck })
    assert.deepEqual(results.map((r) => r.ok), [true, true, true])
    assert.deepEqual(calls, [
      ['/base/server', 'tsc'],
      ['/base/server', 'test/a.test.ts'],
      ['/patched/server', 'test/a.test.ts'],
      ['/base/server', 'test/a.slop.test.ts'],
      ['/patched/server', 'test/a.slop.test.ts'],
    ])
  })

  it('좋은 예시가 결함 버전에서 통과하거나 슬롭 예시가 결함 버전에서 실패하면 패턴이 틀린 것이다', async () => {
    const run = async ({ cwd, file }) => (cwd.startsWith('/patched') && file === 'test/a.slop.test.ts' ? 1 : 0)
    const results = await runAssets({ base: '/base', patched: '/patched', assets, run, typecheck: async () => 0 })
    assert.match(results[1].error, /좋은 예시 concurrency\/a\.test\.ts — 결함 버전에서도 통과한다/)
    assert.match(results[2].error, /슬롭 예시 concurrency\/a\.slop\.test\.ts — 결함 버전에서 실패한다/)
  })

  it('정상 버전에서 타입 검사나 예시가 실패하면 알린다', async () => {
    const results = await runAssets({ base: '/base', patched: '/patched', assets: [assets[0]], run: async () => 1, typecheck: async () => 2 })
    assert.match(results[0].error, /server 타입 검사가 정상 버전에서 실패한다/)
    assert.match(results[1].error, /좋은 예시 concurrency\/a\.test\.ts — 정상 버전에서 실패한다/)
    assert.equal(results[1].patched, null)
  })
})

describe('formatCheck — 패턴 예시', () => {
  it('결함 줄에 검증한 예시 수를 적고, 결함에 묶이지 않은 설정 오류는 따로 적는다', () => {
    const text = formatCheck(
      [{ id: 'COM-007', defect: good(), errors: [], catches: [], assets: [{ kind: 'typecheck', ok: true }, { kind: 'good', ok: true }, { kind: 'slop', ok: true }] }],
      { tests: true, setupErrors: ['evals/patterns/x.json: nope — 패턴이 없다'] },
    )
    const lines = text.split('\n')
    assert.equal(lines[0], '결함 PR 1개 — 문제 1개')
    assert.equal(lines[1], '  COM-007  백엔드 · 도메인 규칙 · 정답 1 · 패턴 예시 2개(좋은 예시 결함 실패, 슬롭 예시 결함 통과)')
    assert.equal(lines[2], '  패턴 예시 설정')
    assert.equal(lines[3], '    ✗ evals/patterns/x.json: nope — 패턴이 없다')
  })
})
