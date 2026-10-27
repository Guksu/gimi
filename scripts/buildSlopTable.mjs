#!/usr/bin/env node
/**
 * 금지선 표 생성(설계 결정 34) — 두 스킬 SKILL.md의 표 블록(<!-- slop-table:start --> … end)을 규칙 파일의 근거로 다시 쓴다.
 * 정본은 원본 규칙 파일(test·done은 gimi-test, code는 gimi-review)의 `근거`다. 측정 결과는 slop-eval.mjs apply가 근거에 옮긴다.
 * gimi-test에는 테스트·완료 보고·코드 줄, gimi-review에는 코드 줄을 둔다. gimi 없이 한 번 이상 나온 줄만 올라간다.
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
const ORIGIN = { test: 'gimi-test', done: 'gimi-test', code: 'gimi-review' }
export const SLOP_TABLES = [
  { skill: 'gimi-test', areas: ['test', 'done', 'code'] },
  { skill: 'gimi-review', areas: ['code'] },
]

/** 스킬마다 지금 SKILL.md와 규칙 파일로 만든 SKILL.md — 표시가 없으면 expected가 null */
export const expectedSlopDocuments = (root = ROOT) =>
  SLOP_TABLES.map(({ skill, areas }) => {
    const path = join(root, 'skills', skill, 'SKILL.md')
    const files = areas.map((area) => ({ area, text: readFileSync(join(root, 'skills', ORIGIN[area], 'shared/rules', `${area}.md`), 'utf8') }))
    const current = readFileSync(path, 'utf8')
    return { skill, path, current, expected: replaceSlopBlock({ document: current, block: renderSlopTable({ files }) }) }
  })

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  const check = argv.includes('--check')
  const at = argv.indexOf('--root')
  const root = at === -1 ? ROOT : resolve(argv[at + 1])
  let failed = false
  for (const { skill, path, current, expected } of expectedSlopDocuments(root)) {
    if (expected === null) {
      console.error(`skills/${skill}/SKILL.md: 금지선 표 표시(<!-- slop-table:start --> … <!-- slop-table:end -->)가 없다`)
      failed = true
    } else if (check) {
      if (expected !== current) {
        console.error(`skills/${skill}/SKILL.md: 금지선 표가 규칙 파일의 근거와 어긋남 — node scripts/buildSlopTable.mjs로 다시 만든다`)
        failed = true
      }
    } else if (expected !== current) {
      writeFileSync(path, expected)
      console.log(`skills/${skill}/SKILL.md: 금지선 표를 다시 썼다`)
    }
  }
  process.exit(failed ? 1 : 0)
}
