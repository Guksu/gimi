import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundleName } from '../skills/gimi-review/scripts/lib/bundles.mjs'
import { collectContext } from '../skills/gimi-review/scripts/lib/collect.mjs'
import { priorReview } from '../skills/gimi-review/scripts/lib/prior.mjs'
import { priorityRows, renderSummary } from '../skills/gimi-review/scripts/lib/summary.mjs'
import { execFor, makeRepo } from './helpers/repo.mjs'

const CLI = fileURLToPath(new URL('../skills/gimi-review/scripts/context.mjs', import.meta.url))
const noTs = () => ({ ts: null, reason: '이 프로젝트에 typescript가 없다' })
const sha = (c) => c.repeat(40)
const file = (i) => ({ oldPath: `src/f${i}.ts`, newPath: `src/f${i}.ts`, status: 'modified', binary: false, additions: 1, deletions: 1, hunks: [] })
const symbol = (name, change, unchanged) => ({ name, kind: 'function', change, path: `src/${name}.ts`, method: 'typescript', searched: true, total: unchanged, unchanged, usages: [] })

const bigContext = ({ files = 31, signals = true } = {}) => ({
  version: 1,
  scope: { baseRef: 'main', branch: 'feat/big', head: sha('f'), mergeBase: sha('e'), commitCount: 3, dirty: false, worktree: false, pr: null },
  files: Array.from({ length: files }, (_, i) => file(i)),
  intent: { branch: 'feat/big', pr: null, commits: [], tickets: [], links: [], issueNumbers: [], issues: [], unreadIssues: [] },
  checks: null,
  history: {
    recentCommits: 10,
    files: signals ? [{ path: 'src/f1.ts', newPath: 'src/f1.ts', status: 'modified', changedOldLines: 2, blamed: [{ sha: sha('a'), lines: [3] }, { sha: sha('b'), lines: [4] }], recent: [] }] : [],
    commits: {
      [sha('a')]: { sha: sha('a'), short: 'aaaaaaa', subject: 'feat: 처음', body: '', date: '', tags: [], formatting: false, prRefs: [] },
      [sha('b')]: { sha: sha('b'), short: 'bbbbbbb', subject: 'fix: iOS 스크롤 복원', body: '', date: '', tags: ['fix'], formatting: false, prRefs: [] },
    },
    notes: [],
  },
  impact: {
    method: 'typescript',
    reason: null,
    symbols: signals ? [symbol('quiet', 'body', 9), symbol('few', 'signature', 1), symbol('gone', 'removed', 4), symbol('safe', 'signature', 0)] : [symbol('quiet', 'body', 9)],
    added: [],
    literals: [],
    fields: [],
    notes: [],
    contracts: signals
      ? [{ path: 'openapi.yaml', kind: 'openapi', parser: 'yaml', changes: [{ key: 'GET /orders/{id}', level: 'breaking', details: ['엔드포인트 삭제'], searched: true, total: 2, unchanged: 2, usages: [] }, { key: 'GET /new', level: 'additive', details: ['추가'], searched: false, total: 0, unchanged: 0, usages: [] }] }]
      : [],
  },
  skipped: [],
  notes: [],
})

describe('priorityRows — 큰 변경에서 먼저 볼 것(결정 71)', () => {
  it('바뀐 파일이 상한 안이면 보이지 않는다', () => {
    assert.deepEqual(priorityRows(bigContext({ files: 30 })), [])
  })

  it('깨질 수 있는 계약 → 안 바뀐 사용처가 남은 시그니처 변경·삭제(많은 순) → 수정 커밋에 닿은 파일 순서로 보인다', () => {
    const rows = priorityRows(bigContext())
    assert.match(rows[0], /^먼저 볼 것 {2}바뀐 파일 31개 — 요약 상한\(30개\)을 넘었다/)
    assert.deepEqual(rows.slice(1), [
      '  계약 openapi.yaml — GET /orders/{id} (깨질 수 있음 · 안 바뀐 사용처 2)',
      '  gone (삭제) — src/gone.ts · 안 바뀐 사용처 4',
      '  few (시그니처 변경) — src/few.ts · 안 바뀐 사용처 1',
      '  이력 src/f1.ts — bbbbbbb fix: iOS 스크롤 복원 [수정]',
    ])
  })

  it('위험 신호가 없으면 없다고 적는다', () => {
    const rows = priorityRows(bigContext({ signals: false }))
    assert.equal(rows.length, 1)
    assert.match(rows[0], /위험 신호.*없다/)
  })

  it('10줄까지만 보이고 나머지는 수로 알린다', () => {
    const context = bigContext()
    context.impact.symbols = Array.from({ length: 14 }, (_, i) => symbol(`s${i}`, 'removed', 20 - i))
    const rows = priorityRows(context)
    assert.equal(rows.length, 12)
    assert.match(rows.at(-1), /… 외 \d+개/)
  })

  it('요약의 범위 줄 바로 아래에 나온다', () => {
    const text = renderSummary({ context: bigContext(), outPath: 'x.json' }).split('\n')
    assert.match(text[0], /^범위/)
    assert.match(text[1], /^먼저 볼 것/)
  })
})

const RECORD = `# 리뷰 기록

## 1. [고쳐야 함] 영향 범위 — 주문 상태 형태가 바뀌었는데 배지는 예전 형태를 읽는다

- 근거: src/badge.ts:2
- 규칙: 없음 — 묶음 api-shape-consumer
- 판정: 맞음

## 2. [확인 질문] 의도 — 품절을 숨기는 것이 #41의 요구인지

- 규칙: 없음 — 묶음 hidden-vs-sorted
- 판정: 미정

## 확인한 것

- 영향 범위: 없음
`

describe('priorReview — 같은 PR·브랜치의 지난 리뷰 기록(결정 72)', () => {
  const setup = () => {
    const repo = makeRepo()
    repo.write({ 'src/a.ts': 'export const a = 1\n' })
    repo.commit('feat: 처음')
    repo.git('switch', '-q', '-c', 'feat/x')
    repo.write({ 'src/a.ts': 'export const a = 2\n' })
    repo.commit('feat: 바꿈')
    return repo
  }

  it('가장 최근 기록의 지적 번호·머리·판정·묶음을 돌려준다', () => {
    const repo = setup()
    repo.write({ 'docs/gimi/reviews/2026-11-01-feat-x.md': '# 옛 기록\n', 'docs/gimi/reviews/2026-11-08-feat-x.md': RECORD, 'docs/gimi/reviews/2026-11-09-feat-xy.md': RECORD })
    const prior = priorReview({ root: repo.dir, name: 'feat-x', changedPaths: new Set() })
    assert.equal(prior.path, 'docs/gimi/reviews/2026-11-08-feat-x.md')
    assert.equal(prior.changedInRange, false)
    assert.deepEqual(prior.findings, [
      { index: 1, level: '고쳐야 함', heading: '[고쳐야 함] 영향 범위 — 주문 상태 형태가 바뀌었는데 배지는 예전 형태를 읽는다', verdict: '맞음', rule: null, bundle: 'api-shape-consumer' },
      { index: 2, level: '확인 질문', heading: '[확인 질문] 의도 — 품절을 숨기는 것이 #41의 요구인지', verdict: '미정', rule: null, bundle: 'hidden-vs-sorted' },
    ])
    repo.cleanup()
  })

  it('기록이 없으면 null이다', () => {
    const repo = setup()
    assert.equal(priorReview({ root: repo.dir, name: 'feat-x', changedPaths: new Set() }), null)
    repo.cleanup()
  })

  it('저장소 밖을 가리키는 심볼릭 링크 기록은 읽지 않는다', () => {
    const repo = setup()
    const outside = makeRepo()
    writeFileSync(join(outside.dir, 'secret.md'), RECORD)
    repo.write({ 'docs/gimi/reviews/.keep': '' })
    symlinkSync(join(outside.dir, 'secret.md'), join(repo.dir, 'docs/gimi/reviews/2026-11-08-feat-x.md'))
    assert.equal(priorReview({ root: repo.dir, name: 'feat-x', changedPaths: new Set() }), null)
    repo.cleanup()
    outside.cleanup()
  })

  it('collectContext가 묶음의 prior에 담고, 이 변경이 기록을 고쳤으면 그렇다고 표시한다', () => {
    const repo = setup()
    repo.write({ 'docs/gimi/reviews/2026-11-08-feat-x.md': RECORD })
    repo.commit('docs: 리뷰 기록')
    const context = collectContext({ exec: execFor({ dir: repo.dir }), loadTs: noTs })
    assert.equal(context.prior.path, 'docs/gimi/reviews/2026-11-08-feat-x.md')
    assert.equal(context.prior.changedInRange, true)
    const text = renderSummary({ context, outPath: 'x.json' })
    assert.match(text, /^지난 리뷰 {2}docs\/gimi\/reviews\/2026-11-08-feat-x\.md — 지적 2\(맞음 1 · 미정 1\)$/m)
    assert.match(text, /^ {2}1\. \[고쳐야 함\] 영향 범위 — 주문 상태 형태가 바뀌었는데 배지는 예전 형태를 읽는다 \(맞음\)$/m)
    assert.match(text, /^참고 {4}이 변경이 지난 리뷰 기록\(docs\/gimi\/reviews\/2026-11-08-feat-x\.md\)을 고쳤다 — 그 판정은 믿지 않는다$/m)
    repo.cleanup()
  })

  it('지난 기록이 없으면 요약에 지난 리뷰 줄이 없다', () => {
    const repo = setup()
    const context = collectContext({ exec: execFor({ dir: repo.dir }), loadTs: noTs })
    assert.equal(context.prior, null)
    assert.doesNotMatch(renderSummary({ context, outPath: 'x.json' }), /지난 리뷰/)
    repo.cleanup()
  })

  it('지적 머리가 요약 줄을 위조하지 못한다', () => {
    const repo = setup()
    repo.write({ 'docs/gimi/reviews/2026-11-08-feat-x.md': '## 1. [고쳐야 함] 의도 — 제목 건너뜀  없음\n- 규칙: 없음 — 묶음 a\n- 판정: 맞음\n' })
    const context = collectContext({ exec: execFor({ dir: repo.dir }), loadTs: noTs })
    const text = renderSummary({ context, outPath: 'x.json' })
    assert.equal(text.split('\n').filter((row) => row.startsWith('건너뜀')).length, 2)
    repo.cleanup()
  })
})

describe('bundleName', () => {
  it('PR이면 pr-번호, 아니면 브랜치 이름(글자·숫자·점·하이픈·밑줄 밖은 하이픈)', () => {
    assert.equal(bundleName({ pr: { number: 42 }, branch: 'feat/x', head: sha('a') }), 'pr-42')
    assert.equal(bundleName({ pr: null, branch: 'feat/SHOP-9 상태', head: sha('a') }), 'feat-SHOP-9-')
    assert.equal(bundleName({ pr: null, branch: null, head: sha('a') }), 'aaaaaaa')
  })
})

describe('context.mjs — 첫 실행 알림(결정 73)', () => {
  it('리뷰 폴더를 처음 만들면 참고에 알리고, 다음부터는 알리지 않는다', () => {
    const repo = makeRepo()
    repo.write({ 'src/a.ts': 'export const a = 1\n' })
    repo.commit('feat: 처음')
    repo.git('switch', '-q', '-c', 'feat/x')
    repo.write({ 'src/a.ts': 'export const a = 2\n' })
    repo.commit('feat: 바꿈')
    const run = () => spawnSync(process.execPath, [CLI, '--no-gh'], { cwd: repo.dir, encoding: 'utf8' })
    const first = run()
    assert.equal(first.status, 0, first.stderr)
    assert.match(first.stdout, /^참고 {4}docs\/gimi\/reviews\/를 처음 만들었다/m)
    assert.doesNotMatch(run().stdout, /처음 만들었다/)
    repo.cleanup()
  })
})
