import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { collectChanges, parseNameStatus } from '../skills/gimi-test/scripts/lib/changes.mjs'
import { ContextError } from '../skills/gimi-test/scripts/lib/exec.mjs'
import { execFor, makeRepo } from './helpers/repo.mjs'

describe('parseNameStatus', () => {
  it('git diff --name-status -z 출력을 읽는다 — 이름 바꿈은 옛 경로도 담는다', () => {
    const text = 'M\0src/a.ts\0A\0src/new.ts\0D\0src/gone.ts\0R087\0src/old.ts\0src/renamed.ts\0'
    assert.deepEqual(parseNameStatus(text), [
      { status: 'M', path: 'src/a.ts', oldPath: null },
      { status: 'A', path: 'src/new.ts', oldPath: null },
      { status: 'D', path: 'src/gone.ts', oldPath: null },
      { status: 'R', path: 'src/renamed.ts', oldPath: 'src/old.ts' },
    ])
  })

  it('빈 출력은 빈 목록이다', () => {
    assert.deepEqual(parseNameStatus(''), [])
  })
})

describe('collectChanges', () => {
  let repo
  let changes
  before(() => {
    repo = makeRepo()
    repo.write({ 'src/a.ts': 'a\n', 'src/b.ts': 'b\n', 'src/c.ts': 'c\n', 'src/e.ts': 'e\n' })
    repo.commit('feat: 처음')
    repo.git('switch', '-q', '-c', 'feat/x')
    repo.write({ 'src/a.ts': 'a1\n' })
    repo.commit('feat: a 바꿈')
    // 끝내기 직전 — 커밋하지 않은 변경이 섞여 있다
    repo.write({ 'src/a.ts': 'a2\n', 'src/b.ts': 'b1\n', 'src/c.ts': 'c1\n', 'src/d.ts': 'd\n' })
    repo.git('add', 'src/c.ts')
    repo.remove('src/e.ts')
    changes = collectChanges({ exec: execFor({ dir: repo.dir }) })
  })
  after(() => repo.cleanup())

  it('기본 브랜치와의 갈림점을 기준으로 잡는다', () => {
    assert.equal(changes.baseRef, 'main')
    assert.equal(changes.branch, 'feat/x')
  })

  it('커밋한 변경·작업 트리 변경(스테이지 여부와 상관없이)·새 파일·지운 파일을 모두 담고 출처를 적는다', () => {
    assert.deepEqual(
      changes.files.map((f) => [f.path, f.status, f.sources]),
      [
        ['src/a.ts', 'M', ['commit', 'worktree']],
        ['src/b.ts', 'M', ['worktree']],
        ['src/c.ts', 'M', ['worktree']],
        ['src/d.ts', 'A', ['untracked']],
        ['src/e.ts', 'D', ['worktree']],
      ],
    )
  })

  it('없는 기준이면 --base를 안내하고 멈춘다', () => {
    assert.throws(() => collectChanges({ exec: execFor({ dir: repo.dir }), base: 'nope' }), (error) => error instanceof ContextError && /nope/.test(error.message))
  })
})
