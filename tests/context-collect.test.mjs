import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectContext } from '../skills/gimi-review/scripts/lib/collect.mjs'
import { ContextError } from '../skills/gimi-review/scripts/lib/exec.mjs'
import { execFor, lines, makeRepo } from './helpers/repo.mjs'

/** main: 처음(A) → 수정(B, 3번째 줄) → 서식 정리(C, 8번째 줄). 브랜치: 3번째 줄 삭제·8번째 줄 수정·새 파일(D) */
const buildRepo = ({ ignoreFormatting = false } = {}) => {
  const repo = makeRepo()
  const base = lines(12)
  repo.write({ 'src/order.ts': base })
  const A = repo.commit('feat: 처음')
  repo.write({ 'src/order.ts': base.replace('line3\n', 'line3 fixed\n') })
  const B = repo.commit('fix: iOS 스크롤 복원 (#5)')
  repo.write({ 'src/order.ts': base.replace('line3\n', 'line3 fixed\n').replace('line8\n', 'line8 \n') })
  const C = repo.commit('style: prettier 적용')
  repo.git('switch', '-q', '-c', 'feat/SHOP-9-status')
  repo.write({ 'src/order.ts': base.replace('line3\n', '').replace('line8\n', 'line8 changed\n'), 'src/badge.ts': 'export const badge = 1\n' })
  if (ignoreFormatting) repo.write({ '.git-blame-ignore-revs': `${C}\n` })
  const D = repo.commit('feat: 주문 상태 변경 SHOP-9')
  return { repo, A, B, C, D }
}

const okGh = ({ head, pr = 42 }) => (args) => {
  if (args[0] === 'auth') return ''
  if (args[0] === 'pr' && args[1] === 'view')
    return JSON.stringify({ number: pr, title: '주문 상태 표시', body: 'closes #38', url: `https://github.com/a/b/pull/${pr}`, baseRefName: 'main', headRefOid: head, closingIssuesReferences: [{ number: 38 }] })
  if (args[0] === 'issue' && args[1] === 'view') return JSON.stringify({ number: Number(args[2]), title: '배지 색', body: '빨강으로', url: '' })
  throw new Error(`예상하지 못한 gh 호출: ${args.join(' ')}`)
}

describe('collectContext — gh 없이', () => {
  let built
  let context
  before(() => {
    built = buildRepo()
    context = collectContext({ exec: execFor({ dir: built.repo.dir }) })
  })
  after(() => built.repo.cleanup())

  it('기본 브랜치와의 갈림점부터 HEAD까지를 범위로 잡는다', () => {
    assert.equal(context.scope.baseRef, 'main')
    assert.equal(context.scope.mergeBase, built.C)
    assert.equal(context.scope.commitCount, 1)
    assert.equal(context.scope.branch, 'feat/SHOP-9-status')
  })

  it('바뀐 파일을 담는다', () => {
    assert.deepEqual(
      context.files.map((f) => [f.status, f.newPath]),
      [
        ['added', 'src/badge.ts'],
        ['modified', 'src/order.ts'],
      ],
    )
  })

  it('바꾸거나 지운 줄을 마지막으로 바꾼 커밋과, 그 커밋의 표시를 담는다', () => {
    const order = context.history.files.find((f) => f.path === 'src/order.ts')
    const blamed = new Map(order.blamed.map((b) => [b.sha, b.lines]))
    assert.deepEqual(blamed.get(built.B), [3])
    assert.deepEqual(blamed.get(built.C), [8])
    assert.deepEqual(context.history.commits[built.B].tags, ['fix'])
    assert.deepEqual(context.history.commits[built.B].prRefs, [5])
    assert.equal(context.history.commits[built.C].formatting, true)
  })

  it('파일마다 갈림점 기준 최근 커밋을 담는다', () => {
    const order = context.history.files.find((f) => f.path === 'src/order.ts')
    assert.deepEqual(order.recent, [built.C, built.B, built.A])
  })

  it('브랜치 이름·커밋에서 티켓을 뽑고, gh가 없으면 PR·이슈 본문을 건너뛴다고 적는다', () => {
    assert.deepEqual(context.intent.tickets, [{ id: 'SHOP-9', source: 'unknown' }])
    assert.equal(context.intent.pr, null)
    assert.ok(context.skipped.some((s) => s.context === '의도' && /gh/.test(s.reason)))
  })

  it('영향 범위는 아직 모으지 않는다고 적는다', () => {
    assert.equal(context.impact, null)
    assert.ok(context.skipped.some((s) => s.context === '영향 범위'))
  })
})

describe('collectContext — 서식 정리 커밋 무시 목록', () => {
  it('.git-blame-ignore-revs에 있는 커밋은 건너뛰고 그 전 커밋을 찾는다', () => {
    const built = buildRepo({ ignoreFormatting: true })
    try {
      const context = collectContext({ exec: execFor({ dir: built.repo.dir }) })
      const order = context.history.files.find((f) => f.path === 'src/order.ts')
      const shas = order.blamed.map((b) => b.sha)
      assert.ok(shas.includes(built.A))
      assert.ok(!shas.includes(built.C))
      assert.equal(context.history.ignoreRevs, true)
    } finally {
      built.repo.cleanup()
    }
  })
})

describe('collectContext — gh 있음', () => {
  it('현재 브랜치의 PR과 연결된 이슈 본문을 읽는다', () => {
    const built = buildRepo()
    try {
      const context = collectContext({ exec: execFor({ dir: built.repo.dir, gh: okGh({ head: built.D }) }) })
      assert.equal(context.intent.pr.number, 42)
      assert.equal(context.scope.pr.number, 42)
      assert.deepEqual(context.intent.issues.map((i) => i.number), [38])
      assert.ok(!context.skipped.some((s) => s.context === '의도'))
    } finally {
      built.repo.cleanup()
    }
  })

  it('지정한 PR의 머리 커밋이 HEAD와 다르면 체크아웃을 안내하고 멈춘다', () => {
    const built = buildRepo()
    try {
      assert.throws(() => collectContext({ exec: execFor({ dir: built.repo.dir, gh: okGh({ head: 'f'.repeat(40) }) }), pr: 42 }), (error) => error instanceof ContextError && /gh pr checkout 42/.test(error.message))
    } finally {
      built.repo.cleanup()
    }
  })
})

describe('collectContext — 이력을 볼 수 없거나 기준이 없을 때', () => {
  it('얕은 복제에서는 이력을 건너뛴다고 적는다', () => {
    const built = buildRepo()
    const cloneDir = mkdtempSync(join(tmpdir(), 'gimi-clone-'))
    try {
      execFileSync('git', ['clone', '-q', '--depth', '1', '--branch', 'main', `file://${built.repo.dir}`, cloneDir], { stdio: 'ignore' })
      const clone = makeRepo({ dir: cloneDir, init: false })
      clone.git('switch', '-q', '-c', 'feat/x')
      clone.write({ 'src/order.ts': lines(12).replace('line5\n', 'line5 changed\n') })
      clone.commit('feat: 바꿈')
      const context = collectContext({ exec: execFor({ dir: cloneDir }) })
      assert.equal(context.scope.baseRef, 'origin/main')
      assert.equal(context.history, null)
      assert.ok(context.skipped.some((s) => s.context === '이력' && /얕은 복제/.test(s.reason)))
    } finally {
      built.repo.cleanup()
      rmSync(cloneDir, { recursive: true, force: true })
    }
  })

  it('기본 브랜치를 찾지 못하면 --base를 안내하고 멈춘다', () => {
    const repo = makeRepo({ init: false })
    try {
      repo.git('init', '-q', '-b', 'trunk')
      repo.write({ 'a.txt': 'a\n' })
      repo.commit('feat: a')
      assert.throws(() => collectContext({ exec: execFor({ dir: repo.dir }) }), (error) => error instanceof ContextError && /--base/.test(error.message))
    } finally {
      repo.cleanup()
    }
  })
})
