import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeRepo } from './helpers/repo.mjs'

const CLI = fileURLToPath(new URL('../skills/gimi-test/scripts/check.mjs', import.meta.url))
const node = (code) => `node -e ${JSON.stringify(code)}`

/** 검사 명령이 돌 때마다 저장소 밖의 파일에 한 줄씩 남긴다 — 저장소에 쓰면 바뀐 상태가 달라진다 */
const counter = () => {
  const dir = mkdtempSync(join(tmpdir(), 'gimi-hook-count-'))
  const file = join(dir, 'runs.log')
  return {
    file,
    count: () => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).length : 0),
    // src/a.js에 2가 들어 있으면 실패한다
    command: node(`require('fs').appendFileSync(${JSON.stringify(file)}, 'run\\n'); process.exit(require('fs').readFileSync('src/a.js', 'utf8').includes('2') ? 1 : 0)`),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

const setup = ({ enabled = true, commands, extra = {} }) => {
  const repo = makeRepo()
  repo.write({ 'src/a.js': 'export const a = 1\n', '.agents/gimi.json': JSON.stringify({ finishCheck: { enabled, commands } }), ...extra })
  repo.commit('feat: 처음')
  repo.git('switch', '-q', '-c', 'feat/x')
  return repo
}

describe('check.mjs --hook (Stop 훅)', () => {
  let state
  beforeEach(() => {
    state = mkdtempSync(join(tmpdir(), 'gimi-hook-state-'))
  })
  after(() => rmSync(state, { recursive: true, force: true }))

  const hook = (cwd, input = {}) => {
    const { GIMI_CHECK_RUNNING: _, ...env } = process.env
    return spawnSync(process.execPath, [CLI, '--hook'], { cwd, input: JSON.stringify({ session_id: 's1', stop_hook_active: false, cwd, ...input }), encoding: 'utf8', env: { ...env, GIMI_STATE_DIR: state } })
  }

  it('설정에서 끝내기 전 검사를 켜지 않았으면(finishCheck.enabled) 돌리지 않고 끝내게 둔다', () => {
    const runs = counter()
    const repo = setup({ enabled: false, commands: [{ name: 'test', command: runs.command }] })
    try {
      repo.write({ 'src/a.js': 'export const a = 2\n' })
      const result = hook(repo.dir)
      assert.equal(result.status, 0, result.stderr)
      assert.equal(runs.count(), 0)
    } finally {
      repo.cleanup()
      runs.cleanup()
    }
  })

  it('실패하면 종료 코드 2로 막고 보고를 넘긴다 → 고치지 않고 다시 끝내려 하면 돌리지 않고 보고하고 끝내라고 막는다 → 그다음은 끝내게 둔다', () => {
    const runs = counter()
    const repo = setup({ commands: [{ name: 'test', command: runs.command }] })
    try {
      repo.write({ 'src/a.js': 'export const a = 2\n' })
      const first = hook(repo.dir)
      assert.equal(first.status, 2)
      assert.match(first.stderr, /끝내기 전 검사가 실패했다/)
      assert.match(first.stderr, /^실패 {6}test/m)
      assert.equal(runs.count(), 1)

      const again = hook(repo.dir, { stop_hook_active: true })
      assert.equal(again.status, 2)
      assert.match(again.stderr, /고치지 않고 끝내려 한다/)
      assert.equal(runs.count(), 1)

      assert.equal(hook(repo.dir, { stop_hook_active: true }).status, 0)
    } finally {
      repo.cleanup()
      runs.cleanup()
    }
  })

  it('고친 뒤에는 통과로 끝내게 두고, 그 뒤로 바뀐 것이 없으면 다시 돌리지 않는다', () => {
    const runs = counter()
    const repo = setup({ commands: [{ name: 'test', command: runs.command }] })
    try {
      repo.write({ 'src/a.js': 'export const a = 2\n' })
      assert.equal(hook(repo.dir).status, 2)
      repo.write({ 'src/a.js': 'export const a = 3\n' })
      const fixed = hook(repo.dir, { stop_hook_active: true })
      assert.equal(fixed.status, 0, fixed.stderr)
      assert.equal(runs.count(), 2)
      assert.equal(hook(repo.dir).status, 0)
      assert.equal(runs.count(), 2)
    } finally {
      repo.cleanup()
      runs.cleanup()
    }
  })

  it('세션마다 상태를 따로 둔다', () => {
    const runs = counter()
    const repo = setup({ commands: [{ name: 'test', command: runs.command }] })
    try {
      repo.write({ 'src/a.js': 'export const a = 3\n' })
      assert.equal(hook(repo.dir).status, 0)
      assert.equal(hook(repo.dir, { session_id: 's2' }).status, 0)
      assert.equal(runs.count(), 2)
    } finally {
      repo.cleanup()
      runs.cleanup()
    }
  })

  it('바뀐 파일이 없으면 돌리지 않는다. 슬롭 error가 있으면 명령이 통과해도 막는다', () => {
    const runs = counter()
    const repo = setup({ commands: [{ name: 'test', command: runs.command }] })
    try {
      assert.equal(hook(repo.dir).status, 0)
      assert.equal(runs.count(), 0)
      repo.write({ 'src/a.js': 'export const a = 3\ndebugger\n' })
      const result = hook(repo.dir)
      assert.equal(result.status, 2)
      assert.match(result.stderr, /^error {5}code\/debug-leftover {2}src\/a\.js:2/m)
    } finally {
      repo.cleanup()
      runs.cleanup()
    }
  })
})

describe('check.mjs --verifier (guksu-harness 검사 항목)', () => {
  const verifier = (cwd) => {
    const { GIMI_CHECK_RUNNING: _, ...env } = process.env
    return spawnSync(process.execPath, [CLI, '--verifier'], { cwd, encoding: 'utf8', env })
  }
  const harnessWith = (checks) => ({ '.agents/hooks/verifierGate.config.json': JSON.stringify({ checks }) })
  const gimiEntry = { name: 'gimi', command: 'node .agents/gimi/check/check.mjs --verifier' }

  it('하네스가 직접 돌리는 명령은 다시 돌리지 않고 슬롭 검사만 한다', () => {
    const runs = counter()
    const repo = setup({ commands: undefined, extra: harnessWith([{ name: 'test', command: runs.command }, gimiEntry]) })
    try {
      repo.write({ 'src/a.js': 'export const a = 2\n' })
      const result = verifier(repo.dir)
      assert.equal(result.status, 0, result.stdout + result.stderr)
      assert.equal(runs.count(), 0)
      assert.match(result.stdout, /^건너뜀 {4}명령 — guksu-harness verifier가 직접 돌린다/m)
      repo.write({ 'src/a.js': 'export const a = 2\ndebugger\n' })
      assert.equal(verifier(repo.dir).status, 1)
    } finally {
      repo.cleanup()
      runs.cleanup()
    }
  })

  it('하네스에 gimi 항목만 있으면 gimi가 찾은 명령(설정·프로젝트 파일)을 돌린다', () => {
    const runs = counter()
    const repo = setup({ commands: [{ name: 'test', command: runs.command }], extra: harnessWith([gimiEntry]) })
    try {
      repo.write({ 'src/a.js': 'export const a = 2\n' })
      const result = verifier(repo.dir)
      assert.equal(result.status, 1)
      assert.equal(runs.count(), 1)
    } finally {
      repo.cleanup()
      runs.cleanup()
    }
  })

  it('설정에서 끄면(finishCheck.enabled가 true가 아님) 돌리지 않고 통과한다', () => {
    const runs = counter()
    const repo = setup({ enabled: false, commands: [{ name: 'test', command: runs.command }], extra: harnessWith([gimiEntry]) })
    try {
      repo.write({ 'src/a.js': 'export const a = 2\ndebugger\n' })
      const result = verifier(repo.dir)
      assert.equal(result.status, 0)
      assert.match(result.stdout, /꺼져 있다/)
      assert.equal(runs.count(), 0)
    } finally {
      repo.cleanup()
      runs.cleanup()
    }
  })
})
