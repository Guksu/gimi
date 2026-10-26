#!/usr/bin/env node
/**
 * 리뷰 품질 평가(설계 결정 15) — 결함 PR마다 리뷰어를 돌리고 정답과 맞춰 채점한다.
 *
 *   node scripts/review-eval.mjs coverage [ID…] [--out <폴더>]
 *        모델 없이 — 결함마다 정답·근거 위치가 gimi의 맥락 묶음(context.mjs)에 있는지
 *   node scripts/review-eval.mjs run [ID…] --reviewer gimi|code-review [--runs N] [--model M] [--out <폴더>] [--claude <실행 파일>]
 *        결함 PR마다 평가용 저장소를 만들어 claude -p로 리뷰한다. 두 리뷰어에 같은 지시를 주고, gimi만 --plugin-dir로 이 저장소를 받는다
 *   node scripts/review-eval.mjs score <폴더>
 *        run이 쓴 결과를 채점표로(<폴더>/score.md)
 *   공통: --fixture <폴더>(기본 evals/shop-fixture)
 *
 * 공정하게 — 사용자 설정·플러그인·MCP는 읽지 않는다(--setting-sources project, --strict-mcp-config). 평가용 저장소의 폴더·브랜치
 * 이름에는 결함 ID를 넣지 않는다(feature/pr). 판단은 scripts/lib/review-eval.mjs가 맡는다.
 */
import { execFileSync, spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { coverageOf, formatScore, scoreRuns } from './lib/review-eval.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')
const DEFECTS = join(ROOT, 'scripts/defects.mjs')
const CONTEXT = join(ROOT, 'skills/gimi-review/scripts/context.mjs')
const BRANCH = 'feature/pr'
const RUN_TIMEOUT_MS = 20 * 60 * 1000
// 리뷰어마다 부르는 말 — gimi는 범위를 스스로 정한다(지금 브랜치와 기본 브랜치의 갈림점부터), code-review에는 같은 범위를 브랜치로 준다
const REVIEWERS = {
  gimi: { prompt: '/gimi:gimi-review', plugin: true },
  'code-review': { prompt: `/code-review ${BRANCH}`, plugin: false },
}
// 리뷰가 남긴 기록 — 결과 옆에 복사해 둔다(수집 실패·판단 실패를 나눌 때 본다)
const KEEP = ['docs/gimi/reviews']
// 두 리뷰어에 똑같이 덧붙이는 지시 — 범위와 PR 설명이 있는 곳, 채점할 수 있게 지적을 한 줄씩 다시 적게 한다
const FINDING_INSTRUCTION = [
  '이 세션은 코드 리뷰 평가다. 코드를 고치거나 커밋하지 않는다.',
  `리뷰할 PR은 main...${BRANCH}(지금 브랜치)다. PR 제목과 본문은 ${BRANCH}의 마지막 커밋 메시지다.`,
  '리뷰를 마치면 마지막에 지적마다 한 줄씩 다음 형식으로 다시 적는다(저장소 루트 기준 경로, 줄 번호는 지금 브랜치의 파일 기준).',
  'FINDING <고쳐야 함|고치면 좋음|확인 질문> <파일 경로>:<줄> <한 줄 요약>',
  '지적이 없으면 FINDING 없음 한 줄만 적는다.',
].join('\n')
// 리뷰에 쓰는 도구 — 읽기·검색·기록 쓰기와 Bash. 테스트 실행만 막는다(dontAsk라 묻지 않고 막는다).
// 이어 붙인 명령은 하나라도 허용 밖이면 통째로 막힌다. code-review는 git diff에 따옴표 없는 find 패턴·~/.claude 읽기를 이어 붙여서,
// 명령 이름 규칙(Bash(git *) 등)으로는 diff를 못 본다
const ALLOWED_TOOLS = ['Read', 'Grep', 'Glob', 'Write', 'Skill', 'Agent', 'Bash']
const DISALLOWED_TOOLS = ['npm', 'npx', 'pnpm', 'yarn'].map((command) => `Bash(${command} *)`)

class UsageError extends Error {}

const parseArgs = (argv) => {
  const positional = []
  const options = { fixture: join(ROOT, 'evals/shop-fixture'), out: null, reviewer: null, runs: 1, model: null, claude: 'claude' }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => {
      const next = argv[++i]
      if (next === undefined || next.startsWith('--')) throw new UsageError(`${arg}에 값이 없다`)
      return next
    }
    if (arg === '--fixture') options.fixture = resolve(value())
    else if (arg === '--out') options.out = resolve(value())
    else if (arg === '--reviewer') options.reviewer = value()
    else if (arg === '--runs') options.runs = Number(value())
    else if (arg === '--model') options.model = value()
    else if (arg === '--claude') options.claude = value()
    else if (arg.startsWith('--')) throw new UsageError(`모르는 옵션: ${arg}`)
    else positional.push(arg)
  }
  return { command: positional[0], args: positional.slice(1), options }
}

const allDefects = (fixture) => {
  const folder = join(fixture, 'defects')
  return existsSync(folder) ? readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort() : []
}
const readDefect = (fixture, id) => JSON.parse(readFileSync(join(fixture, 'defects', id, 'defect.json'), 'utf8'))
const pick = (fixture, ids) => {
  const all = allDefects(fixture)
  const unknown = ids.filter((id) => !all.includes(id))
  if (unknown.length > 0) throw new UsageError(`없는 결함: ${unknown.join(', ')}`)
  return ids.length > 0 ? ids : all
}

/** 평가용 저장소 — 이름이 중립인 임시 폴더에, 결함 브랜치는 feature/pr, 예제 저장소의 의존성을 링크한다 */
const prepare = (fixture, id) => {
  const holder = mkdtempSync(join(tmpdir(), 'shop-'))
  const repo = join(holder, 'shop')
  execFileSync(process.execPath, [DEFECTS, 'materialize', id, repo, '--fixture', fixture, '--branch', BRANCH, '--link-deps'], { stdio: ['ignore', 'pipe', 'pipe'] })
  return { holder, repo }
}

const coverage = ({ fixture, ids, out }) => {
  const result = {}
  const lines = []
  for (const id of pick(fixture, ids)) {
    const defect = readDefect(fixture, id)
    if (defect.clean === true) continue
    const { holder, repo } = prepare(fixture, id)
    try {
      const bundle = JSON.parse(execFileSync(process.execPath, [CONTEXT, '--json', '--no-gh'], { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }))
      result[id] = coverageOf({ bundle, defect })
    } finally {
      rmSync(holder, { recursive: true, force: true })
    }
    const items = result[id]
    const missing = items.filter((item) => !item.covered).map((item) => item.what)
    lines.push(`  ${id.padEnd(18)} ${String(defect.context).padEnd(6)} ${items.filter((item) => item.covered).length}/${items.length}${missing.length > 0 ? `  빠짐 ${missing.join(', ')}` : ''}`)
  }
  const total = Object.values(result).flat()
  const tally = ['바뀐 조각', '바뀐 파일', '영향 범위', '이력'].map((where) => `${where} ${total.filter((item) => item.where === where).length}`).join(' · ')
  console.log(`맥락 수집 점검 — 정답·근거 ${total.length}개 가운데 ${total.filter((item) => item.covered).length}개가 맥락 묶음에 있다(${tally})`)
  for (const line of lines) console.log(line)
  if (out) {
    mkdirSync(out, { recursive: true })
    writeFileSync(join(out, 'coverage.json'), `${JSON.stringify(result, null, 2)}\n`)
  }
  return result
}

const runClaude = ({ claude, args, cwd }) =>
  new Promise((done) => {
    const started = Date.now()
    const child = spawn(claude, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGTERM'), RUN_TIMEOUT_MS)
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('close', (code) => {
      clearTimeout(timer)
      done({ code: code ?? 1, stdout, stderr, durationMs: Date.now() - started })
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      done({ code: 127, stdout, stderr: String(error), durationMs: Date.now() - started })
    })
  })

const runReviews = async ({ fixture, ids, options }) => {
  const reviewer = REVIEWERS[options.reviewer]
  if (!reviewer) throw new UsageError(`--reviewer는 ${Object.keys(REVIEWERS).join('·')} 중 하나다`)
  if (!Number.isInteger(options.runs) || options.runs < 1) throw new UsageError('--runs는 1 이상의 정수다')
  const out = options.out ?? join(ROOT, 'evals/review/runs', new Date().toISOString().slice(0, 10))
  const folder = join(out, options.reviewer)
  mkdirSync(folder, { recursive: true })
  for (const id of pick(fixture, ids)) {
    for (let n = 1; n <= options.runs; n++) {
      const { holder, repo } = prepare(fixture, id)
      const prompt = reviewer.prompt
      const args = [
        '-p',
        prompt,
        '--output-format',
        'json',
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
        FINDING_INSTRUCTION,
        ...(options.model ? ['--model', options.model] : []),
        ...(reviewer.plugin ? ['--plugin-dir', ROOT] : []),
      ]
      try {
        const result = await runClaude({ claude: options.claude, args, cwd: repo })
        let parsed = null
        try {
          parsed = JSON.parse(result.stdout)
        } catch {
          parsed = null
        }
        const record = {
          reviewer: options.reviewer,
          id,
          run: n,
          root: repo,
          branch: BRANCH,
          model: options.model ?? '(기본)',
          prompt,
          tools: { allowed: ALLOWED_TOOLS, disallowed: DISALLOWED_TOOLS },
          exitCode: result.code,
          durationMs: parsed?.duration_ms ?? result.durationMs,
          costUsd: parsed?.total_cost_usd ?? null,
          numTurns: parsed?.num_turns ?? null,
          output: parsed?.result ?? result.stdout,
          // 막힌 도구 호출 — 리뷰어가 diff를 못 봤는지 확인할 때 본다
          permissionDenials: (parsed?.permission_denials ?? []).map((denial) => ({ tool: denial.tool_name, input: typeof denial.tool_input?.command === 'string' ? denial.tool_input.command : JSON.stringify(denial.tool_input ?? {}) })),
          stderr: result.stderr.slice(-4000),
        }
        writeFileSync(join(folder, `${id}-${n}.json`), `${JSON.stringify(record, null, 2)}\n`)
        for (const path of KEEP) if (existsSync(join(repo, path))) cpSync(join(repo, path), join(folder, `${id}-${n}`, path), { recursive: true })
        console.log(`${options.reviewer} ${id} #${n} — 종료 코드 ${result.code}, ${Math.round(record.durationMs / 1000)}초${record.costUsd === null ? '' : `, $${record.costUsd.toFixed(2)}`}`)
      } finally {
        rmSync(holder, { recursive: true, force: true })
      }
    }
  }
  return 0
}

const score = ({ fixture, dir }) => {
  if (!dir || !existsSync(dir)) throw new UsageError(`결과 폴더가 없다: ${dir}`)
  const runs = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) =>
      readdirSync(join(dir, entry.name))
        .filter((name) => name.endsWith('.json'))
        .map((name) => JSON.parse(readFileSync(join(dir, entry.name, name), 'utf8'))),
    )
    .sort((a, b) => a.id.localeCompare(b.id) || a.reviewer.localeCompare(b.reviewer) || a.run - b.run)
    .map((record) => ({ ...record, defect: readDefect(fixture, record.id) }))
  const coverageFile = join(dir, 'coverage.json')
  const result = scoreRuns({ runs, coverage: existsSync(coverageFile) ? JSON.parse(readFileSync(coverageFile, 'utf8')) : {} })
  const text = `${formatScore(result)}\n`
  writeFileSync(join(dir, 'score.md'), text)
  console.log(text.trimEnd())
  return 0
}

const main = async () => {
  const { command, args, options } = parseArgs(process.argv.slice(2))
  if (command === 'coverage') {
    coverage({ fixture: options.fixture, ids: args, out: options.out })
    return 0
  }
  if (command === 'run') return runReviews({ fixture: options.fixture, ids: args, options })
  if (command === 'score') return score({ fixture: options.fixture, dir: args[0] ? resolve(args[0]) : null })
  throw new UsageError('사용법: review-eval.mjs coverage [ID…] [--out <폴더>] | run [ID…] --reviewer gimi|code-review [--runs N] [--model M] [--out <폴더>] [--claude <실행 파일>] | score <폴더>  [--fixture <폴더>]')
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof UsageError ? error.message : error.stack)
    process.exit(error instanceof UsageError ? 1 : 2)
  },
)
