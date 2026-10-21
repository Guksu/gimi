/**
 * 끝내기 전에 돌릴 명령 찾기(설계 결정 50) — 설정 finishCheck.commands → guksu-harness verifier 설정 → 프로젝트 파일 감지 순서다.
 * 프로젝트 파일은 바뀐 파일마다 가장 가까운 것을 찾아 묶음(패키지·모듈)별로 명령을 만든다. 바뀐 범위만 돌린다.
 * 파일 시스템은 project({ exists, readJson, readText })로 받는다 — 경로는 저장소 루트 기준 / 구분이다.
 */
import { posix } from 'node:path'

const CODE = /\.(m|c)?[jt]sx?$|\.(vue|svelte)$/
// 타입 선언에는 테스트가 없다 — 타입 검사는 하되 관련 테스트 찾기에는 넘기지 않는다
const DECLARATION = /\.d\.[cm]?ts$/
// .agents/·.claude/·.github/처럼 점으로 시작하는 폴더는 도구용 파일이다
const TOOLING = /(^|\/)\.[^/]+\//
// 이보다 많으면 명령 줄이 너무 길어진다 — 관련 테스트를 고르지 않고 전체를 돌린다
const MAX_RELATED = 100
const MARKERS = ['package.json', 'build.gradle.kts', 'build.gradle', 'pom.xml', 'pyproject.toml', 'go.mod']
// check.mjs가 하네스 설정을 읽고 하네스가 다시 check.mjs를 부르면 끝없이 돈다
const SELF = /check\.mjs/

/** 셸 인자 — 안전한 글자만이면 그대로, 아니면 작은따옴표로 */
const quote = (value) => (/^[\w./@:+-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`)
const join = (values) => values.map(quote).join(' ')

const markerDir = ({ path, project }) => {
  let dir = posix.dirname(path)
  for (;;) {
    const base = dir === '.' ? '' : dir
    const marker = MARKERS.find((name) => project.exists(base ? `${base}/${name}` : name))
    if (marker) return { dir: base, marker }
    if (base === '') return null
    dir = posix.dirname(dir)
  }
}

const within = ({ dir, path }) => (dir ? path.slice(dir.length + 1) : path)
const at = (dir, name) => (dir ? `${dir}/${name}` : name)

const planJs = ({ dir, files, project }) => {
  const pkg = project.readJson(at(dir, 'package.json'))
  const scripts = pkg.scripts ?? {}
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  const code = files.map((path) => within({ dir, path })).filter((path) => CODE.test(path) && !TOOLING.test(path))
  if (code.length === 0) return { checks: [], skipped: ['test', 'typecheck', 'lint'].map((name) => ({ name, cwd: dir, reason: '바뀐 코드 파일이 없다' })) }
  const related = code.filter((path) => !DECLARATION.test(path))
  const checks = []
  const skipped = []

  const testScript = scripts.test ?? ''
  const runner = deps.vitest || /\bvitest\b/.test(testScript) ? 'vitest' : deps.jest || /\bjest\b/.test(testScript) ? 'jest' : null
  if (runner && related.length === 0) skipped.push({ name: 'test', cwd: dir, reason: '관련 테스트를 찾을 코드 파일이 없다(타입 선언만 바뀌었다)' })
  else if (runner && related.length > MAX_RELATED) checks.push({ name: 'test', cwd: dir, scope: 'all', command: runner === 'vitest' ? 'npx vitest run' : 'npx jest --passWithNoTests' })
  else if (runner === 'vitest') checks.push({ name: 'test', cwd: dir, scope: 'related', command: `npx vitest related --run ${join(related)}` })
  else if (runner === 'jest') checks.push({ name: 'test', cwd: dir, scope: 'related', command: `npx jest --findRelatedTests ${join(related)} --passWithNoTests` })
  else if (testScript && !/no test specified/.test(testScript)) checks.push({ name: 'test', cwd: dir, scope: 'all', command: 'npm test' })
  else skipped.push({ name: 'test', cwd: dir, reason: '테스트 스크립트(package.json의 test)가 없다' })

  const typecheckScript = ['typecheck', 'type-check', 'tsc'].find((name) => scripts[name])
  if (typecheckScript) checks.push({ name: 'typecheck', cwd: dir, scope: 'all', command: `npm run ${typecheckScript}` })
  else if (project.exists(at(dir, 'tsconfig.json'))) checks.push({ name: 'typecheck', cwd: dir, scope: 'all', command: 'npx tsc --noEmit -p tsconfig.json' })
  else skipped.push({ name: 'typecheck', cwd: dir, reason: 'TypeScript 설정(tsconfig.json·typecheck 스크립트)이 없다' })

  if (scripts.lint) checks.push({ name: 'lint', cwd: dir, scope: 'all', command: 'npm run lint' })
  else skipped.push({ name: 'lint', cwd: dir, reason: 'lint 스크립트가 없다' })
  return { checks, skipped }
}

const planGradle = ({ dir, project }) => {
  const gradle = project.exists('gradlew') ? './gradlew' : 'gradle'
  const task = dir ? `:${dir.split('/').join(':')}:test` : 'test'
  return { checks: [{ name: 'test', cwd: '', scope: 'module', command: `${gradle} ${task}` }], skipped: [] }
}

const planMaven = ({ dir }) => ({ checks: [{ name: 'test', cwd: '', scope: 'module', command: dir ? `mvn -q -pl ${quote(dir)} test` : 'mvn -q test' }], skipped: [] })

const planPython = ({ dir, files, project }) => {
  const py = files.filter((path) => path.endsWith('.py')).map((path) => within({ dir, path }))
  if (py.length === 0) return { checks: [], skipped: [{ name: 'test', cwd: dir, reason: '바뀐 코드 파일이 없다' }] }
  const tests = py.filter((path) => /(^|\/)test_[^/]*\.py$|_test\.py$/.test(path))
  const checks = [{ name: 'test', cwd: dir, scope: tests.length > 0 ? 'related' : 'all', command: tests.length > 0 ? `python -m pytest ${join(tests)}` : 'python -m pytest' }]
  const skipped = []
  const mypy = project.exists(at(dir, 'mypy.ini')) || /\[tool\.mypy\]/.test(project.readText(at(dir, 'pyproject.toml')) ?? '')
  if (mypy) checks.push({ name: 'typecheck', cwd: dir, scope: 'related', command: `python -m mypy ${join(py)}` })
  else skipped.push({ name: 'typecheck', cwd: dir, reason: 'mypy 설정이 없다' })
  return { checks, skipped }
}

const planGo = ({ dir, files }) => {
  const pkgs = [...new Set(files.filter((path) => path.endsWith('.go')).map((path) => posix.dirname(within({ dir, path }))))].sort()
  if (pkgs.length === 0) return { checks: [], skipped: [{ name: 'test', cwd: dir, reason: '바뀐 코드 파일이 없다' }] }
  const targets = join(pkgs.map((pkg) => (pkg === '.' ? '.' : `./${pkg}`)))
  return {
    checks: [
      { name: 'test', cwd: dir, scope: 'related', command: `go test ${targets}` },
      { name: 'typecheck', cwd: dir, scope: 'related', command: `go vet ${targets}` },
    ],
    skipped: [],
  }
}

const PLANNERS = { 'package.json': planJs, 'build.gradle.kts': planGradle, 'build.gradle': planGradle, 'pom.xml': planMaven, 'pyproject.toml': planPython, 'go.mod': planGo }

/**
 * @param {{
 *   changed: { path: string, status: string }[],
 *   config: { finishCheck?: { commands?: { name: string, command: string, cwd?: string, timeoutMs?: number }[] } },
 *   harness: { checks?: { name: string, command: string, cwd?: string, timeoutMs?: number }[] } | null,
 *   project: { exists: (path: string) => boolean, readJson: (path: string) => any, readText: (path: string) => string | undefined },
 * }} args
 */
export const planChecks = ({ changed, config, harness, project }) => {
  const toCheck = (check, scope) => ({ name: check.name, cwd: check.cwd ?? '', scope, command: check.command, ...(check.timeoutMs ? { timeoutMs: check.timeoutMs } : {}) })

  const configured = config.finishCheck?.commands ?? []
  if (configured.length > 0) return { source: 'config', checks: configured.map((check) => toCheck(check, 'config')), skipped: [] }

  const fromHarness = (harness?.checks ?? []).filter((check) => check.command && !SELF.test(check.command))
  if (fromHarness.length > 0) return { source: 'harness', checks: fromHarness.map((check) => toCheck(check, 'harness')), skipped: [] }

  const existing = changed.filter((file) => file.status !== 'D').map((file) => file.path)
  if (existing.length === 0) return { source: 'detected', checks: [], skipped: [{ name: '전체', cwd: '', reason: '검사할 바뀐 파일이 없다' }] }

  const groups = new Map()
  const orphans = []
  for (const path of existing) {
    const found = markerDir({ path, project })
    if (!found) orphans.push(path)
    else {
      const key = `${found.dir}\0${found.marker}`
      groups.set(key, { ...found, files: [...(groups.get(key)?.files ?? []), path] })
    }
  }

  const checks = []
  const skipped = []
  for (const group of [...groups.values()].sort((a, b) => a.dir.localeCompare(b.dir))) {
    const planned = PLANNERS[group.marker]({ dir: group.dir, files: group.files, project })
    checks.push(...planned.checks)
    skipped.push(...planned.skipped)
  }
  if (orphans.length > 0) {
    skipped.push({ name: '테스트', cwd: '', reason: `바뀐 파일 ${orphans.length}개(${orphans.slice(0, 3).join(', ')})의 프로젝트 파일을 찾지 못했다 — .agents/gimi.json의 finishCheck.commands에 명령을 적는다` })
  }
  return { source: 'detected', checks, skipped }
}
