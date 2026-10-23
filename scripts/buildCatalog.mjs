#!/usr/bin/env node
/**
 * 패턴 카탈로그 생성 — skills/gimi-test/SKILL.md의 카탈로그 블록(<!-- catalog:start --> … end)을 다시 쓴다.
 * 정본은 각 patterns/{패턴}/PATTERN.md의 name·description·target이다. 에이전트는 표에 없는 패턴을 고르지 못하므로 생성으로만 만든다.
 *
 *   npm run catalog                          블록을 다시 쓴다
 *   node scripts/buildCatalog.mjs --check    쓰지 않고 어긋났는지만 본다(어긋나면 exit 1)
 *
 * validateSkills.mjs·evalSelection.mjs가 readPatterns()·expectedSkillDocument()로 같은 것을 읽는다.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePatternDoc, renderCatalog, replaceBlock } from './lib/patterns.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
export const skillDocPath = join(root, 'skills/gimi-test/SKILL.md')
export const patternsDir = join(root, 'skills/gimi-test/patterns')

/** 패턴 폴더마다 PATTERN.md 내용과 assets/의 파일 이름 */
export const readPatterns = () =>
  (existsSync(patternsDir) ? readdirSync(patternsDir).sort() : []).flatMap((name) => {
    const folder = join(patternsDir, name)
    const docPath = join(folder, 'PATTERN.md')
    if (!statSync(folder).isDirectory() || !existsSync(docPath)) return []
    const md = readFileSync(docPath, 'utf8')
    const assetsDir = join(folder, 'assets')
    const assets = existsSync(assetsDir) ? readdirSync(assetsDir).sort() : []
    // name은 폴더 이름이다 — frontmatter의 name과 같은지는 구조 검사가 본다
    const { description, target } = parsePatternDoc(md)
    return [{ name, md, assets, description, target }]
  })

/** 지금 PATTERN.md로 만든 SKILL.md — 표시가 없으면 null */
export const expectedSkillDocument = () =>
  replaceBlock({ document: readFileSync(skillDocPath, 'utf8'), block: renderCatalog(readPatterns()) })

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const current = readFileSync(skillDocPath, 'utf8')
  const expected = expectedSkillDocument()
  if (expected === null) {
    console.error('skills/gimi-test/SKILL.md에 카탈로그 표시(<!-- catalog:start --> … <!-- catalog:end -->)가 없다')
    process.exit(1)
  }
  if (process.argv.includes('--check')) {
    if (current !== expected) {
      console.error('패턴 카탈로그가 PATTERN.md와 어긋남 — npm run catalog로 다시 만든다')
      process.exit(1)
    }
    console.log('패턴 카탈로그 동기됨')
  } else if (current === expected) console.log('패턴 카탈로그 변경 없음')
  else {
    writeFileSync(skillDocPath, expected)
    console.log(`패턴 카탈로그 갱신: ${readPatterns().length}개 → skills/gimi-test/SKILL.md`)
  }
}
