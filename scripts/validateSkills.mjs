#!/usr/bin/env node
/**
 * 스킬 구조 검사 — 두 스킬(skills/gimi-review·gimi-test)과 플러그인 매니페스트, 공통 지침이 약속한 모양인지 본다.
 * 판단은 scripts/lib/skills.mjs의 순수 함수가 하고, 여기서는 파일을 읽어 넘기고 결과를 출력한다.
 * 실패하면 exit 1(CI·완료 게이트용).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RULE_SEVERITY } from '../skills/gimi-test/scripts/lib/slop.mjs'
import { expectedSkillDocument, readPatterns } from './buildCatalog.mjs'
import { expectedSlopDocuments } from './buildSlopTable.mjs'
import { checkPatternDoc } from './lib/patterns.mjs'
import { PRESET_PREFIX, SHARED_FILES, SKILLS, checkAgentDocs, checkManifests, checkRoot, checkRules, checkSharedCopies, checkSkillDoc, checkSkillSet } from './lib/skills.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const errors = []

const readText = (path) => (existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : null)
const readJson = (path) => {
  const text = readText(path)
  if (text == null) {
    errors.push(`${path} 없음`)
    return {}
  }
  return JSON.parse(text)
}
const findSkillDocs = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return findSkillDocs(join(dir, entry.name))
    return entry.name === 'SKILL.md' ? [relative(root, join(dir, entry.name))] : []
  })

const skillsDir = join(root, 'skills')
errors.push(...checkSkillSet({ skillDocs: existsSync(skillsDir) ? findSkillDocs(skillsDir) : [] }))
for (const name of SKILLS) {
  const md = readText(`skills/${name}/SKILL.md`)
  if (md == null) continue
  errors.push(...checkSkillDoc({ name, md, exists: (ref) => existsSync(join(skillsDir, name, ref)) }))
}

// 두 스킬이 함께 쓰는 파일의 복사본 — 스크립트 폴더의 .mjs와 shared/ 폴더의 .md 전부
const filesUnder = (dir, ext, base = dir) =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) return filesUnder(path, ext, base)
        return entry.name.endsWith(ext) ? [relative(base, path)] : []
      })
    : []
const skillFiles = (skill) =>
  [...filesUnder(join(skillsDir, skill, 'scripts'), '.mjs', join(skillsDir, skill)), ...filesUnder(join(skillsDir, skill, 'shared'), '.md', join(skillsDir, skill))].map((path) => ({
    skill,
    path,
    text: readFileSync(join(skillsDir, skill, path), 'utf8'),
  }))
errors.push(...checkSharedCopies({ files: SKILLS.flatMap(skillFiles) }))

// 테스트 패턴 — PATTERN.md 형식과, SKILL.md 카탈로그가 PATTERN.md에서 만든 것과 같은지
const patterns = readPatterns()
for (const pattern of patterns) errors.push(...checkPatternDoc(pattern))
const expectedTestSkill = expectedSkillDocument()
if (expectedTestSkill === null) errors.push('skills/gimi-test/SKILL.md: 패턴 카탈로그 표시(<!-- catalog:start --> … <!-- catalog:end -->)가 없다')
else if (expectedTestSkill !== readText('skills/gimi-test/SKILL.md')) errors.push('skills/gimi-test/SKILL.md: 패턴 카탈로그가 PATTERN.md와 어긋남 — npm run catalog로 다시 만든다')

// 금지선 표(결정 34) — 두 스킬 SKILL.md의 표가 규칙 파일의 근거로 만든 것과 같은지
for (const { skill, current, expected } of expectedSlopDocuments(root)) {
  if (expected === null) errors.push(`skills/${skill}/SKILL.md: 금지선 표 표시(<!-- slop-table:start --> … <!-- slop-table:end -->)가 없다`)
  else if (expected !== current) errors.push(`skills/${skill}/SKILL.md: 금지선 표가 규칙 파일의 근거와 어긋남 — node scripts/buildSlopTable.mjs로 다시 만든다`)
}

// 규칙 파일 — 두 스킬 모두 공통 금지선 네 영역과 분야 프리셋을 갖는다. 형식과 check.mjs와의 대조는 원본만 본다(복사본은 바이트가 같다)
const ruleFiles = []
for (const skill of SKILLS) {
  for (const path of SHARED_FILES) if (!existsSync(join(skillsDir, skill, path))) errors.push(`skills/${skill}/${path} 없음`)
}
for (const skill of SKILLS) {
  for (const path of SHARED_FILES) {
    const text = readText(`skills/${skill}/${path}`)
    if (text == null || !text.startsWith(`<!-- @shared ${path.split('/').at(-1)} origin: ${skill} -->`)) continue
    const area = path.match(/^shared\/rules\/(\w+)\.md$/)?.[1]
    const preset = path.match(/^shared\/domains\/([\w-]+)\/rules\.md$/)?.[1]
    ruleFiles.push(area ? { path: `skills/${skill}/${path}`, text, kind: 'slop', area } : { path: `skills/${skill}/${path}`, text, kind: 'preset', prefix: PRESET_PREFIX[preset] })
  }
}
errors.push(...checkRules({ files: ruleFiles, slopSeverity: RULE_SEVERITY }))

errors.push(
  ...checkManifests({
    claudePlugin: readJson('.claude-plugin/plugin.json'),
    claudeMarketplace: readJson('.claude-plugin/marketplace.json'),
    codexPlugin: readJson('.codex-plugin/plugin.json'),
    agentsMarketplace: readJson('.agents/plugins/marketplace.json'),
  }),
)
errors.push(...checkRoot({ entries: readdirSync(root) }))
errors.push(...checkAgentDocs({ agentsMd: readText('AGENTS.md'), claudeMd: readText('CLAUDE.md') }))

if (errors.length > 0) {
  console.error(`스킬 구조 검사 실패 ${errors.length}건:`)
  errors.forEach((error) => console.error(`  - ${error}`))
  process.exit(1)
}
console.log(`스킬 구조 검사 통과 (스킬 ${SKILLS.join('·')}, 패턴 ${patterns.length}개, 매니페스트 4개)`)
