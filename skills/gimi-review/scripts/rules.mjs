/**
 * 규칙 보이기(설계 결정 43) — 공통 금지선·분야 프리셋·회사 규칙 가운데 이 프로젝트의 설정에 맞는 것만 보인다.
 * 설정 .agents/gimi.json의 stacks(대상)·presets와 회사 규칙(docs/gimi/rules.md)의 "끈 프리셋 규칙"을 반영한다.
 * 에이전트는 목록을 먼저 보고, 필요한 규칙만 --id로 전문을 읽는다.
 *
 *   node rules.mjs                        # 설정에 맞는 규칙을 한 줄씩
 *   node rules.mjs --area test,code       # 공통 금지선의 영역을 고른다(기본 세 영역 모두)
 *   node rules.mjs --id COM-003,SHOP-001  # 그 규칙의 절을 그대로
 *   node rules.mjs --full                 # 걸러진 규칙의 절을 모두
 *   node rules.mjs --boundaries           # 프리셋·회사 규칙의 경계값 가운데 stacks에 맞는 층만
 *   node rules.mjs --json
 *
 * 종료 코드: 0 보임, 1 --id에 없는 ID가 있음, 2 사용법 오류. 의존성 없음, Node 22 이상.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { attempt, createExec } from './lib/exec.mjs'
import { itemText, matchesStacks, parseRuleFile } from './lib/rulefile.mjs'

const USAGE = '사용: node rules.mjs [--area test,code,review] [--id ID,…] [--full] [--boundaries] [--json]'
const HERE = dirname(fileURLToPath(import.meta.url))
const AREAS = ['test', 'code', 'review']
const COMPANY_PATH = 'docs/gimi/rules.md'
const INTERPRETED = /해석 — 팀 확인 필요/

const parseArgs = (argv) => {
  const args = { areas: AREAS, ids: null, full: false, boundaries: false, json: false, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--full') args.full = true
    else if (arg === '--boundaries') args.boundaries = true
    else if (arg === '--json') args.json = true
    else if (arg === '--help' || arg === '-h') args.help = true
    else if (arg === '--area' || arg === '--id') {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg}에 값이 없다`)
      const list = value.split(',').map((v) => v.trim()).filter(Boolean)
      if (arg === '--area') {
        const unknown = list.filter((area) => !AREAS.includes(area))
        if (unknown.length > 0) throw new Error(`모르는 영역 ${unknown.join(', ')} — ${AREAS.join('·')} 중에서 고른다`)
        args.areas = list
      } else args.ids = list
      i += 1
    } else throw new Error(`모르는 옵션 ${arg}`)
  }
  return args
}

const readText = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null)
const head = (value) => value.split(/[(\s]/)[0]
const targetOf = (rule) => {
  const target = itemText(rule, '대상')
  return target ? (target.startsWith('둘 다') ? '둘 다' : head(target)) : '둘 다'
}

/** 규칙 절의 원문 — 제목 줄부터 다음 제목 앞까지 */
const sectionOf = (text, rule) => {
  const lines = text.split('\n')
  const out = [lines[rule.line - 1]]
  for (let k = rule.line; k < lines.length && !/^#{1,2} /.test(lines[k]); k += 1) out.push(lines[k])
  while (out.length > 1 && out.at(-1).trim() === '') out.pop()
  return out.join('\n')
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
  const root = attempt(() => createExec({ cwd: process.cwd() }).git(['rev-parse', '--show-toplevel']).trim()) || process.cwd()
  const notes = []
  const configText = readText(join(root, '.agents/gimi.json'))
  const config = configText == null ? {} : (attempt(() => JSON.parse(configText)) ?? (notes.push('.agents/gimi.json을 읽지 못했다 — 기본값으로 보였다'), {}))
  const stacks = Array.isArray(config.stacks) && config.stacks.length > 0 ? config.stacks : ['frontend-ts']
  const available = existsSync(join(HERE, '../shared/domains')) ? readdirSync(join(HERE, '../shared/domains')).filter((name) => existsSync(join(HERE, '../shared/domains', name, 'rules.md'))).sort() : []
  const presets = (Array.isArray(config.presets) ? config.presets : []).filter((name) => {
    if (available.includes(name)) return true
    notes.push(`프리셋 ${name}이 없다 — 있는 프리셋은 ${available.join('·')}다`)
    return false
  })

  // 출처마다 규칙 파일 — 공통 금지선 영역, 프리셋, 회사 규칙
  const sources = AREAS.map((area) => ({ kind: 'slop', name: area, path: join(HERE, `../shared/rules/${area}.md`) }))
  for (const name of available) sources.push({ kind: 'preset', name, path: join(HERE, '../shared/domains', name, 'rules.md') })
  const companyText = readText(join(root, COMPANY_PATH))
  if (companyText != null) sources.push({ kind: 'company', name: 'company', path: join(root, COMPANY_PATH), text: companyText })
  for (const source of sources) {
    source.text ??= readText(source.path) ?? ''
    source.file = parseRuleFile(source.text)
  }
  const company = sources.find((s) => s.kind === 'company')

  if (args.ids) {
    const sections = []
    const missing = []
    for (const id of args.ids) {
      const found = sources.map((s) => ({ s, rule: s.file.rules.find((r) => r.id === id) })).find((x) => x.rule)
      if (found) sections.push(sectionOf(found.s.text, found.rule))
      else missing.push(id)
    }
    if (sections.length > 0) process.stdout.write(`${sections.join('\n\n')}\n`)
    if (missing.length > 0) {
      console.error(`없는 규칙 ID: ${missing.join(', ')}`)
      return 1
    }
    return 0
  }

  // 끈 프리셋 규칙 — 이유가 있어야 끈다
  const disabled = new Set()
  for (const entry of company?.file.disabled ?? []) {
    if (entry.reason) disabled.add(entry.id)
    else notes.push(`${COMPANY_PATH}:${entry.line} ${entry.id} — 끈 이유가 없어 끄지 않았다(- ${entry.id} — 이유)`)
  }

  const chosen = sources.filter((s) => (s.kind === 'slop' ? args.areas.includes(s.name) : s.kind === 'preset' ? presets.includes(s.name) : true))
  const picked = chosen.map((source) => ({
    source,
    rules: source.file.rules.filter((rule) => matchesStacks(itemText(rule, '대상') || '둘 다', stacks) && !(source.kind === 'preset' && disabled.has(rule.id))),
    off: source.kind === 'preset' ? source.file.rules.filter((rule) => disabled.has(rule.id)).length : 0,
  }))

  if (presets.includes('kr-commerce-law') && !(config.kcl?.periodCounting && config.kcl?.businessDays)) {
    const kcl = sources.find((s) => s.name === 'kr-commerce-law')
    const interpreted = kcl.file.rules.filter((rule) => INTERPRETED.test(sectionOf(kcl.text, rule))).map((rule) => rule.id)
    notes.push(`kr-commerce-law의 해석 값(kcl.periodCounting·kcl.businessDays)이 설정되지 않았다 — ${interpreted.join('·')}의 기간·영업일 계산은 단정하지 말고 확인 질문으로 올린다`)
  }

  if (args.json) {
    const rules = picked.flatMap(({ source, rules }) =>
      rules.map((rule) => ({ source: source.name, id: rule.id, title: rule.title, target: targetOf(rule), check: source.kind === 'slop' ? head(itemText(rule, '검사')) : null })),
    )
    process.stdout.write(`${JSON.stringify({ version: 1, stacks, presets, company: company ? COMPANY_PATH : null, rules, notes }, null, 2)}\n`)
    return 0
  }

  const rows = []
  if (args.boundaries) {
    rows.push(`경계값    stacks ${stacks.join('·')}`)
    for (const { source, rules } of picked) {
      if (source.kind === 'slop') continue
      for (const rule of rules) {
        const item = rule.items.get('경계값')
        if (!item) continue
        const lines = [...(item.value ? [item.value] : []), ...item.list].filter((line) => matchesStacks(line, stacks))
        if (lines.length > 0) rows.push(`  ${rule.id} ${rule.title}`, ...lines.map((line) => `    ${line}`))
      }
    }
  } else if (args.full) {
    for (const { source, rules } of picked) for (const rule of rules) rows.push(sectionOf(source.text, rule), '')
  } else {
    rows.push(`규칙      stacks ${stacks.join('·')} · 프리셋 ${presets.length > 0 ? presets.join('·') : '없음'} · 회사 규칙 ${company ? `${COMPANY_PATH} ${company.file.rules.length}개` : '없음'}`)
    const slop = picked.filter(({ source }) => source.kind === 'slop')
    if (slop.length > 0) {
      rows.push(`공통 금지선  ${slop.map(({ source, rules }) => `${source.name} ${rules.length}`).join(' · ')}`)
      for (const { rules } of slop) for (const rule of rules) rows.push(`  ${rule.id}  ${rule.title}  [${targetOf(rule)} · 검사 ${head(itemText(rule, '검사'))}]`)
    }
    for (const { source, rules, off } of picked.filter(({ source }) => source.kind === 'preset')) {
      rows.push(`프리셋 ${source.name}  ${rules.length}개${off > 0 ? ` · 끈 규칙 ${off}개` : ''}`)
      for (const rule of rules) rows.push(`  ${rule.id}  ${rule.title}  [${targetOf(rule)}]`)
    }
    for (const { rules } of picked.filter(({ source }) => source.kind === 'company')) {
      rows.push(`회사 규칙  ${rules.length}개`)
      for (const rule of rules) rows.push(`  ${rule.id}  ${rule.title}  [${targetOf(rule)}]`)
    }
  }
  for (const note of notes) rows.push(`참고      ${note}`)
  if (!args.boundaries && !args.full) rows.push('전문      --id ID(여러 개는 쉼표), 걸러진 전부는 --full, 리뷰에서 짚을 경계값은 --boundaries')
  process.stdout.write(`${rows.join('\n')}\n`)
  return 0
}

// process.exit()는 파이프로 나가는 큰 출력을 자를 수 있어 종료 코드만 정한다
process.exitCode = main()
