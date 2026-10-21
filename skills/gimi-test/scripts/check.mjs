#!/usr/bin/env node
/**
 * gimi-test 끝내기 전 검사 — 바뀐 범위의 테스트·타입 검사·린트를 실제로 돌리고, 실행한 명령·종료 코드·결과 수로 보고한다(설계 결정 9·50).
 * 바뀐 범위는 기준 브랜치와의 갈림점부터 지금 작업 트리까지다(커밋하지 않은 변경·새 파일 포함).
 * 명령은 설정 finishCheck.commands → guksu-harness verifier 설정 → 프로젝트 파일 감지 순서로 찾는다.
 * 바뀐 JS·TS 파일의 바뀐 줄에서 테스트·코드 슬롭도 찾는다(설계 7절). 슬롭 error가 있으면 실패로 끝낸다.
 *
 *   node check.mjs                 # 찾은 명령을 돌리고 보고한다
 *   node check.mjs --dry-run       # 돌릴 명령만 보인다
 *   node check.mjs --json          # 보고를 JSON으로
 *   node check.mjs --base develop  # 기준 브랜치를 정한다
 *   node check.mjs --baseline      # 실패한 명령을 기준(갈림점)의 코드에서 다시 돌려 원래 있던 실패인지 가린다
 *   node check.mjs --timeout 300   # 명령마다 시간 상한(초, 기본 600). 설정의 timeoutMs가 있으면 그것을 쓴다
 *
 * 종료 코드: 0 모두 통과(건너뛴 것·슬롭 warn이 있어도), 1 실패·시간 초과·슬롭 error가 있음, 2 사용법·환경 오류. 의존성 없음, Node 22 이상.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exportTree, linkDependencies, planBaseline, verdictOf } from './lib/baseline.mjs'
import { collectChanges, collectLineChanges } from './lib/changes.mjs'
import { ContextError, attempt, createExec } from './lib/exec.mjs'
import { planChecks } from './lib/plan.mjs'
import { renderCheckReport } from './lib/report.mjs'
import { DEFAULT_TIMEOUT_MS, runCheck, stopRunning } from './lib/run.mjs'
import { checkSlop, slopTargetOf } from './lib/slop.mjs'

const USAGE = '사용: node check.mjs [--base 브랜치] [--baseline] [--dry-run] [--json] [--timeout 초]'
const SCOPE = { related: '관련 테스트만', all: '전체', module: '모듈', config: '설정대로', harness: '설정대로' }
// 이보다 큰 파일(번들·생성 파일)은 슬롭 검사에서 뺀다
const MAX_SLOP_BYTES = 1024 * 1024

const parseArgs = (argv) => {
  const args = { dryRun: false, json: false, help: false, baseline: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--dry-run') args.dryRun = true
    else if (arg === '--json') args.json = true
    else if (arg === '--baseline') args.baseline = true
    else if (arg === '--help' || arg === '-h') args.help = true
    else if (arg === '--base' || arg === '--timeout') {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg}에 값이 없다`)
      if (arg === '--timeout' && !/^\d+$/.test(value)) throw new Error(`--timeout은 초 단위 숫자여야 한다 — ${value}`)
      if (arg === '--base') args.base = value
      else args.timeoutMs = Number(value) * 1000
      i += 1
    } else throw new Error(`모르는 옵션 ${arg}`)
  }
  return args
}

const readJson = (path) => (existsSync(path) ? attempt(() => JSON.parse(readFileSync(path, 'utf8'))) : null)

// guksu-harness verifier 설정 — v3는 .agents/hooks/, v2는 .claude/hooks/에 둔다
const HARNESS_CONFIGS = ['.agents/hooks/verifierGate.config.json', '.claude/hooks/verifierGate.config.json']
// 기준 폴더는 지금의 node_modules를 링크해 쓴다 — 이 파일이 바뀌었으면 기준 결과가 다를 수 있다
const DEPENDENCY_FILE = /(?:^|\/)(?:package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/

const projectAt = (dir) => ({
  exists: (path) => existsSync(join(dir, path)),
  readJson: (path) => JSON.parse(readFileSync(join(dir, path), 'utf8')),
  readText: (path) => (existsSync(join(dir, path)) ? readFileSync(join(dir, path), 'utf8') : undefined),
})

/** 실패한 명령을 기준(갈림점)의 코드에서 다시 돌려 run.baseline에 담는다 */
const compareWithBaseline = async ({ root, exec, changes, source, runs, config, harness }) => {
  const info = { mergeBase: changes.mergeBase, dependenciesChanged: changes.files.some((file) => DEPENDENCY_FILE.test(file.path)) }
  const failing = runs.filter((run) => run.status !== 'pass')
  if (failing.length === 0) return info
  const dir = mkdtempSync(join(tmpdir(), 'gimi-baseline-'))
  let linked = []
  try {
    try {
      exportTree({ exec, rev: changes.mergeBase, dir })
      linked = linkDependencies({ root, dir, cwds: ['', ...failing.map((run) => run.cwd)] })
    } catch (error) {
      for (const run of failing) run.baseline = verdictOf({ run, error: `갈림점의 파일을 풀지 못했다(${String(error.message).split('\n')[0]})` })
      return info
    }
    for (const plan of planBaseline({ runs, source, changed: changes.files, config, harness, baseProject: projectAt(dir) })) {
      const run = runs[plan.index]
      if (!plan.check) {
        run.baseline = verdictOf({ run, absent: true })
        continue
      }
      const base = await runCheck({ root: dir, check: plan.check })
      run.baseline = { ...verdictOf({ run, base }), status: base.status, exitCode: base.exitCode, durationMs: base.durationMs, counts: base.counts, command: base.command, outputTail: base.outputTail }
    }
    return info
  } finally {
    // 링크부터 끊는다 — 지울 때 링크를 따라가 지금의 node_modules를 지우지 않게
    for (const path of linked) unlinkSync(join(dir, path))
    rmSync(dir, { recursive: true, force: true })
  }
}

const main = async () => {
  // 검사 명령(예: 하네스 verifier)이 다시 check.mjs를 부르면 끝없이 돈다
  if (process.env.GIMI_CHECK_RUNNING === '1') {
    console.error('check.mjs가 검사 명령 안에서 다시 불렸다 — 검사 명령(설정·verifier)에서 check.mjs를 뺀다')
    return 2
  }
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
    console.error('git 저장소가 아니다 — 검사할 저장소 안에서 돌린다')
    return 2
  }
  const exec = createExec({ cwd: root })

  let changes
  try {
    changes = collectChanges({ exec, base: args.base ?? null })
  } catch (error) {
    if (error instanceof ContextError) {
      console.error(error.message)
      return 2
    }
    throw error
  }

  const config = readJson(join(root, '.agents/gimi.json')) ?? {}
  const harnessPath = HARNESS_CONFIGS.find((path) => existsSync(join(root, path))) ?? null
  const harness = harnessPath ? readJson(join(root, harnessPath)) : null
  const plan = planChecks({ changed: changes.files, config, harness, project: projectAt(root) })
  const checks = plan.checks.map((check) => ({ ...check, timeoutMs: check.timeoutMs ?? args.timeoutMs ?? DEFAULT_TIMEOUT_MS }))
  const scope = { baseRef: changes.baseRef, mergeBase: changes.mergeBase, head: changes.head, branch: changes.branch, files: changes.files }

  // 슬롭 검사 대상 — 바뀐 줄이 있는 JS·TS 파일과 스냅샷
  const lineChanges = collectLineChanges({ exec, mergeBase: changes.mergeBase, files: changes.files })
  const slopTargets = [...lineChanges.keys()].filter((path) => slopTargetOf(path) && existsSync(join(root, path)) && statSync(join(root, path)).size <= MAX_SLOP_BYTES).sort()

  if (args.dryRun) {
    const counts = { test: 0, code: 0, snapshot: 0 }
    for (const path of slopTargets) counts[slopTargetOf(path)] += 1
    if (args.json) process.stdout.write(`${JSON.stringify({ version: 1, scope, source: plan.source, harnessPath, checks, skipped: plan.skipped, slopTargets }, null, 2)}\n`)
    else {
      const parts = [['테스트', counts.test], ['코드', counts.code], ['스냅샷', counts.snapshot]].filter(([, n]) => n > 0).map(([label, n]) => `${label} ${n}`)
      const rows = [
        ...checks.map((check) => `돌릴 명령  ${check.name}(${SCOPE[check.scope] ?? check.scope})  ${check.cwd ? `[${check.cwd}] ` : ''}${check.command}`),
        ...plan.skipped.map((skip) => `건너뜀    ${skip.cwd ? `[${skip.cwd}] ` : ''}${skip.name} — ${skip.reason}`),
        slopTargets.length > 0 ? `슬롭 검사  바뀐 파일 ${slopTargets.length}개(${parts.join(' · ')})의 바뀐 줄을 본다` : '슬롭 검사  바뀐 JS·TS 파일 없음',
      ]
      process.stdout.write(`${rows.join('\n')}\n`)
    }
    return 0
  }

  const slop = checkSlop({
    files: slopTargets.map((path) => ({ path, text: readFileSync(join(root, path), 'utf8'), lines: lineChanges.get(path) })),
    changedPaths: changes.files.map((file) => file.path),
    stacks: Array.isArray(config.stacks) ? config.stacks : undefined,
  })

  // 명령은 하나씩 돌린다 — 테스트·타입 검사가 같은 파일을 동시에 쓰거나 CPU를 다투지 않게
  const runs = []
  for (const check of checks) runs.push({ ...(await runCheck({ root, check })), timeoutMs: check.timeoutMs })
  const baseline = args.baseline ? await compareWithBaseline({ root, exec, changes, source: plan.source, runs, config, harness }) : null
  const report = { version: 1, generatedAt: new Date().toISOString(), scope, source: plan.source, harnessPath, runs, skipped: plan.skipped, slop, ...(baseline ? { baseline } : {}) }
  process.stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : renderCheckReport({ report }))
  return runs.some((run) => run.status !== 'pass') || slop.findings.some((finding) => finding.severity === 'error') ? 1 : 0
}

// 검사가 멈추라는 신호(verifier 시간 초과·Ctrl+C)를 받으면 돌고 있는 명령의 프로세스 그룹까지 멈춘다
for (const [signal, code] of [['SIGTERM', 143], ['SIGINT', 130], ['SIGHUP', 129]]) {
  process.on(signal, () => {
    stopRunning()
    process.exit(code)
  })
}

// process.exit()는 파이프로 나가는 큰 출력을 자를 수 있어 종료 코드만 정한다
process.exitCode = await main()
