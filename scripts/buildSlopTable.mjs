#!/usr/bin/env node
/**
 * 금지선 표 생성(설계 결정 34·63) — 측정 문서(evals/slop/README.md)의 표 블록(<!-- slop-table:start --> … end)을 규칙 파일의 근거로 다시 쓴다.
 * 표는 SKILL.md에 두지 않는다 — 리뷰마다 읽히는데 리뷰에 쓰이지 않는다(공통 금지선은 rules.mjs 목록에 있다).
 * 정본은 규칙 파일(skills/gimi-review/shared/rules/{test,code,review}.md)의 `근거`다. 측정 결과는 slop-eval.mjs apply가 근거에 옮긴다.
 * 테스트·코드·리뷰 줄 가운데 gimi 없이 한 번 이상 나온 줄만 올라간다.
 *
 *   node scripts/buildSlopTable.mjs            블록을 다시 쓴다
 *   node scripts/buildSlopTable.mjs --check    쓰지 않고 어긋났는지만 본다(어긋나면 exit 1)
 *   공통: --root <폴더>(기본 이 저장소)
 *
 * validateSkills.mjs가 expectedSlopDocuments()로 같은 것을 본다.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderSlopTable, replaceSlopBlock } from './lib/slop-table.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
export const SLOP_TABLES = [{ document: 'evals/slop/README.md', rules: 'skills/gimi-review/shared/rules', areas: ['test', 'code', 'review'] }]

/** 표마다 지금 문서와 규칙 파일로 만든 문서 — 표시가 없으면 expected가 null */
export const expectedSlopDocuments = (root = ROOT) =>
  SLOP_TABLES.map(({ document, rules, areas }) => {
    const path = join(root, document)
    const files = areas.map((area) => ({ area, text: readFileSync(join(root, rules, `${area}.md`), 'utf8') }))
    const current = readFileSync(path, 'utf8')
    return { document, path, current, expected: replaceSlopBlock({ document: current, block: renderSlopTable({ files }) }) }
  })

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  const check = argv.includes('--check')
  const at = argv.indexOf('--root')
  const root = at === -1 ? ROOT : resolve(argv[at + 1])
  let failed = false
  for (const { document, path, current, expected } of expectedSlopDocuments(root)) {
    if (expected === null) {
      console.error(`${document}: 금지선 표 표시(<!-- slop-table:start --> … <!-- slop-table:end -->)가 없다`)
      failed = true
    } else if (check) {
      if (expected !== current) {
        console.error(`${document}: 금지선 표가 규칙 파일의 근거와 어긋남 — node scripts/buildSlopTable.mjs로 다시 만든다`)
        failed = true
      }
    } else if (expected !== current) {
      writeFileSync(path, expected)
      console.log(`${document}: 금지선 표를 다시 썼다`)
    }
  }
  process.exit(failed ? 1 : 0)
}
