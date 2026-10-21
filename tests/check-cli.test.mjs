import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
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

describe('check.mjs — 슬롭 검사', () => {
  let repo
  before(() => {
    repo = makeRepo()
    repo.write({ 'src/cart.js': 'export const total = (items) => items.length\n', 'src/cart.test.js': "it('a', () => {\n  expect(total([])).toBe(0)\n})\n" })
    repo.commit('feat: 처음')
    repo.git('switch', '-q', '-c', 'feat/x')
    withCommands(repo, [{ name: 'test', command: node('process.exit(0)') }])
    repo.commit('chore: 설정')
  })
  after(() => repo.cleanup())

  it('바뀐 줄의 슬롭 error가 있으면 명령이 통과해도 종료 코드 1이다 — 바뀌지 않은 줄은 보지 않는다', () => {
    repo.write({ 'src/cart.test.js': "it('a', () => {\n  expect(total([])).toBe(0)\n})\nit.only('b', () => {\n  expect(total([1])).toBe(1)\n})\n" })
    const result = run({ cwd: repo.dir })
    assert.equal(result.status, 1, result.stdout)
    assert.match(result.stdout, /^통과 {6}test/m)
    assert.match(result.stdout, /^슬롭 검사 {2}바뀐 파일 1개\(테스트 1\) — error 1 · warn 0 · 무시 0$/m)
    assert.match(result.stdout, /^error {5}test\/only-left {2}src\/cart\.test\.js:4 {2}/m)
  })

  it('warn만 있으면 종료 코드 0이다. 새 파일은 모든 줄을 본다', () => {
    repo.write({ 'src/cart.test.js': "it('a', () => {\n  expect(total([])).toBe(0)\n})\n", 'src/pay.js': 'export const pay = (order) => {\n  console.log(order)\n}\n' })
    const result = run({ cwd: repo.dir })
    assert.equal(result.status, 0, result.stdout)
    assert.match(result.stdout, /^warn {6}code\/debug-leftover {2}src\/pay\.js:2 {2}console\.log/m)
  })

  it('--json에 슬롭 지적·무시·본 파일 수를 담는다', () => {
    repo.write({ 'src/pay.js': 'export const pay = (order) => {\n  // gimi-ignore: code/debug-leftover — 결제 추적 로그(#7)\n  console.log(order)\n  debugger\n}\n' })
    const result = run({ cwd: repo.dir, args: ['--json'] })
    assert.equal(result.status, 1, result.stdout)
    const { slop } = JSON.parse(result.stdout)
    assert.deepEqual(slop.checked, { test: 0, code: 1, snapshot: 0 })
    assert.deepEqual(slop.findings.map((f) => [f.id, f.severity, f.line]), [['code/debug-leftover', 'error', 4]])
    assert.deepEqual(slop.ignored.map((f) => [f.id, f.reason]), [['code/debug-leftover', '결제 추적 로그(#7)']])
  })

  it('--dry-run은 슬롭 검사로 볼 파일 수를 보인다', () => {
    const result = run({ cwd: repo.dir, args: ['--dry-run'] })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /^슬롭 검사 {2}바뀐 파일 1개\(코드 1\)의 바뀐 줄을 본다$/m)
  })
})

describe('check.mjs --baseline', () => {
  // src/a.js의 값이 2면 실패하는 검사 — 기준(갈림점)에서는 1이라 통과한다
  const failsOnTwo = node("process.exit(require('fs').readFileSync('src/a.js', 'utf8').includes('2') ? 1 : 0)")
  let repo
  before(() => {
    repo = makeRepo()
    repo.write({ 'src/a.js': 'export const a = 1\n', 'src/b.js': 'export const b = 1\n' })
    repo.commit('feat: 처음')
    repo.git('switch', '-q', '-c', 'feat/x')
    repo.write({ 'src/a.js': 'export const a = 2\n' })
  })
  after(() => repo.cleanup())

  it('실패한 명령을 기준에서 다시 돌려, 기준에서 통과하면 이 변경에서 생긴 실패라고 쓴다 — 종료 코드는 그대로 1이다', () => {
    withCommands(repo, [{ name: 'test', command: failsOnTwo }])
    const result = run({ cwd: repo.dir, args: ['--baseline'] })
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.match(result.stdout, /^실패 {6}test/m)
    assert.match(result.stdout, /^기준 {6}기준에서는 통과한다 — 이 변경에서 생긴 실패다/m)
  })

  it('기준에서도 실패하면 원래 있던 실패일 수 있다고 쓰고, --json에 기준 결과를 담는다', () => {
    withCommands(repo, [{ name: 'test', command: node('process.exit(1)') }])
    const result = run({ cwd: repo.dir, args: ['--baseline', '--json'] })
    assert.equal(result.status, 1)
    const report = JSON.parse(result.stdout)
    assert.equal(report.runs[0].baseline.verdict, 'preexisting')
    assert.equal(report.runs[0].baseline.status, 'fail')
    assert.equal(report.baseline.mergeBase, report.scope.mergeBase)
  })

  it('기준은 임시 폴더에서 돌고 끝나면 지운다 — 작업 트리는 그대로다', () => {
    withCommands(repo, [{ name: 'test', command: node("require('fs').appendFileSync(require('path').join(require('os').tmpdir(), 'gimi-baseline-cwd.txt'), process.cwd() + '\\n'); process.exit(1)") }])
    const before = repo.git('status', '--porcelain')
    run({ cwd: repo.dir, args: ['--baseline'] })
    assert.equal(repo.git('status', '--porcelain'), before)
    const cwds = readFileSync(join(tmpdir(), 'gimi-baseline-cwd.txt'), 'utf8').trim().split('\n').slice(-2)
    rmSync(join(tmpdir(), 'gimi-baseline-cwd.txt'), { force: true })
    assert.ok(cwds[1].includes('gimi-baseline-'), cwds[1])
    assert.equal(existsSync(cwds[1]), false)
  })

  it('실패가 없으면 기준에서 돌리지 않았다고 쓴다', () => {
    withCommands(repo, [{ name: 'test', command: node('process.exit(0)') }])
    const result = run({ cwd: repo.dir, args: ['--baseline'] })
    assert.equal(result.status, 0)
    assert.match(result.stdout, /^기준 {6}실패한 명령이 없어 기준\(갈림점 [0-9a-f]{7}\)에서 돌리지 않았다$/m)
  })
})

describe('check.mjs — guksu-harness v2 위치', () => {
  it('.agents/hooks가 없으면 v2 위치(.claude/hooks/verifierGate.config.json)의 검사 명령을 쓴다', () => {
    const fresh = makeRepo()
    try {
      fresh.write({ 'src/a.js': 'export const a = 1\n', '.claude/hooks/verifierGate.config.json': JSON.stringify({ checks: [{ name: 'test', command: node("console.log('# pass 4')") }] }) })
      fresh.commit('feat: 처음')
      fresh.git('switch', '-q', '-c', 'feat/y')
      fresh.write({ 'src/a.js': 'export const a = 2\n' })
      const result = run({ cwd: fresh.dir })
      assert.equal(result.status, 0, result.stdout + result.stderr)
      assert.match(result.stdout, /^명령 출처 {2}guksu-harness verifier 설정\(\.claude\/hooks\/verifierGate\.config\.json\)$/m)
    } finally {
      fresh.cleanup()
    }
  })
})

describe('check.mjs — 멈추라는 신호', () => {
  it('SIGTERM을 받으면 돌고 있는 명령의 프로세스 그룹까지 멈춘다 — verifier가 시간 초과로 끊어도 테스트가 남지 않게', async () => {
    const repo = makeRepo()
    try {
      repo.write({ 'src/a.js': 'export const a = 1\n' })
      repo.commit('feat: 처음')
      repo.git('switch', '-q', '-c', 'feat/x')
      repo.write({ 'src/a.js': 'export const a = 2\n' })
      withCommands(repo, [{ name: 'test', command: node("require('fs').writeFileSync('pid', String(process.pid)); setTimeout(() => {}, 60000)") }])
      const { GIMI_CHECK_RUNNING: _, ...env } = process.env
      const child = spawn(process.execPath, [CLI], { cwd: repo.dir, stdio: 'ignore', env })
      const pidFile = join(repo.dir, 'pid')
      while (!existsSync(pidFile)) await new Promise((resolve) => setTimeout(resolve, 50))
      await new Promise((resolve) => setTimeout(resolve, 100))
      const pid = Number(readFileSync(pidFile, 'utf8'))
      child.kill('SIGTERM')
      const code = await new Promise((resolve) => child.on('exit', (exitCode, signal) => resolve(exitCode ?? signal)))
      await new Promise((resolve) => setTimeout(resolve, 300))
      let alive = true
      try {
        process.kill(pid, 0)
      } catch {
        alive = false
      }
      if (alive) process.kill(pid, 'SIGKILL')
      assert.equal(code, 143)
      assert.equal(alive, false)
    } finally {
      repo.cleanup()
    }
  })
})
