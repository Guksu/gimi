import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { collectChanges, collectLineChanges } from '../skills/gimi-test/scripts/lib/changes.mjs'
import { execFor, lines, makeRepo } from './helpers/repo.mjs'

describe('collectLineChanges', () => {
  let repo
  let byPath
  before(() => {
    repo = makeRepo()
    repo.write({ 'src/a.ts': lines(10), 'src/b.ts': lines(3), 'src/gone.ts': 'x\n' })
    repo.commit('feat: 처음')
    repo.git('switch', '-q', '-c', 'feat/x')
    repo.write({ 'src/a.ts': lines(10).replace('line2\n', 'changed2\n') })
    repo.commit('feat: a 2번째 줄')
    // 커밋하지 않은 변경 — 작업 트리의 줄 번호로 본다
    repo.write({ 'src/a.ts': lines(10).replace('line2\n', 'changed2\n').replace('line9\n', 'changed9\nadded\n'), 'src/new.ts': 'n1\nn2\n', 'src/staged.ts': 's1\n' })
    repo.git('add', 'src/staged.ts')
    repo.remove('src/gone.ts')
    const exec = execFor({ dir: repo.dir })
    const changes = collectChanges({ exec })
    byPath = collectLineChanges({ exec, mergeBase: changes.mergeBase, files: changes.files })
  })
  after(() => repo.cleanup())

  it('갈림점부터 작업 트리까지 더하거나 바꾼 줄 번호를 모은다 — 커밋한 것과 커밋하지 않은 것을 합친다', () => {
    assert.deepEqual([...byPath.get('src/a.ts').added].sort((x, y) => x - y), [2, 9, 10])
    assert.equal(byPath.get('src/a.ts').all, false)
  })

  it('지운 줄과 더한 줄을 덩어리째 담는다 — 같은 덩어리 안의 기대값 바꿈을 찾는 데 쓴다', () => {
    const hunk = byPath.get('src/a.ts').hunks.find((h) => h.newStart === 9)
    assert.deepEqual(hunk.removed.map((l) => l.text), ['line9'])
    assert.deepEqual(hunk.added.map((l) => l.text), ['changed9', 'added'])
  })

  it('추적하지 않는 새 파일은 모든 줄이 바뀐 줄이다. 스테이지한 새 파일은 diff로 본다', () => {
    assert.equal(byPath.get('src/new.ts').all, true)
    assert.deepEqual([...byPath.get('src/staged.ts').added], [1])
  })

  it('바뀌지 않은 파일과 지운 파일은 담지 않는다', () => {
    assert.equal(byPath.has('src/b.ts'), false)
    assert.equal(byPath.has('src/gone.ts'), false)
  })
})
