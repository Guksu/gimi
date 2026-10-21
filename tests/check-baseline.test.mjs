import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exportTree, linkDependencies, planBaseline, verdictOf } from '../skills/gimi-test/scripts/lib/baseline.mjs'
import { execFor, makeRepo } from './helpers/repo.mjs'

const projectOf = (files) => ({ exists: (path) => path in files, readJson: (path) => JSON.parse(files[path]), readText: (path) => files[path] })
const run = (over) => ({ name: 'test', cwd: '', scope: 'related', command: 'x', status: 'fail', exitCode: 1, durationMs: 10, counts: null, outputTail: [], timeoutMs: 1000, ...over })

describe('planBaseline — 기준에서 다시 돌릴 명령', () => {
  const pkg = JSON.stringify({ devDependencies: { vitest: '3' } })

  it('실패·시간 초과한 명령만 고른다', () => {
    const plans = planBaseline({ runs: [run({ status: 'pass' }), run({ name: 'e2e', scope: 'config', command: 'npm run e2e', status: 'timeout' })], source: 'config', changed: [], config: {}, harness: null, baseProject: projectOf({}) })
    assert.deepEqual(plans.map((p) => [p.index, p.check?.command]), [[1, 'npm run e2e']])
  })

  it('프로젝트 파일로 찾은 관련 테스트는 기준에 있는 파일로 다시 계획한다 — 시간 상한은 그대로', () => {
    const changed = [{ path: 'src/a.ts', status: 'M' }, { path: 'src/new.ts', status: 'A' }]
    const plans = planBaseline({ runs: [run({ command: 'npx vitest related --run src/a.ts src/new.ts' })], source: 'detected', changed, config: {}, harness: null, baseProject: projectOf({ 'package.json': pkg, 'src/a.ts': '' }) })
    assert.equal(plans[0].check.command, 'npx vitest related --run src/a.ts')
    assert.equal(plans[0].check.timeoutMs, 1000)
  })

  it('기준에 그 검사가 볼 파일이 하나도 없으면 다시 돌리지 않고 이 변경에서 생긴 것으로 적는다', () => {
    const plans = planBaseline({ runs: [run({ command: 'npx vitest related --run src/new.ts' })], source: 'detected', changed: [{ path: 'src/new.ts', status: 'A' }], config: {}, harness: null, baseProject: projectOf({ 'package.json': pkg }) })
    assert.equal(plans[0].check, null)
    assert.equal(plans[0].absent, true)
  })
})

describe('verdictOf — 원래 있던 실패인가', () => {
  it('기준에서 통과하면 이 변경에서 생긴 실패다', () => {
    assert.equal(verdictOf({ run: run(), base: run({ status: 'pass' }) }).verdict, 'new')
  })

  it('기준에서도 실패하면 원래 있던 실패일 수 있다 — 실패 수가 늘었으면 늘어난 만큼은 이 변경에서 생겼다', () => {
    const counts = (failed) => ({ passed: 5, failed, skipped: 0, unit: '테스트' })
    assert.equal(verdictOf({ run: run({ counts: counts(2) }), base: run({ counts: counts(2) }) }).verdict, 'preexisting')
    const worse = verdictOf({ run: run({ counts: counts(3) }), base: run({ counts: counts(1) }) })
    assert.equal(worse.verdict, 'worse')
    assert.match(worse.message, /1 → 3/)
  })

  it('기준에 볼 파일이 없으면 새 실패, 기준에서 돌리지 못했으면 알 수 없다', () => {
    assert.equal(verdictOf({ run: run(), absent: true }).verdict, 'new')
    assert.equal(verdictOf({ run: run(), error: 'git archive 실패' }).verdict, 'unknown')
  })
})

describe('exportTree · linkDependencies', () => {
  let repo
  let dir
  let mergeBase
  before(() => {
    repo = makeRepo()
    repo.write({ 'src/a.js': 'base\n', 'packages/web/package.json': '{}', 'package.json': '{}' })
    mergeBase = repo.commit('feat: 처음')
    repo.git('switch', '-q', '-c', 'feat/x')
    repo.write({ 'src/a.js': 'head\n' })
    repo.commit('feat: 바꿈')
    repo.write({ 'src/a.js': 'worktree\n', 'src/new.js': 'new\n', 'node_modules/x/index.js': '', 'packages/web/node_modules/y/index.js': '' })
    dir = mkdtempSync(join(tmpdir(), 'gimi-base-test-'))
    exportTree({ exec: execFor({ dir: repo.dir }), rev: mergeBase, dir })
  })
  after(() => {
    repo.cleanup()
    rmSync(dir, { recursive: true, force: true })
  })

  it('갈림점의 파일만 임시 폴더에 푼다 — 커밋·작업 트리 변경과 새 파일은 없다', () => {
    assert.equal(readFileSync(join(dir, 'src/a.js'), 'utf8'), 'base\n')
    assert.equal(existsSync(join(dir, 'src/new.js')), false)
    assert.equal(existsSync(join(dir, '.git')), false)
  })

  it('저장소 루트와 검사 폴더의 node_modules를 링크한다 — 이미 있으면 두고, 원본이 없으면 넘긴다', () => {
    mkdirSync(join(dir, 'packages/api'), { recursive: true })
    const linked = linkDependencies({ root: repo.dir, dir, cwds: ['', 'packages/web', 'packages/api'] })
    assert.deepEqual(linked, ['node_modules', 'packages/web/node_modules'])
    assert.ok(lstatSync(join(dir, 'node_modules')).isSymbolicLink())
    assert.equal(readlinkSync(join(dir, 'packages/web/node_modules')), join(repo.dir, 'packages/web/node_modules'))
    assert.deepEqual(linkDependencies({ root: repo.dir, dir, cwds: [''] }), [])
  })
})
