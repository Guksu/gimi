import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeRepo } from './helpers/repo.mjs'

const CONNECT = fileURLToPath(new URL('../skills/gimi-test/scripts/connect.mjs', import.meta.url))
const LIB = fileURLToPath(new URL('../skills/gimi-test/scripts/lib/', import.meta.url))
const cleanEnv = () => {
  const { GIMI_CHECK_RUNNING: _, ...env } = process.env
  return env
}
const connect = (cwd, args = []) => spawnSync(process.execPath, [CONNECT, ...args], { cwd, encoding: 'utf8', env: cleanEnv() })
const fresh = (files = {}) => {
  const repo = makeRepo()
  repo.write({ 'src/a.js': 'export const a = 1\n', ...files })
  repo.commit('feat: 처음')
  repo.git('switch', '-q', '-c', 'feat/x')
  return repo
}
const json = (repo, path) => JSON.parse(readFileSync(join(repo.dir, path), 'utf8'))

describe('connect.mjs', () => {
  it('guksu-harness가 없으면 복사·설정·Claude Code Stop 훅을 만들고, 복사본이 Stop 훅으로 실제로 끝내기를 막는다', () => {
    const repo = fresh()
    const state = mkdtempSync(join(tmpdir(), 'gimi-connect-state-'))
    try {
      const result = connect(repo.dir)
      assert.equal(result.status, 0, result.stdout + result.stderr)
      assert.match(result.stdout, /^끝내기 전 검사 연결 {2}Stop 훅으로 연결한다\(Claude Code\) — guksu-harness verifier가 없다$/m)
      assert.match(result.stdout, new RegExp(`^만듦 {6}\\.agents/gimi/check/ — 파일 ${readdirSync(LIB).length + 2}개\\(check\\.mjs·lib/·manifest\\.json\\)$`, 'm'))
      assert.match(result.stdout, /^만듦 {6}\.claude\/settings\.json — Stop 훅 등록$/m)
      assert.match(result.stdout, /^다음 {6}.*커밋하면 팀에도 켜진다.*--remove/m)
      assert.equal(json(repo, '.agents/gimi.json').finishCheck.enabled, true)
      assert.match(json(repo, '.claude/settings.json').hooks.Stop[0].hooks[0].command, /\$CLAUDE_PROJECT_DIR\/\.agents\/gimi\/check\/check\.mjs" --hook$/)

      // 등록한 명령 그대로 — $CLAUDE_PROJECT_DIR는 Claude Code가 넣어 준다
      repo.write({ 'src/a.js': 'export const a = 2\ndebugger\n' })
      const command = json(repo, '.claude/settings.json').hooks.Stop[0].hooks[0].command
      const hook = spawnSync('sh', ['-c', command], { cwd: repo.dir, input: JSON.stringify({ session_id: 's', stop_hook_active: false }), encoding: 'utf8', env: { ...cleanEnv(), CLAUDE_PROJECT_DIR: repo.dir, GIMI_STATE_DIR: state } })
      assert.equal(hook.status, 2, hook.stderr)
      assert.match(hook.stderr, /^error {5}code\/debug-leftover {2}src\/a\.js:2/m)
    } finally {
      repo.cleanup()
      rmSync(state, { recursive: true, force: true })
    }
  })

  it('다시 연결하면 바뀐 것이 없다고 쓴다. --dry-run은 아무것도 쓰지 않는다', () => {
    const repo = fresh()
    try {
      const preview = connect(repo.dir, ['--dry-run'])
      assert.equal(preview.status, 0)
      assert.match(preview.stdout, /미리보기 — 아무것도 쓰지 않았다/)
      assert.equal(existsSync(join(repo.dir, '.agents')), false)
      connect(repo.dir)
      const again = connect(repo.dir)
      assert.equal(again.status, 0)
      assert.match(again.stdout, /^바뀐 것 없음 {2}이미 연결되어 있다$/m)
    } finally {
      repo.cleanup()
    }
  })

  it('guksu-harness verifier가 있으면 그 설정에 gimi 항목을 더하고, 등록한 명령이 verifier 모드로 돈다', () => {
    const repo = fresh({
      '.agents/hooks/verifierGate.mjs': '',
      '.agents/hooks/verifierGate.config.json': JSON.stringify({ checks: [{ name: 'test', command: 'node -e "process.exit(0)"' }] }),
      '.claude/settings.json': JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.agents/hooks/verifierGate.mjs"' }] }] } }),
    })
    try {
      const result = connect(repo.dir)
      assert.equal(result.status, 0, result.stdout + result.stderr)
      assert.match(result.stdout, /^끝내기 전 검사 연결 {2}guksu-harness verifier\(\.agents\/hooks\/verifierGate\.config\.json\)에 연결한다/m)
      const entry = json(repo, '.agents/hooks/verifierGate.config.json').checks[1]
      assert.equal(entry.command, 'node .agents/gimi/check/check.mjs --verifier')
      repo.write({ 'src/a.js': 'export const a = 2\n' })
      const verifier = spawnSync('sh', ['-c', entry.command], { cwd: repo.dir, encoding: 'utf8', env: cleanEnv() })
      assert.equal(verifier.status, 0, verifier.stdout + verifier.stderr)
      assert.match(verifier.stdout, /^건너뜀 {4}명령 — guksu-harness verifier가 직접 돌린다/m)
    } finally {
      repo.cleanup()
    }
  })

  it('--remove는 복사본과 연결이 만든 설정을 지우고 등록한 항목만 뗀다', () => {
    const repo = fresh({ '.claude/settings.json': JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'x' }] }] } }) })
    try {
      connect(repo.dir)
      const result = connect(repo.dir, ['--remove'])
      assert.equal(result.status, 0, result.stdout + result.stderr)
      assert.match(result.stdout, /^끝내기 전 검사 연결 해제/m)
      assert.equal(existsSync(join(repo.dir, '.agents')), false)
      assert.deepEqual(json(repo, '.claude/settings.json'), { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'x' }] }] } })
    } finally {
      repo.cleanup()
    }
  })

  it('손으로 고친 복사본은 덮어쓰지 않고 종료 코드 1로 알린다', () => {
    const repo = fresh()
    try {
      connect(repo.dir)
      repo.write({ '.agents/gimi/check/lib/plan.mjs': '// 팀이 고친 판\n' })
      const result = connect(repo.dir)
      assert.equal(result.status, 1)
      assert.match(result.stdout, /^충돌 {6}\.agents\/gimi\/check\/lib\/plan\.mjs — 손으로 고친 파일이라 덮어쓰지 않았다$/m)
      assert.equal(readFileSync(join(repo.dir, '.agents/gimi/check/lib/plan.mjs'), 'utf8'), '// 팀이 고친 판\n')
    } finally {
      repo.cleanup()
    }
  })
})
