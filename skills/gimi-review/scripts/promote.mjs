#!/usr/bin/env node
/**
 * 반복 지적을 규칙 후보로(설계 결정 3·62) — 리뷰 기록을 읽어 규칙에 걸리지 않은 지적을 묶음마다 센다. 판단은 lib/promote.mjs가 한다.
 *
 *   node promote.mjs           # 기준(설정 promoteAfter, 기본 리뷰 3건)에 닿은 묶음과 출처, 쌓이는 묶음, 이미 후보·규칙인 묶음
 *   node promote.mjs --json    # 같은 것을 JSON으로
 *
 * 리뷰 기록은 docs/gimi/reviews/*.md, 후보는 docs/gimi/candidates.md, 회사 규칙은 docs/gimi/rules.md에서 읽는다. 파일은 쓰지 않는다 —
 * 후보 초안은 에이전트가 쓰고 사람이 승인한다. 에이전트는 묶음 이름을 정하기 전에도 돌려 있는 이름을 본다.
 * 종료 코드: 0 성공(기록이 없어도), 2 사용법 오류. 의존성 없음, Node 22 이상.
 */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { attempt, createExec, readRepoFile } from './lib/exec.mjs'
import { parseReviewRecord, readBundleNames, tallyBundles } from './lib/promote.mjs'
import { safeLine } from './lib/text.mjs'

const USAGE = '사용: node promote.mjs [--json]'
const REVIEWS = 'docs/gimi/reviews'
const KNOWN_FILES = ['docs/gimi/candidates.md', 'docs/gimi/rules.md']
const DEFAULT_THRESHOLD = 3

const sourceText = ({ path, findings }) => `${path}#${findings.join('·')}`
const bundleRow = (bundle) => `  ${bundle.name}  리뷰 ${bundle.reviews}건 — ${bundle.status === 'known' ? bundle.where : bundle.sources.map(sourceText).join(', ')}`

const main = () => {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE)
    return 0
  }
  const unknown = args.filter((arg) => arg !== '--json')
  if (unknown.length > 0) {
    console.error(`모르는 옵션: ${unknown.join(' ')}\n${USAGE}`)
    return 2
  }
  const root = attempt(() => createExec({ cwd: process.cwd() }).git(['rev-parse', '--show-toplevel']).trim()) || process.cwd()
  const notes = []
  // 저장소 안의 파일은 일반 파일일 때만 읽는다(심볼릭 링크로 밖·장치 파일을 가리키지 못하게)
  const configText = readRepoFile({ root, path: '.agents/gimi.json' })
  const config = configText == null ? {} : (attempt(() => JSON.parse(configText)) ?? (notes.push('.agents/gimi.json을 읽지 못했다 — 기본값으로 셌다'), {}))
  let threshold = DEFAULT_THRESHOLD
  if (config.promoteAfter !== undefined) {
    if (Number.isInteger(config.promoteAfter) && config.promoteAfter >= 1) threshold = config.promoteAfter
    else notes.push(`설정의 promoteAfter는 1 이상의 정수다 — 기본값 ${DEFAULT_THRESHOLD}으로 셌다`)
  }

  const names = attempt(() => readdirSync(join(root, REVIEWS))) ?? []
  const records = names
    .filter((name) => name.endsWith('.md'))
    .sort()
    .flatMap((name) => {
      const path = `${REVIEWS}/${name}`
      const text = readRepoFile({ root, path })
      return text == null ? [] : [{ path, findings: parseReviewRecord(text) }]
    })
  const known = new Map()
  for (const path of KNOWN_FILES) for (const name of readBundleNames(readRepoFile({ root, path }))) if (!known.has(name)) known.set(name, path)
  const result = tallyBundles({ records, known, threshold })

  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ version: 1, threshold, records: records.length, ...result, notes }, null, 2)}\n`)
    return 0
  }
  const { bundles, malformed, findings } = result
  const of = (status) => bundles.filter((bundle) => bundle.status === status)
  const rows = [`묶음      기준 리뷰 ${threshold}건 · 리뷰 기록 ${records.length}개 · 규칙 없는 지적 ${findings.counted}개(틀림·의도함 ${findings.excluded}개 뺌)`]
  rows.push(...(of('reached').length > 0 ? ['후보로 올릴 것', ...of('reached').map(bundleRow)] : ['후보로 올릴 것  없음']))
  if (of('growing').length > 0) rows.push('쌓이는 중', ...of('growing').map(bundleRow))
  if (of('known').length > 0) rows.push('이미 후보·규칙', ...of('known').map(bundleRow))
  if (malformed.length > 0) rows.push(`형식 어김  지적 ${malformed.length}개 — ${malformed.map((m) => `${m.path}#${m.finding}(${m.problem})`).join(', ')}`)
  for (const note of notes) rows.push(`참고    ${note}`)
  // 파일 이름처럼 저장소가 정하는 글이 줄을 나누지 못하게 한다
  process.stdout.write(`${rows.map(safeLine).join('\n')}\n`)
  return 0
}

// process.exit()는 파이프로 나가는 큰 출력을 자를 수 있어 종료 코드만 정한다
process.exitCode = main()
