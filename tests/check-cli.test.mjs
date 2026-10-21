import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeRepo } from './helpers/repo.mjs'

const CLI = fileURLToPath(new URL('../skills/gimi-test/scripts/check.mjs', import.meta.url))
const run = ({ cwd, args = [], env = {} }) => {
  const { GIMI_CHECK_RUNNING: _, ...rest } = process.env
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env: { ...rest, ...env } })
}
const node = (code) => `node -e ${JSON.stringify(code)}`
const withCommands = (repo, commands) => repo.write({ '.agents/gimi.json': JSON.stringify({ finishCheck: { enabled: true, commands } }) })

describe('check.mjs', () => {
  let repo
  before(() => {
    repo = makeRepo()
    repo.write({ 'src/a.js': 'export const a = 1\n' })
    repo.commit('feat: 처음')
    repo.git('switch', '-q', '-c', 'feat/x')
    // 끝내기 직전 — 아직 커밋하지 않았다
    repo.write({ 'src/a.js': 'export const a = 2\n' })
  })
  after(() => repo.cleanup())

  it('설정의 명령을 돌리고 통과하면 종료 코드 0, 명령·결과 수를 보고한다', () => {
    withCommands(repo, [{ name: 'test', command: node("console.log('# pass 2'); console.log('# fail 0')") }])
    const result = run({ cwd: repo.dir })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /^끝내기 전 검사 {2}바뀐 파일 2개/m)
    assert.match(result.stdout, /^통과 {6}test\(설정대로\) {2}node -e .*통과 2 · 실패 0/m)
    assert.match(result.stdout, /^결과 {6}통과 1 · 실패 0 · 시간 초과 0 · 건너뜀 0$/m)
  })

  it('명령이 실패하면 종료 코드 1이다', () => {
    withCommands(repo, [{ name: 'test', command: node("console.error('expected 1, got 2'); process.exit(1)") }])
    const result = run({ cwd: repo.dir })
    assert.equal(result.status, 1)
    assert.match(result.stdout, /^실패 {6}test/m)
    assert.match(result.stdout, /expected 1, got 2/)
  })

  it('--dry-run은 돌릴 명령만 보이고 실제로 돌리지 않는다', () => {
    withCommands(repo, [{ name: 'test', command: node("require('fs').writeFileSync('ran', '')") }])
    const result = run({ cwd: repo.dir, args: ['--dry-run'] })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /^돌릴 명령 {2}test\(설정대로\) {2}node -e/m)
    assert.equal(existsSync(join(repo.dir, 'ran')), false)
  })

  it('--json이면 JSON만 낸다', () => {
    withCommands(repo, [{ name: 'test', command: node('process.exit(0)') }])
    const result = run({ cwd: repo.dir, args: ['--json'] })
    assert.equal(result.status, 0, result.stderr)
    const report = JSON.parse(result.stdout)
    assert.equal(report.source, 'config')
    assert.equal(report.runs[0].status, 'pass')
  })

  it('check.mjs가 검사 명령 안에서 다시 불리면 종료 코드 2로 멈춘다', () => {
    const result = run({ cwd: repo.dir, env: { GIMI_CHECK_RUNNING: '1' } })
    assert.equal(result.status, 2)
    assert.match(result.stderr, /다시 불렸다/)
  })

  it('git 저장소가 아니면 종료 코드 2로 끝낸다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gimi-norepo-'))
    try {
      const result = run({ cwd: dir })
      assert.equal(result.status, 2)
      assert.match(result.stderr, /git 저장소/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('설정이 없으면 package.json으로 명령을 찾고, 찾지 못한 검사는 이유와 함께 건너뛴다', () => {
    const fresh = makeRepo()
    try {
      fresh.write({ 'package.json': JSON.stringify({ scripts: { test: node("console.log('# pass 1')") } }), 'src/a.js': 'export const a = 1\n' })
      fresh.commit('feat: 처음')
      fresh.git('switch', '-q', '-c', 'feat/y')
      fresh.write({ 'src/a.js': 'export const a = 2\n' })
      const result = run({ cwd: fresh.dir })
      assert.equal(result.status, 0, result.stdout + result.stderr)
      assert.match(result.stdout, /^명령 출처 {2}프로젝트 파일 감지$/m)
      assert.match(result.stdout, /^통과 {6}test\(전체\) {2}npm test/m)
      assert.match(result.stdout, /^건너뜀 {4}typecheck — TypeScript 설정/m)
      assert.match(result.stdout, /^건너뜀 {4}lint — lint 스크립트가 없다$/m)
    } finally {
      fresh.cleanup()
    }
  })

  it('모르는 옵션이면 사용법을 보이고 종료 코드 2로 끝낸다', () => {
    const result = run({ cwd: repo.dir, args: ['--what'] })
    assert.equal(result.status, 2)
    assert.match(result.stderr, /사용/)
  })
})
