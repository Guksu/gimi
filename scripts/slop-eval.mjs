#!/usr/bin/env node
/**
 * 슬롭 금지선 측정(설계 결정 16·34) — 금지선 줄이 gimi 없이·있이 몇 번의 실행에 나왔는지 판정하고 센다.
 * 구현 실행(기능 구현·테스트 작성 요청)을 돌리던 run은 테스트 스킬과 함께 지웠다(설계 결정 52). 그 측정의 원본 결과(<폴더>/{without,with})는 그대로 읽는다.
 *
 *   node scripts/slop-eval.mjs judge <폴더> [--reviews] [--areas test,code,review] [--model M] [--claude <실행 파일>]
 *        실행마다 판정 모델(도구 없음)이 diff·보고·돌린 명령을 읽고 금지선 줄을 고른다. 판정한 실행은 건너뛴다. --areas는 그 영역의 줄만 판정한다.
 *        --reviews는 <폴더>를 리뷰 평가(scripts/review-eval.mjs run)의 결과로 읽고 리뷰 줄을 판정한다
 *        (내장 /code-review가 gimi 없이, gimi-review가 gimi 있이 — PR·이슈·패치는 --fixture의 결함 폴더에서)
 *   node scripts/slop-eval.mjs score <폴더> [--reviews] [--areas …] [--rejected <파일>] [--results <파일>] [--date YYYY-MM-DD]
 *        줄마다 "N번 중 M번" 표(<폴더>/score.md). --rejected는 사람이 읽고 틀렸다고 걸러 낸 지적(세지 않는다),
 *        --results는 규칙 파일에 옮길 측정 결과 파일을 쓴다. --areas는 그 영역의 줄만 센다(결과 파일에 영역을 남긴다)
 *   node scripts/slop-eval.mjs apply <결과 파일> [--root <폴더>]
 *        규칙 파일(skills/gimi-review/shared/rules/)의 근거를 "N번 중 M번"으로 바꾼다. 결과 파일에 영역이 있으면 그 영역의 파일만 바꾼다.
 *        SKILL.md의 금지선 표는 scripts/buildSlopTable.mjs가 다시 쓴다
 *   공통: --fixture <폴더>(기본 evals/shop-fixture)
 *
 * 판정 모델은 사용자 설정·플러그인·MCP를 읽지 않는다(--setting-sources project, --strict-mcp-config). 판단은 scripts/lib/slop-eval.mjs가 맡는다.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseRuleFile } from '../skills/gimi-review/scripts/lib/rulefile.mjs'
import { ARMS, formatSlopScore, judgePrompt, judgedRules, parseJudgement, reviewJudgePrompt, scoreSlop, slopResults } from './lib/slop-eval.mjs'
import { applyEvidence } from './lib/slop-table.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')
const RULES = join(ROOT, 'skills/gimi-review/shared/rules')
const RULE_AREAS = ['test', 'code', 'review']
// 기본으로 세는 영역 — 구현 실행은 테스트·코드 줄, 리뷰 실행(--reviews)은 리뷰 줄
const DEFAULT_AREAS = { runs: ['test', 'code'], reviews: ['review'] }
// 리뷰 평가의 리뷰어 → 측정 쪽. 내장 /code-review가 gimi 없이다
const REVIEW_ARMS = { 'code-review': 'without', gimi: 'with' }
const RUN_TIMEOUT_MS = 30 * 60 * 1000

class UsageError extends Error {}

const parseArgs = (argv) => {
  const positional = []
  const options = { fixture: join(ROOT, 'evals/shop-fixture'), model: null, claude: 'claude', rejected: null, results: null, date: new Date().toISOString().slice(0, 10), root: ROOT, areas: null, reviews: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => {
      const next = argv[++i]
      if (next === undefined || next.startsWith('--')) throw new UsageError(`${arg}에 값이 없다`)
      return next
    }
    if (arg === '--fixture') options.fixture = resolve(value())
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

const checkAreas = (areas, fallback = RULE_AREAS) => {
  const unknown = (areas ?? []).filter((area) => !RULE_AREAS.includes(area))
  if (areas?.length === 0 || unknown.length > 0) throw new UsageError(`--areas는 ${RULE_AREAS.join('·')} 중에서 고른다: ${unknown.join(', ')}`)
  return areas ?? fallback
}
const areasOf = (options) => checkAreas(options.areas, DEFAULT_AREAS[options.reviews ? 'reviews' : 'runs'])
const loadRules = (areas = RULE_AREAS) =>
  areas.flatMap((area) => parseRuleFile(readFileSync(join(RULES, `${area}.md`), 'utf8')).rules.map((rule) => ({ ...rule, area })))

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
    const path = join(root, 'skills/gimi-review/shared/rules', `${area}.md`)
    writeFileSync(path, applyEvidence({ text: readFileSync(path, 'utf8'), results }))
    console.log(`근거를 바꿨다 — gimi-review/shared/rules/${area}.md`)
  }
  return 0
}

const main = async () => {
  const { command, args, options } = parseArgs(process.argv.slice(2))
  if (command === 'judge') return judgeAll({ dir: args[0] ? resolve(args[0]) : null, options })
  if (command === 'score') return score({ dir: args[0] ? resolve(args[0]) : null, options })
  if (command === 'apply') return apply({ file: args[0] ? resolve(args[0]) : null, root: options.root })
  throw new UsageError('사용법: slop-eval.mjs judge <폴더> [--reviews] [--areas test,code,review] [--model M] [--claude <실행 파일>] | score <폴더> [--reviews] [--areas …] [--rejected <파일>] [--results <파일>] [--date YYYY-MM-DD] | apply <결과 파일> [--root <폴더>]  [--fixture <폴더>]')
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof UsageError ? error.message : error.stack)
    process.exit(error instanceof UsageError ? 1 : 2)
  },
)
