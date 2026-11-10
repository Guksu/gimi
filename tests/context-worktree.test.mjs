import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectContext } from '../skills/gimi-review/scripts/lib/collect.mjs'
import { renderSummary } from '../skills/gimi-review/scripts/lib/summary.mjs'
import { readAfter, untrackedFiles } from '../skills/gimi-review/scripts/lib/worktree.mjs'
import { execFor, makeRepo } from './helpers/repo.mjs'

const CLI = fileURLToPath(new URL('../skills/gimi-review/scripts/context.mjs', import.meta.url))
const noTs = () => ({ ts: null, reason: '이 프로젝트에 typescript가 없다' })

/**
 * main: price.ts(export price)와 그것을 쓰는 cart.ts.
 * 브랜치 feat/x: 커밋 1개(note.ts 추가) + 커밋하지 않은 변경 — price.ts 시그니처(스테이지 안 함), cart 옆 tax.ts(스테이지함), 새 파일 coupon.ts(추적 안 함)
 */
const buildRepo = () => {
  const repo = makeRepo()
  repo.write({
    '.gitignore': 'dist/\n',
    'src/price.ts': 'export const price = (amount: number) => amount\n',
    'src/cart.ts': "import { price } from './price'\nexport const total = price(1000)\n",
    'src/tax.ts': 'export const tax = 10\n',
  })
  repo.commit('feat: 처음')
  repo.git('switch', '-q', '-c', 'feat/x')
  repo.write({ 'src/note.ts': 'export const note = 1\n' })
  repo.commit('feat: 메모')
  repo.write({
    'src/price.ts': 'export const price = (amount: number, rate: number) => amount * rate\n',
    'src/tax.ts': 'export const tax = 11\n',
    'src/coupon.ts': 'export const coupon = 1\nexport const limit = 2\n',
    'dist/out.js': 'ignored\n',
  })
  repo.git('add', 'src/tax.ts')
  return repo
}

const pathsOf = (context) => context.files.map((file) => file.newPath ?? file.oldPath).sort()

describe('untrackedFiles', () => {
  let repo
  before(() => {
    repo = buildRepo()
  })
  after(() => repo.cleanup())

  it('.gitignore에 걸리지 않는 새 파일을 더한 파일로 돌려준다', () => {
    const { files } = untrackedFiles({ exec: execFor({ dir: repo.dir }), root: repo.dir })
    assert.deepEqual(files.map((file) => file.newPath), ['src/coupon.ts'])
    const [file] = files
    assert.equal(file.status, 'added')
    assert.equal(file.oldPath, null)
    assert.equal(file.untracked, true)
    assert.equal(file.additions, 2)
    assert.deepEqual(file.hunks[0].added, [{ line: 1, text: 'export const coupon = 1' }, { line: 2, text: 'export const limit = 2' }])
  })

  it('gimi가 쓴 리뷰 폴더는 넣지 않는다', () => {
    repo.write({ 'docs/gimi/reviews/2026-11-10-feat-x.context.json': '{}\n', 'docs/gimi/reviews/2026-11-10-feat-x.md': '# 리뷰\n' })
    const { files } = untrackedFiles({ exec: execFor({ dir: repo.dir }), root: repo.dir })
    assert.deepEqual(files.map((file) => file.newPath), ['src/coupon.ts'])
  })

  it('심볼릭 링크는 읽지 않고 알린다', () => {
    symlinkSync('/etc/hosts', join(repo.dir, 'src/hosts.ts'))
    const { files, notes } = untrackedFiles({ exec: execFor({ dir: repo.dir }), root: repo.dir })
    assert.ok(!files.some((file) => file.newPath === 'src/hosts.ts'))
    assert.ok(notes.some((note) => note.includes('src/hosts.ts')), notes.join('\n'))
    repo.remove('src/hosts.ts')
  })

  it('바이너리 파일은 줄 없이 바이너리로 담는다', () => {
    writeFileSync(join(repo.dir, 'logo.bin'), Buffer.from([1, 0, 2, 0]))
    const { files } = untrackedFiles({ exec: execFor({ dir: repo.dir }), root: repo.dir })
    const binary = files.find((file) => file.newPath === 'logo.bin')
    assert.equal(binary.binary, true)
    assert.deepEqual(binary.hunks, [])
    repo.remove('logo.bin')
  })
})

describe('readAfter', () => {
  let repo
  before(() => {
    repo = buildRepo()
  })
  after(() => repo.cleanup())

  it('worktree면 작업 트리에서, 아니면 HEAD에서 읽는다', () => {
    const exec = execFor({ dir: repo.dir })
    assert.match(readAfter({ exec, root: repo.dir, scope: { worktree: true }, path: 'src/price.ts' }), /rate/)
    assert.doesNotMatch(readAfter({ exec, root: repo.dir, scope: { worktree: false }, path: 'src/price.ts' }), /rate/)
    assert.equal(readAfter({ exec, root: repo.dir, scope: { worktree: false }, path: 'src/coupon.ts' }), null)
  })
})

describe('collectContext — 커밋하지 않은 변경', () => {
  let repo
  before(() => {
    repo = buildRepo()
  })
  after(() => repo.cleanup())

  it('옵션이 없으면 HEAD까지만 보고 옵션을 알린다', () => {
    const context = collectContext({ exec: execFor({ dir: repo.dir }), loadTs: noTs })
    assert.deepEqual(pathsOf(context), ['src/note.ts'])
    assert.equal(context.scope.worktree, false)
    assert.ok(context.notes.some((note) => note.includes('커밋하지 않은 변경') && note.includes('--worktree')), context.notes.join('\n'))
  })

  it('worktree면 커밋한 변경에 스테이지한 것·안 한 것·새 파일을 더한다', () => {
    const context = collectContext({ exec: execFor({ dir: repo.dir }), loadTs: noTs, worktree: true })
    assert.deepEqual(pathsOf(context), ['src/coupon.ts', 'src/note.ts', 'src/price.ts', 'src/tax.ts'])
    assert.equal(context.scope.worktree, true)
    assert.equal(context.scope.commitCount, 1)
    assert.equal(context.files.find((file) => file.newPath === 'src/coupon.ts').untracked, true)
    assert.ok(!context.notes.some((note) => note.includes('맥락에 넣지 않았다')))
  })

  it('커밋하지 않은 시그니처 변경의 안 바뀐 사용처를 찾는다', () => {
    const context = collectContext({ exec: execFor({ dir: repo.dir }), loadTs: noTs, worktree: true })
    const price = context.impact.symbols.find((symbol) => symbol.name === 'price')
    assert.ok(price, JSON.stringify(context.impact.symbols.map((s) => s.name)))
    assert.ok(price.usages.some((usage) => usage.path === 'src/cart.ts' && !usage.changedInPr))
    assert.ok(context.impact.added.some((entry) => entry.name === 'coupon' && entry.path === 'src/coupon.ts'))
  })

  it('--base HEAD면 커밋하지 않은 것만 본다', () => {
    const context = collectContext({ exec: execFor({ dir: repo.dir }), loadTs: noTs, worktree: true, base: 'HEAD' })
    assert.deepEqual(pathsOf(context), ['src/coupon.ts', 'src/price.ts', 'src/tax.ts'])
    assert.equal(context.scope.commitCount, 0)
  })

  it('작업 트리가 깨끗하면 그렇다고 알린다', () => {
    const clean = makeRepo()
    clean.write({ 'a.ts': 'export const a = 1\n' })
    clean.commit('feat: 처음')
    clean.git('switch', '-q', '-c', 'feat/y')
    clean.write({ 'a.ts': 'export const a = 2\n' })
    clean.commit('feat: 바꿈')
    const context = collectContext({ exec: execFor({ dir: clean.dir }), loadTs: noTs, worktree: true })
    assert.deepEqual(pathsOf(context), ['a.ts'])
    assert.ok(context.notes.some((note) => note.includes('커밋하지 않은 변경이 없다')), context.notes.join('\n'))
    clean.cleanup()
  })

  it('리뷰 폴더의 파일만 남아 있으면 커밋하지 않은 변경으로 보지 않는다', () => {
    const clean = makeRepo()
    clean.write({ 'a.ts': 'export const a = 1\n' })
    clean.commit('feat: 처음')
    clean.write({ 'docs/gimi/reviews/2026-11-10-main.context.json': '{}\n' })
    const context = collectContext({ exec: execFor({ dir: clean.dir }), loadTs: noTs, base: 'HEAD' })
    assert.equal(context.scope.dirty, false)
    clean.cleanup()
  })

  it('현재 브랜치에 PR이 있으면 CI가 푸시한 커밋의 결과라고 알린다', () => {
    const head = repo.git('rev-parse', 'HEAD').trim()
    const gh = (args) => {
      if (args[0] === 'auth') return ''
      if (args[0] === 'pr' && args[1] === 'view') return JSON.stringify({ number: 7, title: 't', body: '', url: '', baseRefName: 'main', headRefOid: head, closingIssuesReferences: [] })
      if (args[0] === 'pr' && args[1] === 'checks') return '[]'
      throw new Error(`예상하지 못한 gh 호출: ${args.join(' ')}`)
    }
    const context = collectContext({ exec: execFor({ dir: repo.dir, gh }), loadTs: noTs, worktree: true })
    assert.ok(context.notes.some((note) => note.includes('CI') && note.includes('푸시한 커밋')), context.notes.join('\n'))
  })
})

describe('renderSummary — 커밋하지 않은 변경', () => {
  it('범위 줄에 커밋하지 않은 변경을, 새 파일 줄에 표시를 보인다', () => {
    const repo = buildRepo()
    const context = collectContext({ exec: execFor({ dir: repo.dir }), loadTs: noTs, worktree: true })
    const text = renderSummary({ context, outPath: 'x.json' })
    assert.match(text, /^범위 {4}main\.\.\.feat\/x \(갈림점 [0-9a-f]{7}, 커밋 1 \+ 커밋하지 않은 변경, 파일 4\)$/m)
    assert.match(text, /^ {2}A src\/coupon\.ts {2}\+2 −0 {2}\(추적하지 않는 새 파일\)$/m)
    repo.cleanup()
  })
})

describe('context.mjs --worktree', () => {
  let repo
  before(() => {
    repo = buildRepo()
  })
  after(() => repo.cleanup())
  const run = (args) => spawnSync(process.execPath, [CLI, ...args], { cwd: repo.dir, encoding: 'utf8' })

  it('커밋하지 않은 변경을 요약에 넣는다', () => {
    const result = run(['--no-gh', '--json', '--worktree'])
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(pathsOf(JSON.parse(result.stdout)), ['src/coupon.ts', 'src/note.ts', 'src/price.ts', 'src/tax.ts'])
  })

  it('--pr와 함께 쓰면 멈춘다', () => {
    const result = run(['--pr', '3', '--worktree'])
    assert.equal(result.status, 2)
    assert.match(result.stderr, /--pr와 --worktree는 함께 쓰지 않는다/)
  })
})
