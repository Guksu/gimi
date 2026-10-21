import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { planConnect } from '../skills/gimi-test/scripts/lib/connect.mjs'

const sha = (text) => createHash('sha256').update(text).digest('hex')
const filesOf = (map) => ({ exists: (path) => path in map, read: (path) => map[path] ?? null })
const SOURCES = [
  { name: 'check.mjs', text: 'check v2' },
  { name: 'lib/plan.mjs', text: 'plan v2' },
]
const plan = (map, options = {}) => planConnect({ files: filesOf(map), sources: SOURCES, version: '0.0.2', ...options })
const write = (result, path) => {
  const action = result.actions.find((a) => a.path === path && (a.kind === 'create' || a.kind === 'update'))
  return action ? JSON.parse(action.text) : null
}
const kinds = (result) => result.actions.filter((a) => a.kind !== 'keep').map((a) => [a.kind, a.path])
const CLAUDE_HOOK = 'node "$CLAUDE_PROJECT_DIR/.agents/gimi/check/check.mjs" --hook'
const CODEX_HOOK = 'node "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.agents/gimi/check/check.mjs" --hook'

describe('planConnect — guksu-harness가 없으면 Stop 훅', () => {
  it('스크립트를 .agents/gimi/check/에 복사하고, 설정을 켜고, Claude Code Stop 훅을 등록한다(앱 신호가 없으면 Claude Code)', () => {
    const result = plan({})
    assert.equal(result.mode, 'hook')
    assert.deepEqual(result.apps, ['claude'])
    assert.deepEqual(kinds(result), [
      ['create', '.agents/gimi/check/check.mjs'],
      ['create', '.agents/gimi/check/lib/plan.mjs'],
      ['create', '.agents/gimi/check/manifest.json'],
      ['create', '.agents/gimi.json'],
      ['create', '.claude/settings.json'],
    ])
    assert.deepEqual(write(result, '.agents/gimi.json'), { finishCheck: { enabled: true } })
    assert.deepEqual(write(result, '.claude/settings.json'), { hooks: { Stop: [{ hooks: [{ type: 'command', command: CLAUDE_HOOK, timeout: 900 }] }] } })
    assert.deepEqual(write(result, '.agents/gimi/check/manifest.json'), { schemaVersion: 1, version: '0.0.2', files: { 'check.mjs': sha('check v2'), 'lib/plan.mjs': sha('plan v2') } })
  })

  it('있던 설정 파일의 다른 항목은 그대로 두고 Stop에 덧붙인다', () => {
    const settings = { permissions: { deny: ['Read(./.env)'] }, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'x' }] }], Stop: [{ hooks: [{ type: 'command', command: 'other' }] }] } }
    const config = { stacks: ['backend'], finishCheck: { commands: [{ name: 't', command: 'make test' }] } }
    const result = plan({ '.claude/settings.json': JSON.stringify(settings), '.agents/gimi.json': JSON.stringify(config) })
    const next = write(result, '.claude/settings.json')
    assert.deepEqual(next.permissions, settings.permissions)
    assert.deepEqual(next.hooks.PreToolUse, settings.hooks.PreToolUse)
    assert.deepEqual(next.hooks.Stop.map((entry) => entry.hooks[0].command), ['other', CLAUDE_HOOK])
    assert.deepEqual(write(result, '.agents/gimi.json'), { stacks: ['backend'], finishCheck: { commands: [{ name: 't', command: 'make test' }], enabled: true } })
  })

  it('Codex 신호(AGENTS.md·.codex)가 있으면 .codex/hooks.json에 Git 루트로 찾는 명령을 등록한다 — --app both면 둘 다', () => {
    const codex = plan({ 'AGENTS.md': '' })
    assert.deepEqual(codex.apps, ['codex'])
    assert.deepEqual(write(codex, '.codex/hooks.json'), { hooks: { Stop: [{ hooks: [{ type: 'command', command: CODEX_HOOK }] }] } })
    assert.deepEqual(plan({ 'AGENTS.md': '' }, { app: 'both' }).apps, ['claude', 'codex'])
  })

  it('다시 연결해도 바뀐 것이 없으면 아무것도 쓰지 않는다', () => {
    const first = plan({})
    const after = Object.fromEntries(first.actions.filter((a) => a.text !== undefined).map((a) => [a.path, a.text]))
    assert.deepEqual(kinds(plan(after)), [])
  })

  it('설정 파일을 JSON으로 읽지 못하면 덮어쓰지 않고 충돌로 적는다', () => {
    const result = plan({ '.claude/settings.json': '{ broken' })
    assert.deepEqual(result.actions.find((a) => a.path === '.claude/settings.json').kind, 'conflict')
  })
})

describe('planConnect — guksu-harness가 있으면 verifier', () => {
  const V3 = { '.agents/hooks/verifierGate.mjs': '', '.claude/settings.json': JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.agents/hooks/verifierGate.mjs"' }] }] } }) }

  it('verifier 설정에 gimi 항목을 더한다 — 있던 검사는 그대로, Stop 훅은 등록하지 않는다', () => {
    const result = plan({ ...V3, '.agents/hooks/verifierGate.config.json': JSON.stringify({ checks: [{ name: 'test', command: 'npm test' }], maxIterations: 10 }) })
    assert.equal(result.mode, 'harness')
    assert.equal(result.harness, '.agents/hooks/verifierGate.config.json')
    assert.deepEqual(write(result, '.agents/hooks/verifierGate.config.json'), {
      checks: [{ name: 'test', command: 'npm test' }, { name: 'gimi', command: 'node .agents/gimi/check/check.mjs --verifier', timeoutMs: 300000 }],
      maxIterations: 10,
    })
    assert.equal(result.actions.some((a) => a.path === '.claude/settings.json' && a.kind !== 'keep'), false)
  })

  it('v2 위치(.claude/hooks)는 세션 폴더에서 돌므로 Git 루트로 찾는 명령을 쓴다', () => {
    const result = plan({ '.claude/hooks/verifierGate.mjs': '', '.claude/hooks/verifierGate.config.json': JSON.stringify({ checks: [] }), '.claude/settings.json': JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/verifierGate.mjs"' }] }] } }) })
    assert.equal(write(result, '.claude/hooks/verifierGate.config.json').checks[0].command, 'node "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.agents/gimi/check/check.mjs" --verifier')
  })

  it('verifierGate가 Stop에 등록되어 있지 않으면 알린다. 전에 단 gimi Stop 훅은 겹치지 않게 뗀다', () => {
    const settings = { hooks: { Stop: [{ hooks: [{ type: 'command', command: CLAUDE_HOOK, timeout: 900 }] }] } }
    const result = plan({ '.agents/hooks/verifierGate.mjs': '', '.claude/settings.json': JSON.stringify(settings) })
    assert.ok(result.actions.some((a) => a.kind === 'warn' && /verifierGate\.mjs가 Stop에 등록되어 있지 않다/.test(a.reason)))
    assert.deepEqual(write(result, '.claude/settings.json'), {})
  })
})

describe('planConnect — 복사본 갱신과 --remove', () => {
  const OLD = { '.agents/gimi/check/check.mjs': 'check v1', '.agents/gimi/check/lib/plan.mjs': 'plan v1', '.agents/gimi/check/lib/gone.mjs': 'gone v1' }
  const manifest = (files) => JSON.stringify({ schemaVersion: 1, version: '0.0.1', files: Object.fromEntries(Object.entries(files).map(([name, text]) => [name, sha(text)])) })

  it('지난번 복사본 그대로면 새 판으로 바꾸고, 손으로 고친 파일은 충돌로 남기고, 새 판에 없는 파일은 지운다', () => {
    const map = { ...OLD, '.agents/gimi/check/lib/plan.mjs': 'plan v1 + 손으로 고침', '.agents/gimi/check/manifest.json': manifest({ 'check.mjs': 'check v1', 'lib/plan.mjs': 'plan v1', 'lib/gone.mjs': 'gone v1' }) }
    const result = plan(map)
    assert.deepEqual(kinds(result).filter(([, path]) => path.startsWith('.agents/gimi/check/')), [
      ['update', '.agents/gimi/check/check.mjs'],
      ['conflict', '.agents/gimi/check/lib/plan.mjs'],
      ['delete', '.agents/gimi/check/lib/gone.mjs'],
      ['update', '.agents/gimi/check/manifest.json'],
    ])
    // 충돌한 파일은 지난 해시를 그대로 둔다 — 다음 연결에서도 고친 파일로 알아본다
    assert.equal(write(result, '.agents/gimi/check/manifest.json').files['lib/plan.mjs'], sha('plan v1'))
  })

  it('--remove는 고치지 않은 복사본과 기록을 지우고, 설정을 끄고(연결이 넣은 값만 남으면 지우고), 등록한 항목만 뗀다', () => {
    const settings = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'other' }] }, { hooks: [{ type: 'command', command: CLAUDE_HOOK, timeout: 900 }] }] } }
    const map = {
      '.agents/gimi/check/check.mjs': 'check v2',
      '.agents/gimi/check/lib/plan.mjs': 'plan v2 + 고침',
      '.agents/gimi/check/manifest.json': manifest({ 'check.mjs': 'check v2', 'lib/plan.mjs': 'plan v2' }),
      '.agents/gimi.json': JSON.stringify({ finishCheck: { enabled: true } }),
      '.claude/settings.json': JSON.stringify(settings),
    }
    const result = plan(map, { remove: true })
    assert.deepEqual(kinds(result), [
      ['delete', '.agents/gimi/check/check.mjs'],
      ['conflict', '.agents/gimi/check/lib/plan.mjs'],
      ['delete', '.agents/gimi/check/manifest.json'],
      ['delete', '.agents/gimi.json'],
      ['update', '.claude/settings.json'],
    ])
    assert.deepEqual(write(result, '.claude/settings.json').hooks.Stop.map((entry) => entry.hooks[0].command), ['other'])
  })
})

describe('planConnect — 손댄 흔적 줄이기', () => {
  it('사람이 다르게 맞춘 JSON을 다시 쓸 때는 형식이 바뀐다고 밝힌다', () => {
    const settings = '{\n    "hooks": {}\n}\n'
    const action = plan({ '.claude/settings.json': settings }).actions.find((a) => a.path === '.claude/settings.json')
    assert.equal(action.kind, 'update')
    assert.match(action.reason, /2칸 들여쓰기로 다시 썼다/)
    const tidy = plan({ '.claude/settings.json': '{\n  "hooks": {}\n}\n' }).actions.find((a) => a.path === '.claude/settings.json')
    assert.doesNotMatch(tidy.reason, /다시 썼다/)
  })

  it('--remove에서 설정에 연결이 넣은 값만 남으면 설정 파일을 지운다', () => {
    const only = plan({ '.agents/gimi.json': JSON.stringify({ finishCheck: { enabled: true } }) }, { remove: true })
    assert.deepEqual(only.actions.find((a) => a.path === '.agents/gimi.json').kind, 'delete')
    const more = plan({ '.agents/gimi.json': JSON.stringify({ stacks: ['backend'], finishCheck: { enabled: true } }) }, { remove: true })
    assert.deepEqual(more.actions.find((a) => a.path === '.agents/gimi.json').kind, 'update')
  })
})
