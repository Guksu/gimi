/**
 * 끝내기 전 검사 옵트인 연결 계획(설계 결정 9) — 무엇을 만들고·고치고·지울지 정한다. 파일은 CLI(connect.mjs)가 쓴다.
 * 1. check.mjs와 lib/를 프로젝트의 .agents/gimi/check/에 복사한다 — 커밋하면 gimi를 설치하지 않은 팀원에게도 돈다.
 *    복사한 파일의 해시를 manifest.json에 남겨, 다시 연결할 때 손으로 고친 파일은 덮어쓰지 않는다(충돌).
 * 2. 설정 .agents/gimi.json의 finishCheck.enabled를 true로 한다.
 * 3. guksu-harness verifier가 있으면 그 설정에 gimi 항목을 더하고(Stop 훅을 따로 달지 않는다), 없으면 앱별 Stop 훅을 등록한다.
 * --remove는 이것을 되돌린다. 등록한 항목만 떼고, 손으로 고친 파일은 남긴다.
 */
import { createHash } from 'node:crypto'

export const COPY_DIR = '.agents/gimi/check'
const MANIFEST = `${COPY_DIR}/manifest.json`
const CONFIG = '.agents/gimi.json'
// 우리가 등록한 명령 — 이 경로를 부르는 항목만 우리 것으로 본다
const OURS = /\.agents\/gimi\/check\/check\.mjs/
const FROM_GIT_ROOT = '$(git rev-parse --show-toplevel 2>/dev/null || pwd)'
// guksu-harness verifier — v3는 하네스 루트에서, v2(.claude/hooks)는 세션 폴더에서 검사를 돌린다
const HARNESSES = [
  { hook: '.agents/hooks/verifierGate.mjs', config: '.agents/hooks/verifierGate.config.json', command: `node ${COPY_DIR}/check.mjs --verifier` },
  { hook: '.claude/hooks/verifierGate.mjs', config: '.claude/hooks/verifierGate.config.json', command: `node "${FROM_GIT_ROOT}/${COPY_DIR}/check.mjs" --verifier` },
]
// 하네스는 검사 하나를 5분에서 끊는다
const VERIFIER_TIMEOUT_MS = 300000
// 앱별 등록 파일과 신호 — guksu-harness와 같다. 신호가 없으면 Claude Code
const APPS = {
  claude: { registry: '.claude/settings.json', signals: ['.claude', 'CLAUDE.md'], hook: { type: 'command', command: `node "$CLAUDE_PROJECT_DIR/${COPY_DIR}/check.mjs" --hook`, timeout: 900 } },
  codex: { registry: '.codex/hooks.json', signals: ['.codex', 'AGENTS.md', '.agents/skills', '.agents/plugins'], hook: { type: 'command', command: `node "${FROM_GIT_ROOT}/${COPY_DIR}/check.mjs" --hook` } },
}

const sha = (text) => createHash('sha256').update(text).digest('hex')
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const toText = (value) => `${JSON.stringify(value, null, 2)}\n`

/** JSON 파일 읽기 — 없으면 fallback, 읽지 못하면 null(충돌로 다룬다) */
const readJsonFile = (files, path, fallback) => {
  const text = files.read(path)
  if (text === null) return { value: fallback, existed: false }
  try {
    return { value: JSON.parse(text), existed: true }
  } catch {
    return { value: null, existed: true }
  }
}

/** JSON 파일을 고치는 동작 — 바뀌지 않으면 keep */
const jsonAction = ({ files, path, fallback, change, reason }) => {
  const { value, existed } = readJsonFile(files, path, fallback)
  if (value === null) return { kind: 'conflict', path, reason: 'JSON으로 읽지 못해 고치지 않았다' }
  const next = change(structuredClone(value))
  if (same(next, value) && existed) return { kind: 'keep', path }
  if (next === undefined) return { kind: 'keep', path }
  return { kind: existed ? 'update' : 'create', path, text: toText(next), reason }
}

const isOurs = (hook) => typeof hook?.command === 'string' && OURS.test(hook.command)

/** Stop 등록에서 우리 항목을 뗀다 — 비면 Stop·hooks 키도 지운다 */
const withoutOurStop = (registry) => {
  const stop = registry.hooks?.Stop
  if (!Array.isArray(stop)) return registry
  const kept = stop.map((entry) => ({ ...entry, hooks: (entry.hooks ?? []).filter((hook) => !isOurs(hook)) })).filter((entry) => entry.hooks.length > 0)
  if (kept.length === stop.length && kept.every((entry, i) => entry.hooks.length === stop[i].hooks.length)) return registry
  const hooks = { ...registry.hooks, Stop: kept }
  if (kept.length === 0) delete hooks.Stop
  const next = { ...registry, hooks }
  if (Object.keys(hooks).length === 0) delete next.hooks
  return next
}

const withOurStop = (registry, hook) => {
  const stop = Array.isArray(registry.hooks?.Stop) ? registry.hooks.Stop : []
  const at = stop.findIndex((entry) => (entry.hooks ?? []).some(isOurs))
  const entry = { hooks: [hook] }
  const nextStop = at === -1 ? [...stop, entry] : stop.map((item, i) => (i === at ? { ...item, hooks: item.hooks.map((h) => (isOurs(h) ? hook : h)) } : item))
  return { ...registry, hooks: { ...(registry.hooks ?? {}), Stop: nextStop } }
}

export const detectApps = (files) => {
  const found = Object.keys(APPS).filter((app) => APPS[app].signals.some((signal) => files.exists(signal)))
  return found.length > 0 ? found : ['claude']
}

const resolveApps = (app, files) => {
  if (app == null) return detectApps(files)
  if (app === 'both') return Object.keys(APPS)
  if (!APPS[app]) throw new Error('--app은 claude, codex 또는 both다')
  return [app]
}

/** 복사본 — 만들기·갱신·충돌·지우기와 새 manifest */
const copyActions = ({ files, sources, version, remove }) => {
  const { value: old } = readJsonFile(files, MANIFEST, { files: {} })
  const recorded = old?.files ?? {}
  const actions = []
  const nextFiles = {}
  const sourceNames = new Set(sources.map((s) => s.name))
  for (const source of sources) {
    const path = `${COPY_DIR}/${source.name}`
    const current = files.read(path)
    const hash = sha(source.text)
    const untouched = current !== null && (sha(current) === hash || sha(current) === recorded[source.name])
    if (remove) {
      if (current === null) continue
      actions.push(untouched ? { kind: 'delete', path } : { kind: 'conflict', path, reason: '손으로 고친 파일이라 지우지 않았다' })
      continue
    }
    if (current === null) actions.push({ kind: 'create', path, text: source.text })
    else if (sha(current) === hash) actions.push({ kind: 'keep', path })
    else if (untouched) actions.push({ kind: 'update', path, text: source.text })
    else {
      actions.push({ kind: 'conflict', path, reason: '손으로 고친 파일이라 덮어쓰지 않았다' })
      // 지난 해시를 그대로 둔다 — 다음 연결에서도 고친 파일로 알아본다
      nextFiles[source.name] = recorded[source.name] ?? sha(current)
      continue
    }
    nextFiles[source.name] = hash
  }
  // 새 판에 없는 파일
  for (const [name, hash] of Object.entries(recorded)) {
    if (sourceNames.has(name)) continue
    const path = `${COPY_DIR}/${name}`
    const current = files.read(path)
    if (current === null) continue
    actions.push(sha(current) === hash ? { kind: 'delete', path } : { kind: 'conflict', path, reason: '손으로 고친 파일이라 지우지 않았다' })
  }
  if (remove) {
    if (files.exists(MANIFEST)) actions.push({ kind: 'delete', path: MANIFEST })
  } else {
    actions.push(jsonAction({ files, path: MANIFEST, fallback: {}, change: () => ({ schemaVersion: 1, version, files: nextFiles }) }))
  }
  return actions
}

/**
 * @param {{ files: { exists: (path: string) => boolean, read: (path: string) => string | null }, sources: { name: string, text: string }[], version: string, app?: string | null, remove?: boolean }} args
 * @returns {{ mode: 'harness' | 'hook', harness: string | null, apps: string[], actions: { kind: 'create' | 'update' | 'delete' | 'keep' | 'conflict' | 'warn', path: string, text?: string, reason?: string }[] }}
 */
export const planConnect = ({ files, sources, version, app = null, remove = false }) => {
  const harness = HARNESSES.find((h) => files.exists(h.hook)) ?? null
  const apps = harness ? [] : resolveApps(app, files)
  const actions = [...copyActions({ files, sources, version, remove })]

  actions.push(
    remove
      ? files.exists(CONFIG)
        ? jsonAction({ files, path: CONFIG, fallback: {}, change: (config) => ({ ...config, finishCheck: { ...config.finishCheck, enabled: false } }), reason: 'finishCheck.enabled를 false로' })
        : { kind: 'keep', path: CONFIG }
      : jsonAction({ files, path: CONFIG, fallback: {}, change: (config) => ({ ...config, finishCheck: { ...config.finishCheck, enabled: true } }), reason: 'finishCheck.enabled를 true로' }),
  )

  // verifier 설정 — 연결은 우리 항목을 더하거나 고치고, --remove는 뗀다
  for (const h of HARNESSES) {
    const connectHere = !remove && harness === h
    if (!connectHere && !files.exists(h.config)) continue
    actions.push(
      jsonAction({
        files,
        path: h.config,
        fallback: { checks: [] },
        reason: connectHere ? 'gimi 검사 항목 등록' : 'gimi 검사 항목 떼기',
        change: (config) => {
          const checks = Array.isArray(config.checks) ? config.checks : []
          if (!connectHere) return { ...config, checks: checks.filter((check) => !isOurs(check)) }
          const entry = { name: 'gimi', command: h.command, timeoutMs: VERIFIER_TIMEOUT_MS }
          const at = checks.findIndex(isOurs)
          return { ...config, checks: at === -1 ? [...checks, entry] : checks.map((check, i) => (i === at ? { ...check, command: entry.command, timeoutMs: entry.timeoutMs } : check)) }
        },
      }),
    )
  }

  // Stop 훅 — 하네스가 없을 때만 등록한다. 하네스가 있거나 --remove면 전에 단 우리 항목을 뗀다
  for (const [name, spec] of Object.entries(APPS)) {
    const register = !remove && apps.includes(name)
    if (!register && !files.exists(spec.registry)) continue
    actions.push(
      jsonAction({
        files,
        path: spec.registry,
        fallback: {},
        reason: register ? 'Stop 훅 등록' : 'gimi Stop 훅 떼기',
        change: (registry) => (register ? withOurStop(registry, spec.hook) : withoutOurStop(registry)),
      }),
    )
  }

  if (harness && !remove) {
    const registered = Object.values(APPS).some((spec) => {
      const { value } = readJsonFile(files, spec.registry, {})
      return (value?.hooks?.Stop ?? []).some((entry) => (entry.hooks ?? []).some((hook) => String(hook.command ?? '').includes('verifierGate.mjs')))
    })
    if (!registered) actions.push({ kind: 'warn', path: harness.hook, reason: 'verifierGate.mjs가 Stop에 등록되어 있지 않다 — npx guksu-harness init --verifier로 등록해야 gimi 검사가 돈다' })
  }
  return { mode: harness ? 'harness' : 'hook', harness: harness?.config ?? null, apps, actions }
}
