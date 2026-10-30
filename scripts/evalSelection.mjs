#!/usr/bin/env node
/**
 * 트리거 평가 — gimi-review가 맞는 요청에 걸리고, 다른 스킬의 요청에는 걸리지 않는가.
 *
 * 에이전트는 설치된 스킬의 description만 보고 고른다. skills/의 스킬 description을 함께 깔릴 법한 스킬 설명
 * (evals/trigger/decoys.json)과 섞어 순위를 매긴다. LLM을 부르지 않는 대리 지표다(scripts/lib/selection.mjs).
 *
 * 평가 파일: evals/trigger/{스킬}.json — { "skill": "…", "should": [...8개 이상], "shouldNot": [...6개 이상], "contested": [...선택] }
 *   contested — 단어 겹침으로는 경쟁 스킬과 동점을 깰 수 없는 질의. 대상이 1위 동점 안이면 통과하고, 동점은 경고로 출력한다
 * 실행: node scripts/evalSelection.mjs [--verbose] [--margins]
 *   --verbose  질의마다 상위 3개 점수
 *   --margins  통과한 should 중 2위와 점수 차가 가장 작은 10개 — description이 흔들리기 쉬운 곳
 * 실패하면 exit 1(CI·완료 게이트용).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fieldOf, frontmatterOf } from './lib/frontmatter.mjs'
import { evaluateTrigger, validateSpec } from './lib/trigger.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2)
const verbose = args.includes('--verbose')
const showMargins = args.includes('--margins')
const errors = []
const warnings = []
const margins = []
let passed = 0
let total = 0

const triggerDir = join(root, 'evals', 'trigger')
const decoyFile = join(triggerDir, 'decoys.json')
const decoys = existsSync(decoyFile) ? JSON.parse(readFileSync(decoyFile, 'utf8')).decoys ?? [] : []
if (decoys.length < 6) errors.push(`evals/trigger/decoys.json: decoy 6개 이상 필요 — 지금 ${decoys.length}개`)

const skillsDir = join(root, 'skills')
const skillNames = existsSync(skillsDir) ? readdirSync(skillsDir).filter((name) => existsSync(join(skillsDir, name, 'SKILL.md'))).sort() : []
const skills = skillNames.map((name) => ({ name, description: fieldOf({ frontmatter: frontmatterOf(readFileSync(join(skillsDir, name, 'SKILL.md'), 'utf8')), key: 'description' }) }))
const docs = [...skills, ...decoys.map(({ name, description }) => ({ name, description }))]

const specFiles = existsSync(triggerDir) ? readdirSync(triggerDir).filter((file) => file.endsWith('.json') && file !== 'decoys.json').sort() : []
const covered = new Set()
for (const file of specFiles) {
  const spec = JSON.parse(readFileSync(join(triggerDir, file), 'utf8'))
  covered.add(spec.skill)
  errors.push(...validateSpec({ spec }))
  const skill = skills.find((s) => s.name === spec.skill)
  if (!skill) {
    errors.push(`${file}: skills/${spec.skill}/SKILL.md 없음`)
    continue
  }
  if (!skill.description) {
    errors.push(`${file}: skills/${spec.skill}/SKILL.md에 description 없음`)
    continue
  }
  const result = evaluateTrigger({ target: spec.skill, docs, should: spec.should ?? [], shouldNot: spec.shouldNot ?? [], contested: spec.contested ?? [] })
  passed += result.passed
  total += result.total
  for (const failure of result.failures) errors.push(`${spec.skill} ${failure.kind} "${failure.query}" → ${failure.detail}`)
  warnings.push(...result.warnings)
  for (const margin of result.margins) margins.push({ skill: spec.skill, ...margin })
  if (verbose) for (const line of result.lines) console.log(`  ${spec.skill} ${line}`)
}
// 평가 파일이 없는 스킬 — 스킬을 더하면 평가도 같이 더해야 한다
for (const name of skillNames) if (!covered.has(name)) errors.push(`${name}: evals/trigger/${name}.json 없음`)

if (showMargins) {
  console.log('2위와 점수 차가 가장 작은 should 질의 10개:')
  margins
    .sort((a, b) => a.margin - b.margin)
    .slice(0, 10)
    .forEach((m) => console.log(`  ${m.margin.toFixed(1).padStart(5)}  ${m.skill} "${m.query}" (2위 ${m.second})`))
}

if (warnings.length > 0) {
  console.log(`경쟁 질의 동점 ${warnings.length}건 — 단어 겹침으로는 가를 수 없다. 실제 모델로 재는 평가에서 확인한다:`)
  warnings.forEach((warning) => console.log(`  - ${warning}`))
}

if (errors.length > 0) {
  console.error(`트리거 평가 실패 ${errors.length}건 (통과 ${passed}/${total}):`)
  errors.forEach((error) => console.error(`  - ${error}`))
  process.exit(1)
}
console.log(`트리거 평가 통과 ${passed}/${total} (스킬 ${skills.length}개, decoy ${decoys.length}개)`)
