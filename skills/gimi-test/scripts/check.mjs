#!/usr/bin/env node
/**
 * gimi-test 끝내기 전 검사 — 바뀐 범위의 테스트·타입 검사·린트를 실제로 돌리고, 실행한 명령·종료 코드·결과 수로 보고한다(설계 결정 9·50).
 * 바뀐 범위는 기준 브랜치와의 갈림점부터 지금 작업 트리까지다(커밋하지 않은 변경·새 파일 포함).
 * 명령은 설정 finishCheck.commands → guksu-harness verifier 설정 → 프로젝트 파일 감지 순서로 찾는다.
 *
 *   node check.mjs                 # 찾은 명령을 돌리고 보고한다
 *   node check.mjs --dry-run       # 돌릴 명령만 보인다
 *   node check.mjs --json          # 보고를 JSON으로
 *   node check.mjs --base develop  # 기준 브랜치를 정한다
 *   node check.mjs --timeout 300   # 명령마다 시간 상한(초, 기본 600). 설정의 timeoutMs가 있으면 그것을 쓴다
 *
 * 종료 코드: 0 모두 통과(건너뛴 것이 있어도), 1 실패·시간 초과가 있음, 2 사용법·환경 오류. 의존성 없음, Node 22 이상.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { collectChanges } from './lib/changes.mjs'
import { ContextError, attempt, createExec } from './lib/exec.mjs'
import { planChecks } from './lib/plan.mjs'
import { renderCheckReport } from './lib/report.mjs'
import { DEFAULT_TIMEOUT_MS, runCheck } from './lib/run.mjs'

const USAGE = '사용: node check.mjs [--base 브랜치] [--dry-run] [--json] [--timeout 초]'
const SCOPE = { related: '관련 테스트만', all: '전체', module: '모듈', config: '설정대로', harness: '설정대로' }

const parseArgs = (argv) => {
  const args = { dryRun: false, json: false, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--dry-run') args.dryRun = true
    else if (arg === '--json') args.json = true
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

  const project = {
    exists: (path) => existsSync(join(root, path)),
    readJson: (path) => JSON.parse(readFileSync(join(root, path), 'utf8')),
    readText: (path) => (existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : undefined),
  }
  const config = readJson(join(root, '.agents/gimi.json')) ?? {}
  const harness = readJson(join(root, '.agents/hooks/verifierGate.config.json'))
  const plan = planChecks({ changed: changes.files, config, harness, project })
  const checks = plan.checks.map((check) => ({ ...check, timeoutMs: check.timeoutMs ?? args.timeoutMs ?? DEFAULT_TIMEOUT_MS }))
  const scope = { baseRef: changes.baseRef, mergeBase: changes.mergeBase, head: changes.head, branch: changes.branch, files: changes.files }

  if (args.dryRun) {
    if (args.json) process.stdout.write(`${JSON.stringify({ version: 1, scope, source: plan.source, checks, skipped: plan.skipped }, null, 2)}\n`)
    else {
      const rows = [...checks.map((check) => `돌릴 명령  ${check.name}(${SCOPE[check.scope] ?? check.scope})  ${check.cwd ? `[${check.cwd}] ` : ''}${check.command}`), ...plan.skipped.map((skip) => `건너뜀    ${skip.cwd ? `[${skip.cwd}] ` : ''}${skip.name} — ${skip.reason}`)]
      process.stdout.write(`${rows.join('\n')}\n`)
    }
    return 0
  }

  // 명령은 하나씩 돌린다 — 테스트·타입 검사가 같은 파일을 동시에 쓰거나 CPU를 다투지 않게
  const runs = []
  for (const check of checks) runs.push(await runCheck({ root, check }))
  const report = { version: 1, generatedAt: new Date().toISOString(), scope, source: plan.source, runs, skipped: plan.skipped }
  process.stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : renderCheckReport({ report }))
  return runs.some((run) => run.status !== 'pass') ? 1 : 0
}

// process.exit()는 파이프로 나가는 큰 출력을 자를 수 있어 종료 코드만 정한다
process.exitCode = await main()
