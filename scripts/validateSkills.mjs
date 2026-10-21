#!/usr/bin/env node
/**
 * 스킬 구조 검사 — 두 스킬(skills/gimi-review·gimi-test)과 플러그인 매니페스트, 공통 지침이 약속한 모양인지 본다.
 * 판단은 scripts/lib/skills.mjs의 순수 함수가 하고, 여기서는 파일을 읽어 넘기고 결과를 출력한다.
 * 실패하면 exit 1(CI·완료 게이트용).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SKILLS, checkAgentDocs, checkManifests, checkRoot, checkSharedCopies, checkSkillDoc, checkSkillSet } from './lib/skills.mjs'

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

// 두 스킬이 함께 쓰는 파일의 복사본 — 스킬의 스크립트 폴더 아래 .mjs 전부
const scriptFiles = (dir, base = dir) =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) return scriptFiles(path, base)
        return entry.name.endsWith('.mjs') ? [relative(base, path)] : []
      })
    : []
errors.push(
  ...checkSharedCopies({
    files: SKILLS.flatMap((skill) => scriptFiles(join(skillsDir, skill, 'scripts'), join(skillsDir, skill)).map((path) => ({ skill, path, text: readFileSync(join(skillsDir, skill, path), 'utf8') }))),
  }),
)

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
console.log(`스킬 구조 검사 통과 (스킬 ${SKILLS.join('·')}, 매니페스트 4개)`)
