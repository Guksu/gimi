#!/usr/bin/env node
/**
 * 예제 저장소의 결함 PR(설계 결정 15·41) — 검사하고, 리뷰 평가용 임시 git 저장소로 만든다.
 *
 *   node scripts/defects.mjs check [ID…] [--no-tests]   패치가 붙는지, defect.json 형식·정답 위치, 잡는 테스트(정상 통과·결함 실패),
 *                                                        패턴 예시(evals/patterns/{패턴}.json — 좋은 예시는 결함 실패, 슬롭 예시는 결함 통과)
 *   node scripts/defects.mjs materialize <ID> <폴더>      main = 정상 버전, defect/<ID> = 결함 PR(체크아웃)
 *        --branch <이름>   결함 브랜치 이름(기본 defect/<ID>) — 리뷰 평가에서 결함 ID가 드러나지 않게
 *        --link-deps       예제 저장소의 node_modules를 링크한다(맥락 수집이 프로젝트의 typescript를 쓰게)
 *   node scripts/defects.mjs base <폴더>                  정상 버전만 — 새 결함 패치를 만들 때 쓴다
 *   공통: --fixture <폴더>(기본 evals/shop-fixture)
 *   check: --patterns <폴더>(기본 skills/gimi-test/patterns), --pattern-specs <폴더>(기본 evals/patterns — 예제 저장소가 기본일 때만.
 *          --fixture로 다른 저장소를 주면 --pattern-specs를 함께 줄 때만 패턴 예시를 본다)
 *
 * 잡는 테스트는 예제 저장소의 의존성(npm ci)과 PostgreSQL(npm run db:up)이 있어야 돌린다. 판단은 lib/defects.mjs가 맡는다.
 */
import { execFileSync, spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseRuleFile } from '../skills/gimi-review/scripts/lib/rulefile.mjs'
import { assetsFor, formatCheck, patchedPaths, runAssets, runCatches, validateDefect, validatePatternAssets } from './lib/defects.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BASE_MESSAGE = 'feat: 국수집 주문 앱'
// 작성자·시각을 고정해 같은 결함은 언제 만들어도 커밋 해시가 같다. 사용자의 전역 git 설정(서명·훅)은 읽지 않는다
const gitEnv = (date) => ({
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: '국수집 개발자',
  GIT_AUTHOR_EMAIL: 'dev@shop.test',
  GIT_COMMITTER_NAME: '국수집 개발자',
  GIT_COMMITTER_EMAIL: 'dev@shop.test',
  GIT_AUTHOR_DATE: date,
  GIT_COMMITTER_DATE: date,
})
const BASE_DATE = '2026-10-20T10:00:00+09:00'
const DEFECT_DATE = '2026-10-21T10:00:00+09:00'

const git = (cwd, args, date = BASE_DATE) => execFileSync('git', args, { cwd, env: gitEnv(date), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })

class UsageError extends Error {}

const parseArgs = (argv) => {
  const positional = []
  const defaultFixture = join(ROOT, 'evals/shop-fixture')
  const options = { fixture: defaultFixture, tests: true, patterns: join(ROOT, 'skills/gimi-test/patterns'), patternSpecs: null, branch: null, linkDeps: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--fixture') options.fixture = resolve(argv[++i] ?? '')
    else if (arg === '--patterns') options.patterns = resolve(argv[++i] ?? '')
    else if (arg === '--pattern-specs') options.patternSpecs = resolve(argv[++i] ?? '')
    else if (arg === '--no-tests') options.tests = false
    else if (arg === '--branch') options.branch = argv[++i] ?? ''
    else if (arg === '--link-deps') options.linkDeps = true
    else if (arg.startsWith('--')) throw new UsageError(`모르는 옵션: ${arg}`)
    else positional.push(arg)
  }
  // 패턴 예시 검증 설정은 gimi 예제 저장소 기준이다 — 다른 저장소에 대면 워크스페이스·결함이 맞지 않는다
  if (options.patternSpecs === null && options.fixture === defaultFixture) options.patternSpecs = join(ROOT, 'evals/patterns')
  return { command: positional[0], args: positional.slice(1), options }
}

/** 정상 버전의 파일 — git이 아는 파일(무시 목록 밖의 새 파일 포함)에서 defects/를 뺀다 */
const baseFiles = (fixture) =>
  git(fixture, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
    .split('\0')
    .filter((path) => path && !path.startsWith('defects/') && existsSync(join(fixture, path)))

const ensureEmpty = (dir) => {
  if (existsSync(dir) && readdirSync(dir).length > 0) throw new UsageError(`폴더가 비어 있지 않다: ${dir}`)
}

/** 정상 버전의 파일을 dir에 풀고 git 저장소로 만든다 — 커밋은 하지 않는다 */
const copyBase = (fixture, dir) => {
  ensureEmpty(dir)
  for (const path of baseFiles(fixture)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    copyFileSync(join(fixture, path), join(dir, path))
  }
  git(dir, ['init', '-q', '-b', 'main'])
}

const commitAll = (dir, message, date, body) => {
  git(dir, ['add', '-A'], date)
  git(dir, ['commit', '-q', '--no-verify', '-m', message, ...(body === undefined ? [] : ['-m', body])], date)
}

/** 정상 버전을 dir에 풀고 main에 커밋한다 */
const writeBase = (fixture, dir) => {
  copyBase(fixture, dir)
  commitAll(dir, BASE_MESSAGE, BASE_DATE)
}

// 이력 커밋의 시각 — 정상 버전 커밋(10:00)과 결함 커밋(다음 날) 사이에 한 시간씩
const historyDate = (index) => `2026-10-20T${String(11 + index).padStart(2, '0')}:00:00+09:00`

const applyPatch = (dir, patchPath, { reverse = false, what }) => {
  try {
    git(dir, ['apply', '--whitespace=nowarn', ...(reverse ? ['-R'] : []), patchPath])
  } catch (error) {
    throw new Error(`${what} — ${String(error.stderr ?? error.message).trim().split('\n')[0]}`)
  }
}

const readDefect = (fixture, id) => {
  const folder = join(fixture, 'defects', id)
  const json = JSON.parse(readFileSync(join(folder, 'defect.json'), 'utf8'))
  const patch = readFileSync(join(folder, 'change.patch'), 'utf8')
  return { json, patch, patchPath: join(folder, 'change.patch') }
}

/**
 * 결함 버전 — 정상 버전 위에 defect/<ID> 브랜치를 따고 패치를 PR 제목·본문으로 커밋한다.
 * 이력(history)이 있으면 정상 버전에서 이력 패치를 거꾸로 풀어 처음 상태를 커밋하고, 이력 패치를 차례로 다시 올려 main에 쌓는다.
 * 그래서 main의 마지막 상태는 언제나 정상 버전과 같다
 */
const materialize = (fixture, id, dir, { branch = `defect/${id}` } = {}) => {
  const { json, patchPath } = readDefect(fixture, id)
  const history = Array.isArray(json.history) ? json.history : []
  const historyPath = (commit) => join(fixture, 'defects', id, commit.patch ?? '')
  copyBase(fixture, dir)
  for (let index = history.length - 1; index >= 0; index--) {
    applyPatch(dir, historyPath(history[index]), { reverse: true, what: `이력 패치가 정상 버전에서 거꾸로 붙지 않는다 — history ${index + 1}` })
  }
  commitAll(dir, BASE_MESSAGE, BASE_DATE)
  history.forEach((commit, index) => {
    applyPatch(dir, historyPath(commit), { what: `이력 패치가 다시 붙지 않는다 — history ${index + 1}` })
    commitAll(dir, commit.message, historyDate(index))
  })
  git(dir, ['checkout', '-q', '-b', branch])
  applyPatch(dir, patchPath, { what: '패치가 정상 버전에 붙지 않는다' })
  commitAll(dir, json.pr?.title ?? id, DEFECT_DATE, json.pr?.body ?? '')
}

/** 그 버전에서 파일의 줄 수 — 없거나 저장소 밖을 가리키면 null */
const linesIn = (dir) => (path) => {
  if (typeof path !== 'string' || isAbsolute(path) || normalize(path).startsWith('..')) return null
  const file = join(dir, path)
  if (!existsSync(file)) return null
  const text = readFileSync(file, 'utf8')
  return text === '' ? 0 : text.replace(/\n$/, '').split('\n').length
}

const workspacesOf = (fixture) => JSON.parse(readFileSync(join(fixture, 'package.json'), 'utf8')).workspaces ?? []

/**
 * 예제 저장소의 node_modules를 복사본에 링크한다 — 루트와 워크스페이스마다. 워크스페이스 링크(../server)는 상대 경로 그대로 둬서
 * 복사본의 워크스페이스를 가리키게 한다. Vite 캐시(.vite·.vite-temp)는 링크하지 않는다(설정 파일을 복사본에서 다시 묶는다)
 */
const linkNodeModules = (fixture, dir) => {
  for (const folder of ['.', ...workspacesOf(fixture)]) {
    const from = join(fixture, folder, 'node_modules')
    if (!existsSync(from)) continue
    const to = join(dir, folder, 'node_modules')
    mkdirSync(to, { recursive: true })
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      if (entry.name === '.vite' || entry.name === '.vite-temp') continue
      const source = join(from, entry.name)
      symlinkSync(entry.isSymbolicLink() ? readlinkSync(source) : source, join(to, entry.name))
    }
  }
}

/** 예제 저장소의 vitest·tsc를 돌린다 — 출력은 outputs에 `${cwd}\0${file}`(tsc는 file이 'tsc')로 남긴다 */
const runners = (fixture, outputs) => {
  const vitest = join(fixture, 'node_modules/vitest/vitest.mjs')
  const tsc = join(fixture, 'node_modules/typescript/bin/tsc')
  if (!existsSync(vitest) || !existsSync(tsc)) throw new UsageError(`예제 저장소에 의존성이 없다 — ${fixture}에서 npm ci를 먼저 돌린다(또는 --no-tests)`)
  const exec = (cwd, key, args) =>
    new Promise((done) => {
      const child = spawn(process.execPath, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
      let output = ''
      child.stdout.on('data', (chunk) => (output += chunk))
      child.stderr.on('data', (chunk) => (output += chunk))
      child.on('close', (code) => {
        outputs.set(`${cwd}\0${key}`, output)
        done(code ?? 1)
      })
    })
  return {
    run: ({ cwd, file }) => exec(cwd, file, [vitest, 'run', file]),
    typecheck: ({ cwd }) => exec(cwd, 'tsc', [tsc, '-p', 'tsconfig.json']),
  }
}

const printTail = ({ id, label, output }) => {
  const tail = (output ?? '').trimEnd().split('\n').slice(-30)
  process.stderr.write(`--- ${id} ${label} ---\n${tail.join('\n')}\n`)
}

/**
 * 패턴 예시 검증 설정을 읽어 검사한다 — 오류가 없는 설정만 돌린다
 * @returns {{ specs: any[], errors: string[] }}
 */
const loadPatternSpecs = ({ fixture, patterns, patternSpecs, defectIds }) => {
  const files = patternSpecs && existsSync(patternSpecs) ? readdirSync(patternSpecs).filter((name) => name.endsWith('.json')).sort() : []
  const assetsOf = (pattern) => {
    if (typeof pattern !== 'string' || !existsSync(join(patterns, pattern, 'PATTERN.md'))) return null
    const dir = join(patterns, pattern, 'assets')
    return existsSync(dir) ? readdirSync(dir).sort() : []
  }
  const specs = []
  const errors = []
  for (const name of files) {
    const file = relative(ROOT, join(patternSpecs, name))
    let spec
    try {
      spec = JSON.parse(readFileSync(join(patternSpecs, name), 'utf8'))
    } catch (error) {
      errors.push(`${file}: 읽지 못했다 — ${error.message}`)
      continue
    }
    const found = validatePatternAssets({ file, spec, assetsOf, defectIds, workspaces: workspacesOf(fixture), baseHas: (path) => existsSync(join(fixture, path)) })
    if (spec.pattern !== name.replace(/\.json$/, '')) found.push(`${file}: 파일 이름과 pattern(${spec.pattern})이 다르다`)
    errors.push(...found)
    if (found.length === 0) specs.push(spec)
  }
  return { specs, errors }
}

const ruleIds = () => {
  const ids = new Set()
  const shared = join(ROOT, 'skills/gimi-review/shared')
  const files = [
    ...readdirSync(join(shared, 'rules')).filter((name) => name.endsWith('.md')).map((name) => join(shared, 'rules', name)),
    ...readdirSync(join(shared, 'domains')).map((name) => join(shared, 'domains', name, 'rules.md')).filter(existsSync),
  ]
  for (const file of files) for (const rule of parseRuleFile(readFileSync(file, 'utf8')).rules) ids.add(rule.id)
  return ids
}

const checkOne = async ({ fixture, id, ids, tests, patterns, assets }) => {
  const result = { id, defect: null, errors: [], catches: null, assets: null }
  let loaded
  try {
    loaded = readDefect(fixture, id)
    result.defect = loaded.json
  } catch (error) {
    result.errors.push(`defect.json·change.patch를 읽지 못했다 — ${error.message}`)
    return result
  }
  const tmp = mkdtempSync(join(tmpdir(), 'gimi-defect-'))
  try {
    const patched = join(tmp, 'defect')
    const base = join(tmp, 'base')
    try {
      materialize(fixture, id, patched)
    } catch (error) {
      result.errors.push(error.message)
      return result
    }
    git(patched, ['worktree', 'add', '-q', base, 'main'])
    result.errors.push(
      ...validateDefect({ dir: id, json: loaded.json, ruleIds: ids, patchedLines: linesIn(patched), baseLines: linesIn(base), touched: patchedPaths(loaded.patch) }),
    )
    const catches = Array.isArray(loaded.json.catches) ? loaded.json.catches : []
    if (!tests || result.errors.length > 0) return result
    result.catches = []
    if (catches.length === 0 && assets.length === 0) return result
    linkNodeModules(fixture, base)
    linkNodeModules(fixture, patched)
    const outputs = new Map()
    const { run, typecheck } = runners(fixture, outputs)
    const outputOf = (dir, path, key) => outputs.get(`${dir}/${path.split('/')[0]}\0${key ?? path.split('/').slice(1).join('/')}`)
    if (catches.length > 0) {
      result.catches = await runCatches({ base, patched, catches, run })
      for (const failed of result.catches.filter((r) => !r.ok)) {
        result.errors.push(failed.error)
        // 정상 버전에서 실패했으면 그 출력의 끝을 보인다
        if (failed.base !== 0) printTail({ id, label: `${failed.path} (정상 버전)`, output: outputOf(base, failed.path) })
      }
    }
    if (assets.length > 0) {
      // 패턴 예시는 정본(skills/gimi-test/patterns)을 두 버전의 at 자리에 복사해 돌린다 — 예제 저장소에는 복사본을 두지 않는다(설계 결정 30)
      for (const dir of [base, patched]) {
        for (const asset of assets) {
          mkdirSync(dirname(join(dir, asset.at)), { recursive: true })
          copyFileSync(join(patterns, asset.pattern, 'assets', asset.file), join(dir, asset.at))
        }
      }
      result.assets = await runAssets({ base, patched, assets, run, typecheck })
      for (const failed of result.assets.filter((r) => !r.ok)) {
        result.errors.push(failed.error)
        if (failed.kind === 'typecheck') printTail({ id, label: `${failed.path} 타입 검사 (정상 버전)`, output: outputOf(base, `${failed.path}/`, 'tsc') })
        else if (failed.base !== 0) printTail({ id, label: `${failed.path} (정상 버전)`, output: outputOf(base, failed.path) })
        else if (failed.kind === 'slop') printTail({ id, label: `${failed.path} (결함 버전)`, output: outputOf(patched, failed.path) })
      }
    }
    return result
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

const check = async ({ fixture, ids: selected, tests, patterns, patternSpecs }) => {
  const folder = join(fixture, 'defects')
  const all = existsSync(folder) ? readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort() : []
  const unknown = selected.filter((id) => !all.includes(id))
  if (unknown.length > 0) throw new UsageError(`없는 결함: ${unknown.join(', ')} (있는 것: ${all.join(', ') || '없음'})`)
  const ids = ruleIds()
  const loaded = loadPatternSpecs({ fixture, patterns, patternSpecs, defectIds: new Set(all) })
  const results = []
  for (const id of selected.length > 0 ? selected : all) results.push(await checkOne({ fixture, id, ids, tests, patterns, assets: assetsFor(loaded.specs, id) }))
  console.log(formatCheck(results, { tests, setupErrors: loaded.errors }))
  return results.some((result) => result.errors.length > 0) || loaded.errors.length > 0 ? 1 : 0
}

const main = async () => {
  const { command, args, options } = parseArgs(process.argv.slice(2))
  if (command === 'check') return check({ fixture: options.fixture, ids: args, tests: options.tests, patterns: options.patterns, patternSpecs: options.patternSpecs })
  if (command === 'materialize' && args.length === 2) {
    const dir = resolve(args[1])
    const branch = options.branch || `defect/${args[0]}`
    if (!/^[\w./-]+$/.test(branch)) throw new UsageError(`브랜치 이름이 틀렸다: ${branch}`)
    ensureEmpty(dir)
    materialize(options.fixture, args[0], dir, { branch })
    if (options.linkDeps) linkNodeModules(options.fixture, dir)
    console.log(`${dir}\n  main = 정상 버전\n  ${branch} = 결함 PR(체크아웃됨) — 리뷰 범위는 main...${branch}`)
    return 0
  }
  if (command === 'base' && args.length === 1) {
    const dir = resolve(args[0])
    writeBase(options.fixture, dir)
    console.log(`${dir}\n  main = 정상 버전 — 고친 뒤 git diff > defects/<ID>/change.patch`)
    return 0
  }
  throw new UsageError('사용법: defects.mjs check [ID…] [--no-tests] [--patterns <폴더>] [--pattern-specs <폴더>] | materialize <ID> <폴더> [--branch <이름>] [--link-deps] | base <폴더>  [--fixture <폴더>]')
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof UsageError ? error.message : error.stack)
    process.exit(error instanceof UsageError ? 1 : 2)
  },
)
