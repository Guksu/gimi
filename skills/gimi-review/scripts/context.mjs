#!/usr/bin/env node
/**
 * gimi-review 맥락 수집 — 리뷰 전에 범위·바뀐 파일·의도·이력을 모아 맥락 묶음을 만든다(설계 결정 19~23).
 * 모으는 것은 이 스크립트가, 판단은 에이전트가 한다. 요약은 표준 출력으로, 전체는 JSON 파일로 낸다.
 *
 *   node context.mjs                    # 현재 브랜치 — 기준 브랜치와의 갈림점부터 HEAD까지
 *   node context.mjs --pr 42            # PR #42 (gh pr checkout 42로 체크아웃한 상태여야 한다)
 *   node context.mjs --base develop     # 기준 브랜치를 정한다
 *   node context.mjs --json             # JSON만 표준 출력으로(파일을 쓰지 않는다)
 *   node context.mjs --no-gh            # gh를 부르지 않는다(PR·이슈 본문 없이)
 *
 * 전체 JSON은 docs/gimi/reviews/{날짜}-{PR·브랜치}.context.json에 쓰고, 같은 PR·브랜치의 예전 묶음은 지운다(--out으로 정하면 지우지 않는다).
 * 설정(.agents/gimi.json): history.recentCommits(기본 10), requirements[].keyPattern(티켓 번호 형식)
 * 종료 코드: 0 성공(건너뛴 맥락이 있어도), 2 사용법·환경 오류. 의존성 없음, Node 22 이상.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { staleBundles } from './lib/bundles.mjs'
import { collectContext } from './lib/collect.mjs'
import { ContextError, attempt, createExec } from './lib/exec.mjs'
import { renderSummary } from './lib/summary.mjs'

const USAGE = '사용: node context.mjs [--pr 번호] [--base 브랜치] [--out 경로] [--json] [--no-gh] [--recent N] [--max-lines N]'
const VALUE_OPTIONS = { '--pr': 'pr', '--base': 'base', '--out': 'out', '--recent': 'recent', '--max-lines': 'maxLines' }
const NUMBER_OPTIONS = new Set(['pr', 'recent', 'maxLines'])

const parseArgs = (argv) => {
  const args = { json: false, noGh: false, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--json') args.json = true
    else if (arg === '--no-gh') args.noGh = true
    else if (arg === '--help' || arg === '-h') args.help = true
    else if (arg in VALUE_OPTIONS) {
      const key = VALUE_OPTIONS[arg]
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg}에 값이 없다`)
      if (NUMBER_OPTIONS.has(key) && !/^\d+$/.test(value)) throw new Error(`${arg}는 숫자여야 한다 — ${value}`)
      args[key] = NUMBER_OPTIONS.has(key) ? Number(value) : value
      i += 1
    } else throw new Error(`모르는 옵션 ${arg}`)
  }
  return args
}

const today = (now) => [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-')

const bundleName = (context) => (context.scope.pr ? `pr-${context.scope.pr.number}` : (context.scope.branch ?? context.scope.head.slice(0, 7))).replace(/[^\w.-]+/g, '-')
const defaultOut = ({ context, now }) => `docs/gimi/reviews/${today(now)}-${bundleName(context)}.context.json`

const readConfig = ({ root, notes }) => {
  const path = resolve(root, '.agents/gimi.json')
  if (!existsSync(path)) return {}
  const config = attempt(() => JSON.parse(readFileSync(path, 'utf8')))
  if (config == null) notes.push('.agents/gimi.json을 읽지 못했다 — 기본값으로 돌렸다')
  return config ?? {}
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
    console.error('git 저장소가 아니다 — 리뷰할 저장소 안에서 돌린다')
    return 2
  }
  const exec = createExec({ cwd: root })
  const configNotes = []
  const config = readConfig({ root, notes: configNotes })
  const keyPatterns = (config.requirements ?? []).filter((r) => r.keyPattern).map((r) => ({ source: r.source ?? 'unknown', pattern: r.keyPattern }))
  const now = new Date()

  let context
  try {
    context = collectContext({ exec, pr: args.pr ?? null, base: args.base ?? null, recentCommits: args.recent ?? config.history?.recentCommits ?? 10, keyPatterns, useGh: !args.noGh, now, linkedRepos: config.linkedRepos ?? null })
  } catch (error) {
    if (error instanceof ContextError) {
      console.error(error.message)
      return 2
    }
    throw error
  }
  context.notes.push(...configNotes)

  if (args.json) {
    process.stdout.write(`${JSON.stringify(context, null, 2)}\n`)
    return 0
  }

  const outPath = args.out ?? defaultOut({ context, now })
  // 맥락 묶음은 크고 다시 만들 수 있어 커밋하지 않는다(설계 결정 27) — 무시되지 않으면 알린다
  if (!isAbsolute(outPath) && !attempt(() => (exec.git(['check-ignore', '-q', outPath]), true))) {
    context.notes.push(`${outPath}이(가) .gitignore에 없다 — docs/gimi/reviews/*.context.json을 더해 커밋하지 않게 한다`)
  }
  const target = resolve(root, outPath)
  mkdirSync(dirname(target), { recursive: true })
  // 기본 위치에 쓸 때만 같은 PR·브랜치의 예전 묶음을 지운다(설계 결정 54) — --out으로 정한 파일은 사용자가 관리한다
  if (!args.out) {
    const stale = staleBundles({ files: readdirSync(dirname(target)), name: bundleName(context), keep: basename(target) })
    for (const file of stale) rmSync(join(dirname(target), file), { force: true })
    if (stale.length > 0) context.notes.push(`예전 맥락 묶음 ${stale.length}개를 지웠다(같은 PR·브랜치 — ${stale.join(', ')})`)
  }
  writeFileSync(target, `${JSON.stringify(context, null, 2)}\n`)
  process.stdout.write(renderSummary({ context, outPath, maxLines: args.maxLines }))
  return 0
}

// process.exit()는 파이프로 나가는 큰 출력을 자를 수 있어 종료 코드만 정한다
process.exitCode = main()
