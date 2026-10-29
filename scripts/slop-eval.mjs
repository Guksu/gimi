#!/usr/bin/env node
/**
 * 슬롭 금지선 측정(설계 결정 16·34·49) — 같은 요청을 gimi 없이·있이 실행하고, 금지선 줄이 몇 번의 실행에 나왔는지 센다.
 *
 *   node scripts/slop-eval.mjs run [ID…] --arm without|with [--runs N | --run N] [--model M] [--out <폴더>] [--claude <실행 파일>]
 *        요청마다 정상 버전 저장소를 만들어 claude -p로 실행한다. 끝나면 diff를 남기고 끝내기 전 검사(check.mjs --json)를 돌린다.
 *        실행 기록(stream-json)에서 에이전트가 돌린 Bash 명령과 결과를 남긴다(완료 보고 줄의 판정 근거).
 *        두 쪽에 같은 지시를 주고, gimi 있이만 --plugin-dir로 이 저장소를 받는다. 실행은 하나씩 한다(테스트 DB를 함께 쓴다).
 *        --run N은 그 번째 실행 하나만 다시 돌린다(다른 일이 테스트 DB를 건드려 망친 실행을 바꿀 때)
 *   node scripts/slop-eval.mjs judge <폴더> [--areas test,code,done] [--model M] [--claude <실행 파일>]
 *        실행마다 판정 모델(도구 없음)이 diff·보고·돌린 명령을 읽고, 검사가 error·warn만이 아닌 금지선 줄을 고른다. 판정한 실행은 건너뛴다.
 *        --areas는 그 영역의 줄만 판정한다. --reviews는 <폴더>를 리뷰 평가(scripts/review-eval.mjs run)의 결과로 읽고 리뷰 줄을 판정한다
 *        (내장 /code-review가 gimi 없이, gimi-review가 gimi 있이 — PR·이슈·패치는 --fixture의 결함 폴더에서)
 *   node scripts/slop-eval.mjs score <폴더> [--areas …] [--rejected <파일>] [--results <파일>] [--date YYYY-MM-DD]
 *        줄마다 "N번 중 M번" 표(<폴더>/score.md). --rejected는 사람이 읽고 틀렸다고 걸러 낸 지적(세지 않는다),
 *        --results는 규칙 파일에 옮길 측정 결과 파일을 쓴다. --areas는 그 영역의 줄만 센다(결과 파일에 영역을 남긴다)
 *   node scripts/slop-eval.mjs apply <결과 파일> [--root <폴더>]
 *        원본 규칙 파일(test·done은 gimi-test, code는 gimi-review)의 근거를 "N번 중 M번"으로 바꾸고 다른 스킬의 복사본에 옮긴다.
 *        결과 파일에 영역이 있으면 그 영역의 파일만 바꾼다.
 *        SKILL.md의 금지선 표는 scripts/buildSlopTable.mjs가 다시 쓴다
 *   공통: --fixture <폴더>(기본 evals/shop-fixture), --requests <파일>(기본 evals/slop/requests.json)
 *
 * 공정하게 — 사용자 설정·플러그인·MCP는 읽지 않는다(--setting-sources project, --strict-mcp-config). 폴더 이름에 요청 ID를 넣지 않는다.
 * 판단은 scripts/lib/slop-eval.mjs가 맡는다.
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseRuleFile } from '../skills/gimi-test/scripts/lib/rulefile.mjs'
import { ARMS, formatSlopScore, judgePrompt, judgedRules, parseJudgement, reviewJudgePrompt, scoreSlop, slopResults } from './lib/slop-eval.mjs'
import { parseStream } from './lib/stream.mjs'
import { applyEvidence } from './lib/slop-table.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')
const DEFECTS = join(ROOT, 'scripts/defects.mjs')
const CHECK = join(ROOT, 'skills/gimi-test/scripts/check.mjs')
const RULE_AREAS = ['test', 'code', 'done', 'review']
// 기본으로 세는 영역 — 구현 실행은 테스트·코드·완료 보고 줄, 리뷰 실행(--reviews)은 리뷰 줄
const DEFAULT_AREAS = { runs: ['test', 'code', 'done'], reviews: ['review'] }
// 리뷰 평가의 리뷰어 → 측정 쪽. 내장 /code-review가 gimi 없이다
const REVIEW_ARMS = { 'code-review': 'without', gimi: 'with' }
// 규칙 파일의 원본 — 영역 주인(설계 7절). 다른 스킬에는 바이트가 같은 복사본이 있다
const RULE_ORIGIN = { test: 'gimi-test', done: 'gimi-test', code: 'gimi-review', review: 'gimi-review' }
const OTHER_SKILL = { 'gimi-test': 'gimi-review', 'gimi-review': 'gimi-test' }
const RUN_TIMEOUT_MS = 30 * 60 * 1000
const CHECK_TIMEOUT_MS = 15 * 60 * 1000
// 두 쪽 모두 같은 gimi 설정을 둔다 — gimi를 설치한 프로젝트처럼. gimi 없이 쪽에는 읽는 것이 없어 영향이 없다
const GIMI_CONFIG = { stacks: ['frontend-ts', 'backend'], presets: ['commerce'] }
// 두 쪽에 똑같이 덧붙이는 지시 — 사람 없이 한 번에 끝내게 한다
const RUN_INSTRUCTION = [
  '이 세션은 사람 없이 한 번에 끝낸다. 질문하지 말고 요청에 맞게 정해서 구현한다.',
  '마지막에 무엇을 바꿨고 무엇을 확인했는지 보고한다. 새 패키지는 설치하지 않는다. 커밋하지 않는다.',
].join('\n')
// 구현에 쓰는 도구 — 파일 읽기·쓰기와, Bash는 허용 목록의 명령만(묻지 않고 막는다).
// 읽기 명령·git 읽기·테스트와 타입 검사·이 저장소의 gimi 스크립트. 임의 실행(node -e)·설치·DB를 내리는 npm run db:down은 목록에 없다
const BASH_COMMANDS = [
  ...['ls', 'cat', 'head', 'tail', 'wc', 'grep', 'sed -n', 'sort', 'echo', 'pwd', 'cd'],
  ...['status', 'diff', 'log', 'show', 'blame', 'ls-files'].map((sub) => `git ${sub}`),
  ...['npm test', 'npm run test', 'npm run typecheck', 'npm run generate:api', 'npx vitest', 'npx tsc'],
  `node ${ROOT}/skills/`,
]
const ALLOWED_TOOLS = ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Skill', 'Agent', 'TodoWrite', ...BASH_COMMANDS.map((command) => (command.endsWith('/') ? `Bash(${command}*)` : `Bash(${command} *)`))]
// 허용 목록 밖이라 이미 막히지만, 의존성(예제 저장소에 링크된 node_modules)과 테스트 DB를 건드리는 명령은 이름으로도 막는다.
// 막는 규칙이 허용 규칙보다 먼저라, 허용한 명령(npx vitest 등)을 덮는 넓은 이름은 두지 않는다
const DISALLOWED_TOOLS = ['npm install', 'npm i', 'npm ci', 'npm uninstall', 'npm run db:up', 'npm run db:down'].map((command) => `Bash(${command} *)`)
const GIT = ['-c', 'commit.gpgsign=false', '-c', 'user.name=gimi-eval', '-c', 'user.email=eval@gimi.invalid']

class UsageError extends Error {}

const parseArgs = (argv) => {
  const positional = []
  const options = { fixture: join(ROOT, 'evals/shop-fixture'), requests: join(ROOT, 'evals/slop/requests.json'), out: null, arm: null, runs: 1, only: null, model: null, claude: 'claude', rejected: null, results: null, date: new Date().toISOString().slice(0, 10), root: ROOT, areas: null, reviews: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => {
      const next = argv[++i]
      if (next === undefined || next.startsWith('--')) throw new UsageError(`${arg}에 값이 없다`)
      return next
    }
    if (arg === '--fixture') options.fixture = resolve(value())
    else if (arg === '--requests') options.requests = resolve(value())
    else if (arg === '--out') options.out = resolve(value())
    else if (arg === '--arm') options.arm = value()
    else if (arg === '--runs') options.runs = Number(value())
    else if (arg === '--run') options.only = Number(value())
    else if (arg === '--model') options.model = value()
    else if (arg === '--claude') options.claude = value()
    else if (arg === '--rejected') options.rejected = resolve(value())
    else if (arg === '--results') options.results = resolve(value())
    else if (arg === '--date') options.date = value()
    else if (arg === '--root') options.root = resolve(value())
    else if (arg === '--reviews') options.reviews = true
    else if (arg === '--areas') options.areas = value().split(',').map((area) => area.trim()).filter(Boolean)
    else if (arg.startsWith('--')) throw new UsageError(`모르는 옵션: ${arg}`)
    else positional.push(arg)
  }
  return { command: positional[0], args: positional.slice(1), options }
}

const loadRequests = (file) => JSON.parse(readFileSync(file, 'utf8')).requests
const pick = (requests, ids) => {
  const unknown = ids.filter((id) => !requests.some((request) => request.id === id))
  if (unknown.length > 0) throw new UsageError(`없는 요청: ${unknown.join(', ')}`)
  return ids.length > 0 ? requests.filter((request) => ids.includes(request.id)) : requests
}
const checkAreas = (areas, fallback = RULE_AREAS) => {
  const unknown = (areas ?? []).filter((area) => !RULE_AREAS.includes(area))
  if (areas?.length === 0 || unknown.length > 0) throw new UsageError(`--areas는 ${RULE_AREAS.join('·')} 중에서 고른다: ${unknown.join(', ')}`)
  return areas ?? fallback
}
const areasOf = (options) => checkAreas(options.areas, DEFAULT_AREAS[options.reviews ? 'reviews' : 'runs'])
const loadRules = (areas = RULE_AREAS) =>
  areas.flatMap((area) => parseRuleFile(readFileSync(join(ROOT, 'skills/gimi-test/shared/rules', `${area}.md`), 'utf8')).rules.map((rule) => ({ ...rule, area })))

const spawnText = ({ command, args, cwd, input = null, timeoutMs }) =>
  new Promise((done) => {
    const started = Date.now()
    const child = spawn(command, args, { cwd, stdio: [input === null ? 'ignore' : 'pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs)
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    if (input !== null) child.stdin.end(input)
    child.on('close', (code) => {
      clearTimeout(timer)
      done({ code: code ?? 1, stdout, stderr, durationMs: Date.now() - started })
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      done({ code: 127, stdout, stderr: String(error), durationMs: Date.now() - started })
    })
  })
const parseResult = (stdout) => {
  try {
    return JSON.parse(stdout)
  } catch {
    return null
  }
}

/** 측정 저장소 — 이름이 중립인 임시 폴더에 정상 버전과 gimi 설정을 커밋하고, 예제 저장소의 의존성을 링크한다 */
const prepare = (fixture) => {
  const holder = mkdtempSync(join(tmpdir(), 'shop-'))
  const repo = join(holder, 'shop')
  execFileSync(process.execPath, [DEFECTS, 'base', repo, '--fixture', fixture, '--link-deps'], { stdio: ['ignore', 'pipe', 'pipe'] })
  mkdirSync(join(repo, '.agents'), { recursive: true })
  writeFileSync(join(repo, '.agents/gimi.json'), `${JSON.stringify(GIMI_CONFIG, null, 2)}\n`)
  const git = (...args) => execFileSync('git', [...GIT, ...args], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
  git('add', '-A')
  git('commit', '-q', '-m', 'chore: gimi 설정')
  return { holder, repo, git, base: git('rev-parse', 'HEAD').trim() }
}

/** 실행 뒤 — 바뀐 것을 feature/work에 커밋하고 main을 실행 전으로 돌려 놓는다(에이전트가 커밋했어도 diff가 남게) */
const collect = ({ git, base }) => {
  git('add', '-A')
  const patch = git('diff', '--cached', base)
  git('switch', '-q', '-c', 'feature/work')
  if (patch.trim()) git('commit', '-q', '--no-verify', '-m', '작업')
  git('branch', '-f', 'main', base)
  return patch
}

const runAll = async ({ options, ids }) => {
  if (!ARMS[options.arm]) throw new UsageError(`--arm은 ${Object.keys(ARMS).join('·')} 중 하나다`)
  if (!Number.isInteger(options.runs) || options.runs < 1) throw new UsageError('--runs는 1 이상의 정수다')
  if (options.only !== null && (!Number.isInteger(options.only) || options.only < 1)) throw new UsageError('--run은 1 이상의 정수다')
  const numbers = options.only !== null ? [options.only] : Array.from({ length: options.runs }, (_, i) => i + 1)
  const out = options.out ?? join(ROOT, 'evals/slop/runs', new Date().toISOString().slice(0, 10))
  const folder = join(out, options.arm)
  mkdirSync(folder, { recursive: true })
  for (const request of pick(loadRequests(options.requests), ids)) {
    for (const n of numbers) {
      const { holder, repo, git, base } = prepare(options.fixture)
      const args = [
        '-p',
        request.prompt,
        // 돌린 명령을 남기려고 stream-json으로 받는다 — print 모드에서는 --verbose가 있어야 나온다
        '--output-format',
        'stream-json',
        '--verbose',
        '--no-session-persistence',
        '--setting-sources',
        'project',
        '--strict-mcp-config',
        '--permission-mode',
        'dontAsk',
        '--allowedTools',
        ALLOWED_TOOLS.join(' '),
        '--disallowedTools',
        DISALLOWED_TOOLS.join(' '),
        '--append-system-prompt',
        RUN_INSTRUCTION,
        ...(options.model ? ['--model', options.model] : []),
        // gimi 있이 — 플러그인으로 받고, 스킬이 자기 패턴·규칙 파일을 읽을 수 있게 스킬 폴더를 연다
        ...(options.arm === 'with' ? ['--plugin-dir', ROOT, '--add-dir', join(ROOT, 'skills')] : []),
      ]
      try {
        const result = await spawnText({ command: options.claude, args, cwd: repo, timeoutMs: RUN_TIMEOUT_MS })
        const { result: parsed, commands } = parseStream(result.stdout)
        const patch = collect({ git, base })
        const checked = await spawnText({ command: process.execPath, args: [CHECK, '--json', '--base', 'main'], cwd: repo, timeoutMs: CHECK_TIMEOUT_MS })
        const record = {
          arm: options.arm,
          request: request.id,
          run: n,
          model: options.model ?? '(기본)',
          prompt: request.prompt,
          tools: { allowed: ALLOWED_TOOLS, disallowed: DISALLOWED_TOOLS },
          exitCode: result.code,
          durationMs: parsed?.duration_ms ?? result.durationMs,
          costUsd: parsed?.total_cost_usd ?? null,
          numTurns: parsed?.num_turns ?? null,
          output: parsed?.result ?? result.stdout.slice(-4000),
          commands,
          permissionDenials: (parsed?.permission_denials ?? []).map((denial) => ({ tool: denial.tool_name, input: typeof denial.tool_input?.command === 'string' ? denial.tool_input.command : JSON.stringify(denial.tool_input ?? {}) })),
          stderr: result.stderr.slice(-4000),
          check: parseResult(checked.stdout),
          checkError: parseResult(checked.stdout) ? null : `${checked.stdout}${checked.stderr}`.slice(-4000),
        }
        writeFileSync(join(folder, `${request.id}-${n}.patch`), patch)
        writeFileSync(join(folder, `${request.id}-${n}.json`), `${JSON.stringify(record, null, 2)}\n`)
        const slop = record.check?.slop?.findings?.length ?? '?'
        console.log(`${ARMS[options.arm]} ${request.id} #${n} — 종료 코드 ${result.code}, ${Math.round(record.durationMs / 1000)}초${record.costUsd === null ? '' : `, $${record.costUsd.toFixed(2)}`}, 자동 검사 슬롭 ${slop}`)
      } finally {
        rmSync(holder, { recursive: true, force: true })
      }
    }
  }
  return 0
}

// 실행 결과 — 구현 실행은 <폴더>/{without,with}, 리뷰 실행(--reviews)은 리뷰 평가의 <폴더>/{code-review,gimi}(요청 = 결함 ID)
const recordsIn = (dir, { reviews = false } = {}) =>
  Object.entries(reviews ? REVIEW_ARMS : Object.fromEntries(Object.keys(ARMS).map((arm) => [arm, arm])))
    .filter(([folder]) => existsSync(join(dir, folder)))
    .flatMap(([folder, arm]) =>
      readdirSync(join(dir, folder))
        .filter((name) => /^[\w-]+-\d+\.json$/.test(name) && !name.endsWith('.judge.json'))
        .map((name) => {
          const record = JSON.parse(readFileSync(join(dir, folder, name), 'utf8'))
          return { arm, name, path: join(dir, folder, name), record: reviews ? { ...record, arm, request: record.id } : record }
        }),
    )
    .sort((a, b) => a.record.request.localeCompare(b.record.request) || a.arm.localeCompare(b.arm) || a.record.run - b.record.run)

/** 리뷰 실행 하나의 판정 지시 — 결함 PR(제목·본문·이슈·패치)은 예제 저장소에서, gimi의 리뷰 기록은 실행 옆에 복사해 둔 docs/gimi/reviews에서 읽는다 */
const reviewPrompt = ({ path, record, fixture, rules }) => {
  const folder = join(fixture, 'defects', record.id)
  const defect = JSON.parse(readFileSync(join(folder, 'defect.json'), 'utf8'))
  const reviews = join(path.replace(/\.json$/, ''), 'docs/gimi/reviews')
  const files = existsSync(reviews) ? readdirSync(reviews).filter((name) => name.endsWith('.md')).sort() : []
  const recordText = files.map((name) => readFileSync(join(reviews, name), 'utf8')).join('\n')
  return reviewJudgePrompt({ pr: defect.pr, issues: defect.issues ?? [], patch: readFileSync(join(folder, 'change.patch'), 'utf8'), review: record.output, commands: record.commands ?? null, record: recordText || null, rules })
}

const judgeAll = async ({ dir, options }) => {
  if (!dir || !existsSync(dir)) throw new UsageError(`결과 폴더가 없다: ${dir}`)
  const rules = judgedRules(loadRules(areasOf(options)))
  const ids = rules.map((rule) => rule.id)
  for (const { path, record } of recordsIn(dir, options)) {
    const target = path.replace(/\.json$/, '.judge.json')
    if (existsSync(target)) continue
    const prompt = options.reviews ? reviewPrompt({ path, record, fixture: options.fixture, rules }) : judgePrompt({ request: record.prompt, finalMessage: record.output, commands: record.commands ?? null, report: record.check, patch: readFileSync(path.replace(/\.json$/, '.patch'), 'utf8'), rules })
    const neutral = mkdtempSync(join(tmpdir(), 'judge-'))
    try {
      const args = ['-p', '--output-format', 'json', '--no-session-persistence', '--setting-sources', 'project', '--strict-mcp-config', '--tools', '', ...(options.model ? ['--model', options.model] : [])]
      const result = await spawnText({ command: options.claude, args, cwd: neutral, input: prompt, timeoutMs: RUN_TIMEOUT_MS })
      const parsed = parseResult(result.stdout)
      const output = parsed?.result ?? result.stdout
      const judgement = parseJudgement(output, { ids })
      writeFileSync(target, `${JSON.stringify({ model: options.model ?? '(기본)', exitCode: result.code, costUsd: parsed?.total_cost_usd ?? null, durationMs: parsed?.duration_ms ?? result.durationMs, output, judgement }, null, 2)}\n`)
      console.log(`판정 ${ARMS[record.arm]} ${record.request} #${record.run} — ${judgement.declared ? `지적 ${judgement.findings.length}` : '형식 어김'}${judgement.unknown.length ? `, 목록 밖 ID ${judgement.unknown.join(' ')}` : ''}`)
    } finally {
      rmSync(neutral, { recursive: true, force: true })
    }
  }
  return 0
}

const score = ({ dir, options }) => {
  if (!dir || !existsSync(dir)) throw new UsageError(`결과 폴더가 없다: ${dir}`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date)) throw new UsageError(`--date는 YYYY-MM-DD다: ${options.date}`)
  // --rejected — 걸러 낸 지적의 목록, 또는 { rejected, unmeasured }(셀 수 없던 줄과 이유)
  const review = options.rejected ? JSON.parse(readFileSync(options.rejected, 'utf8')) : []
  const rejected = Array.isArray(review) ? review : (review.rejected ?? [])
  const unmeasured = Array.isArray(review) ? [] : (review.unmeasured ?? [])
  const areas = areasOf(options)
  const rules = loadRules(areas).map((rule) => ({ id: rule.id, title: rule.title, area: rule.area, check: rule.items.get('검사')?.value ?? '' }))
  const runs = recordsIn(dir, options).map(({ path, record }) => {
    const judgePath = path.replace(/\.json$/, '.judge.json')
    const judged = existsSync(judgePath) ? JSON.parse(readFileSync(judgePath, 'utf8')) : null
    return { arm: record.arm, request: record.request, run: record.run, report: record.check ?? null, judgement: judged?.judgement?.declared ? judged.judgement : null }
  })
  const result = scoreSlop({ runs, rules, rejected, unmeasured })
  const text = `${formatSlopScore(result)}\n${rejected.length > 0 ? `\n걸러 낸 지적 ${rejected.length}개는 세지 않았다\n` : ''}`
  writeFileSync(join(dir, 'score.md'), text)
  if (options.results) writeFileSync(options.results, `${JSON.stringify(slopResults({ score: result, date: options.date, areas: options.areas || options.reviews ? areas : null }), null, 2)}\n`)
  console.log(text.trimEnd())
  return 0
}

const apply = ({ file, root }) => {
  if (!file || !existsSync(file)) throw new UsageError(`결과 파일이 없다: ${file}`)
  const results = JSON.parse(readFileSync(file, 'utf8'))
  // 영역이 없는 결과 파일은 구현 실행의 측정이다(리뷰 줄을 건드리지 않는다)
  for (const area of checkAreas(results.areas ?? null, DEFAULT_AREAS.runs)) {
    const origin = join(root, 'skills', RULE_ORIGIN[area], 'shared/rules', `${area}.md`)
    const text = applyEvidence({ text: readFileSync(origin, 'utf8'), results })
    writeFileSync(origin, text)
    writeFileSync(join(root, 'skills', OTHER_SKILL[RULE_ORIGIN[area]], 'shared/rules', `${area}.md`), text)
    console.log(`근거를 바꿨다 — ${RULE_ORIGIN[area]}/shared/rules/${area}.md(원본)과 복사본`)
  }
  return 0
}

const main = async () => {
  const { command, args, options } = parseArgs(process.argv.slice(2))
  if (command === 'run') return runAll({ options, ids: args })
  if (command === 'judge') return judgeAll({ dir: args[0] ? resolve(args[0]) : null, options })
  if (command === 'score') return score({ dir: args[0] ? resolve(args[0]) : null, options })
  if (command === 'apply') return apply({ file: args[0] ? resolve(args[0]) : null, root: options.root })
  throw new UsageError('사용법: slop-eval.mjs run [ID…] --arm without|with [--runs N | --run N] [--model M] [--out <폴더>] [--claude <실행 파일>] | judge <폴더> [--reviews] [--areas test,code,done,review] [--model M] | score <폴더> [--reviews] [--areas …] [--rejected <파일>] [--results <파일>] [--date YYYY-MM-DD] | apply <결과 파일> [--root <폴더>]  [--fixture <폴더>] [--requests <파일>]')
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof UsageError ? error.message : error.stack)
    process.exit(error instanceof UsageError ? 1 : 2)
  },
)
