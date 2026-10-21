#!/usr/bin/env node
/**
 * 예제 저장소의 결함 PR(설계 결정 15·41) — 검사하고, 리뷰 평가용 임시 git 저장소로 만든다.
 *
 *   node scripts/defects.mjs check [ID…] [--no-tests]   패치가 붙는지, defect.json 형식·정답 위치, 잡는 테스트(정상 통과·결함 실패)
 *   node scripts/defects.mjs materialize <ID> <폴더>      main = 정상 버전, defect/<ID> = 결함 PR(체크아웃)
 *   node scripts/defects.mjs base <폴더>                  정상 버전만 — 새 결함 패치를 만들 때 쓴다
 *   공통: --fixture <폴더>(기본 evals/shop-fixture)
 *
 * 잡는 테스트는 예제 저장소의 의존성(npm ci)과 PostgreSQL(npm run db:up)이 있어야 돌린다. 판단은 lib/defects.mjs가 맡는다.
 */
import { execFileSync, spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseRuleFile } from '../skills/gimi-review/scripts/lib/rulefile.mjs'
import { formatCheck, patchedPaths, runCatches, validateDefect } from './lib/defects.mjs'

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
  const options = { fixture: join(ROOT, 'evals/shop-fixture'), tests: true }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--fixture') options.fixture = resolve(argv[++i] ?? '')
    else if (arg === '--no-tests') options.tests = false
    else if (arg.startsWith('--')) throw new UsageError(`모르는 옵션: ${arg}`)
    else positional.push(arg)
  }
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

/** 정상 버전을 dir에 풀고 main에 커밋한다 */
const writeBase = (fixture, dir) => {
  ensureEmpty(dir)
  for (const path of baseFiles(fixture)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    copyFileSync(join(fixture, path), join(dir, path))
  }
  git(dir, ['init', '-q', '-b', 'main'])
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '--no-verify', '-m', BASE_MESSAGE])
}

const readDefect = (fixture, id) => {
  const folder = join(fixture, 'defects', id)
  const json = JSON.parse(readFileSync(join(folder, 'defect.json'), 'utf8'))
  const patch = readFileSync(join(folder, 'change.patch'), 'utf8')
  return { json, patch, patchPath: join(folder, 'change.patch') }
}

/** 결함 버전 — 정상 버전 위에 defect/<ID> 브랜치를 따고 패치를 PR 제목·본문으로 커밋한다 */
const materialize = (fixture, id, dir) => {
  const { json, patchPath } = readDefect(fixture, id)
  writeBase(fixture, dir)
  git(dir, ['checkout', '-q', '-b', `defect/${id}`])
  try {
    git(dir, ['apply', '--whitespace=nowarn', patchPath])
  } catch (error) {
    throw new Error(`패치가 정상 버전에 붙지 않는다 — ${String(error.stderr ?? error.message).trim().split('\n')[0]}`)
  }
  git(dir, ['add', '-A'], DEFECT_DATE)
  git(dir, ['commit', '-q', '--no-verify', '-m', json.pr?.title ?? id, '-m', json.pr?.body ?? ''], DEFECT_DATE)
}

/** 그 버전에서 파일의 줄 수 — 없거나 저장소 밖을 가리키면 null */
const linesIn = (dir) => (path) => {
  if (typeof path !== 'string' || isAbsolute(path) || normalize(path).startsWith('..')) return null
  const file = join(dir, path)
  if (!existsSync(file)) return null
  const text = readFileSync(file, 'utf8')
  return text === '' ? 0 : text.replace(/\n$/, '').split('\n').length
}

/**
 * 예제 저장소의 node_modules를 복사본에 링크한다 — 루트와 워크스페이스마다. 워크스페이스 링크(../server)는 상대 경로 그대로 둬서
 * 복사본의 워크스페이스를 가리키게 한다. Vite 캐시(.vite·.vite-temp)는 링크하지 않는다(설정 파일을 복사본에서 다시 묶는다)
 */
const linkNodeModules = (fixture, dir) => {
  const workspaces = JSON.parse(readFileSync(join(fixture, 'package.json'), 'utf8')).workspaces ?? []
  for (const folder of ['.', ...workspaces]) {
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

const vitestRunner = (fixture, outputs) => {
  const entry = join(fixture, 'node_modules/vitest/vitest.mjs')
  if (!existsSync(entry)) throw new UsageError(`예제 저장소에 의존성이 없다 — ${fixture}에서 npm ci를 먼저 돌린다(또는 --no-tests)`)
  return ({ cwd, file }) =>
    new Promise((done) => {
      const child = spawn(process.execPath, [entry, 'run', file], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
      let output = ''
      child.stdout.on('data', (chunk) => (output += chunk))
      child.stderr.on('data', (chunk) => (output += chunk))
      child.on('close', (code) => {
        outputs.set(`${cwd}\0${file}`, output)
        done(code ?? 1)
      })
    })
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

const checkOne = async ({ fixture, id, ids, tests }) => {
  const result = { id, defect: null, errors: [], catches: null }
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
    if (tests && result.errors.length === 0 && catches.length > 0) {
      linkNodeModules(fixture, base)
      linkNodeModules(fixture, patched)
      const outputs = new Map()
      result.catches = await runCatches({ base, patched, catches, run: vitestRunner(fixture, outputs) })
      for (const run of result.catches.filter((r) => !r.ok)) {
        result.errors.push(run.error)
        // 정상 버전에서 실패했으면 그 출력의 끝을 보인다
        if (run.base !== 0) {
          const [workspace, ...rest] = run.path.split('/')
          const tail = (outputs.get(`${base}/${workspace}\0${rest.join('/')}`) ?? '').trimEnd().split('\n').slice(-30)
          process.stderr.write(`--- ${id} ${run.path} (정상 버전) ---\n${tail.join('\n')}\n`)
        }
      }
    } else if (tests) result.catches = []
    return result
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

const check = async ({ fixture, ids: selected, tests }) => {
  const folder = join(fixture, 'defects')
  const all = existsSync(folder) ? readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort() : []
  const unknown = selected.filter((id) => !all.includes(id))
  if (unknown.length > 0) throw new UsageError(`없는 결함: ${unknown.join(', ')} (있는 것: ${all.join(', ') || '없음'})`)
  const ids = ruleIds()
  const results = []
  for (const id of selected.length > 0 ? selected : all) results.push(await checkOne({ fixture, id, ids, tests }))
  console.log(formatCheck(results, { tests }))
  return results.some((result) => result.errors.length > 0) ? 1 : 0
}

const main = async () => {
  const { command, args, options } = parseArgs(process.argv.slice(2))
  if (command === 'check') return check({ fixture: options.fixture, ids: args, tests: options.tests })
  if (command === 'materialize' && args.length === 2) {
    const dir = resolve(args[1])
    ensureEmpty(dir)
    materialize(options.fixture, args[0], dir)
    console.log(`${dir}\n  main = 정상 버전\n  defect/${args[0]} = 결함 PR(체크아웃됨) — 리뷰 범위는 main...defect/${args[0]}`)
    return 0
  }
  if (command === 'base' && args.length === 1) {
    const dir = resolve(args[0])
    writeBase(options.fixture, dir)
    console.log(`${dir}\n  main = 정상 버전 — 고친 뒤 git diff > defects/<ID>/change.patch`)
    return 0
  }
  throw new UsageError('사용법: defects.mjs check [ID…] [--no-tests] | materialize <ID> <폴더> | base <폴더>  [--fixture <폴더>]')
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof UsageError ? error.message : error.stack)
    process.exit(error instanceof UsageError ? 1 : 2)
  },
)
