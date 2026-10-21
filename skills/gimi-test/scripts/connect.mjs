#!/usr/bin/env node
/**
 * gimi-test 끝내기 전 검사 옵트인 연결(설계 결정 9) — 이 프로젝트에서만 끝내기 전에 check.mjs가 자동으로 돌게 한다.
 * check.mjs와 lib/를 .agents/gimi/check/에 복사하고 .agents/gimi.json의 finishCheck.enabled를 켠다.
 * guksu-harness verifier가 있으면 그 설정에 gimi 항목을 더하고, 없으면 Claude Code·Codex의 Stop 훅에 등록한다.
 *
 *   node connect.mjs               # 연결한다(앱은 .claude/·CLAUDE.md·.codex/·AGENTS.md로 추정)
 *   node connect.mjs --app codex   # 등록할 앱을 정한다(claude·codex·both)
 *   node connect.mjs --dry-run     # 무엇을 바꿀지만 보인다
 *   node connect.mjs --remove      # 연결을 되돌린다(등록한 항목만 떼고 손으로 고친 파일은 남긴다)
 *
 * 종료 코드: 0 연결함(바뀐 것이 없어도), 1 충돌(손으로 고친 파일·읽지 못한 설정)이 있음, 2 사용법·환경 오류. 의존성 없음, Node 22 이상.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { COPY_DIR, planConnect } from './lib/connect.mjs'
import { attempt, createExec } from './lib/exec.mjs'

const USAGE = '사용: node connect.mjs [--app claude|codex|both] [--dry-run] [--remove]'
const HERE = dirname(fileURLToPath(import.meta.url))
const APP_NAME = { claude: 'Claude Code', codex: 'Codex' }
const LABEL = { create: '만듦      ', update: '고침      ', delete: '지움      ', conflict: '충돌      ', warn: '알림      ' }

const parseArgs = (argv) => {
  const args = { app: null, dryRun: false, remove: false, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--dry-run') args.dryRun = true
    else if (arg === '--remove') args.remove = true
    else if (arg === '--help' || arg === '-h') args.help = true
    else if (arg === '--app') {
      const value = argv[i + 1]
      if (!['claude', 'codex', 'both'].includes(value)) throw new Error('--app은 claude, codex 또는 both다')
      args.app = value
      i += 1
    } else throw new Error(`모르는 옵션 ${arg}`)
  }
  return args
}

/** 복사할 파일 — check.mjs와 lib/의 모든 .mjs(connect.mjs는 넣지 않는다) */
const readSources = () => [
  { name: 'check.mjs', text: readFileSync(join(HERE, 'check.mjs'), 'utf8') },
  ...readdirSync(join(HERE, 'lib'))
    .filter((name) => name.endsWith('.mjs'))
    .sort()
    .map((name) => ({ name: `lib/${name}`, text: readFileSync(join(HERE, 'lib', name), 'utf8') })),
]

// 플러그인 매니페스트의 판 — 스킬 폴더(skills/gimi-test/scripts)에서 세 단계 위가 플러그인 루트다
const pluginVersion = () => {
  for (const manifest of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json']) {
    const version = attempt(() => JSON.parse(readFileSync(join(HERE, '../../..', manifest), 'utf8')).version)
    if (version) return version
  }
  return 'unknown'
}

const headerOf = (result, remove) => {
  if (remove) return '끝내기 전 검사 연결 해제'
  if (result.mode === 'harness') return `끝내기 전 검사 연결  guksu-harness verifier(${result.harness})에 연결한다 — 하네스가 직접 돌리는 명령은 다시 돌리지 않는다`
  return `끝내기 전 검사 연결  Stop 훅으로 연결한다(${result.apps.map((app) => APP_NAME[app]).join('·')}) — guksu-harness verifier가 없다`
}

/** 복사본은 종류마다 한 줄로 묶고, 나머지는 파일마다 한 줄 */
const rowsOf = (actions) => {
  const rows = []
  const copies = actions.filter((a) => a.path.startsWith(`${COPY_DIR}/`) && a.kind !== 'conflict' && a.kind !== 'keep')
  for (const kind of ['create', 'update', 'delete']) {
    const n = copies.filter((a) => a.kind === kind).length
    if (n > 0) rows.push(`${LABEL[kind]}${COPY_DIR}/ — 파일 ${n}개(check.mjs·lib/·manifest.json)`)
  }
  for (const action of actions) {
    if (action.kind === 'keep' || (action.path.startsWith(`${COPY_DIR}/`) && action.kind !== 'conflict')) continue
    rows.push(`${LABEL[action.kind]}${action.path}${action.reason ? ` — ${action.reason}` : ''}`)
  }
  return rows
}

const apply = ({ root, actions, remove }) => {
  for (const action of actions) {
    const path = join(root, action.path)
    if (action.kind === 'create' || action.kind === 'update') {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, action.text)
    } else if (action.kind === 'delete') rmSync(path, { force: true })
  }
  // 비어 있는 폴더만 지운다 — 손으로 고친 파일이 남았으면 폴더도 남는다
  if (remove) for (const dir of [`${COPY_DIR}/lib`, COPY_DIR, '.agents/gimi']) attempt(() => rmdirSync(join(root, dir)))
}

const main = () => {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`${error.message}\n${USAGE}`)
    return 2
  }
  if (args.help) {
    console.log(USAGE)
    return 0
  }
  const root = attempt(() => createExec({ cwd: process.cwd() }).git(['rev-parse', '--show-toplevel']).trim())
  if (!root) {
    console.error('git 저장소가 아니다 — 연결할 프로젝트 안에서 돌린다')
    return 2
  }
  const files = {
    exists: (path) => existsSync(join(root, path)),
    read: (path) => (existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : null),
  }
  const result = planConnect({ files, sources: readSources(), version: pluginVersion(), app: args.app, remove: args.remove })
  const rows = rowsOf(result.actions)
  const header = headerOf(result, args.remove)
  const out = [args.dryRun ? `${header} (미리보기 — 아무것도 쓰지 않았다)` : header]
  if (rows.length === 0) out.push(args.remove ? '바뀐 것 없음  연결되어 있지 않다' : '바뀐 것 없음  이미 연결되어 있다')
  out.push(...rows)
  if (!args.remove && rows.length > 0) {
    out.push('다음      바뀐 파일을 커밋하면 팀에도 켜진다. 잠시 끄려면 .agents/gimi.json의 finishCheck.enabled를 false로 한다. 연결을 되돌리려면 connect.mjs --remove')
  }
  if (!args.dryRun) apply({ root, actions: result.actions, remove: args.remove })
  process.stdout.write(`${out.join('\n')}\n`)
  return result.actions.some((a) => a.kind === 'conflict') ? 1 : 0
}

process.exitCode = main()
