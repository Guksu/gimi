/**
 * 스킬 구조 검사의 순수 로직 — 입력(문서 내용·매니페스트·파일 목록)을 받아 오류 문장 목록을 돌려준다.
 * 파일 읽기와 종료 코드는 scripts/validateSkills.mjs가 맡는다. suta의 validateSkills.mjs에서 gimi에 맞는 검사만 가져왔다.
 */
import { checkRuleFile, itemText, parseRuleFile } from '../../skills/gimi-review/scripts/lib/rulefile.mjs'
import { bodyOf, fieldOf, frontmatterOf } from './frontmatter.mjs'

export const SKILLS = ['gimi-review', 'gimi-test']
// 두 스킬이 모두 갖는 공유 파일 — 공통 금지선 네 영역(결정 43)과 분야 프리셋(결정 39)
export const SHARED_FILES = ['shared/rules/test.md', 'shared/rules/code.md', 'shared/rules/review.md', 'shared/rules/done.md', 'shared/domains/commerce/rules.md', 'shared/domains/kr-commerce-law/rules.md']
export const PRESET_PREFIX = { commerce: 'COM', 'kr-commerce-law': 'KCL' }
export const PLUGIN = 'gimi'
// 저장소 루트가 곧 플러그인이라, 이런 것이 생기면 설치한 사용자 환경에 그대로 로드된다
const ROOT_COMPONENTS = ['commands', 'agents', 'hooks', 'output-styles', '.mcp.json']
// 본문이 가리키는 스킬 안의 경로 — 설치된 프로젝트에도 함께 들어가므로 실재해야 한다(회사 저장소 경로 docs/gimi/…는 대상이 아니다)
const SKILL_REF = /`((?:references|scripts|patterns|shared)\/[^`*{}\s]+)`|\]\(((?:references|scripts|patterns|shared)\/[^)\s]+)\)/g

/**
 * SKILL.md 하나 — frontmatter·name·description·본문 길이·참조 경로
 * @param {{ name: string, md: string, exists: (relativePath: string) => boolean }} args 폴더 이름, 문서 내용, 스킬 폴더 기준 경로가 있는지
 * @returns {string[]}
 */
export const checkSkillDoc = ({ name, md, exists }) => {
  const label = `skills/${name}/SKILL.md`
  const frontmatter = frontmatterOf(md)
  if (!frontmatter) return [`${label}: frontmatter 없음`]
  const errors = []

  const fmName = fieldOf({ frontmatter, key: 'name' })
  if (fmName !== name) errors.push(`${label}: frontmatter name(${fmName})이 폴더명(${name})과 다름`)
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(fmName) || fmName.length > 64) errors.push(`${label}: name(${fmName})은 소문자·숫자·하이픈 64자 이하여야 한다`)

  // description은 에이전트가 스킬을 고르는 유일한 단서다 — 너무 짧으면 걸리지 않고, 도구에 따라 1,024바이트에서 잘린다
  const description = fieldOf({ frontmatter, key: 'description' })
  const bytes = Buffer.byteLength(description, 'utf8')
  if (description.length < 80 || bytes > 1024) errors.push(`${label}: description ${description.length}자·${bytes}바이트 (80자 이상, 1,024바이트 이하)`)
  if (description.includes(': ')) errors.push(`${label}: description에 ": "가 있음 — YAML 해석이 깨진다`)
  if (/이 스킬을 사용/.test(description)) errors.push(`${label}: description에 에이전트 명령문이 있음 — 3인칭으로 무엇을·언제만 적는다`)

  const body = bodyOf(md)
  const bodyLines = body.split('\n').length
  if (bodyLines > 500) errors.push(`${label}: 본문 ${bodyLines}줄 (500줄 이하 — 요청마다 통째로 읽힌다)`)

  const refs = new Set([...body.matchAll(SKILL_REF)].map((match) => match[1] ?? match[2]))
  for (const ref of refs) if (!exists(ref)) errors.push(`${label}: 참조 경로 없음 — ${ref}`)
  return errors
}

/**
 * skills/ 아래 SKILL.md 목록 — 두 스킬의 것뿐이어야 한다. 하위 문서가 SKILL.md면 도구가 별도 스킬로 등록해 두 스킬과 경쟁한다
 * @param {{ skillDocs: string[] }} args 저장소 루트 기준 경로
 */
export const checkSkillSet = ({ skillDocs }) => {
  const expected = SKILLS.map((name) => `skills/${name}/SKILL.md`)
  const actual = [...skillDocs].sort()
  if (actual.length === expected.length && actual.every((path, index) => path === expected[index])) return []
  return [`skills/ 아래 SKILL.md는 ${expected.join('·')}여야 한다 — 지금: ${actual.join(', ') || '없음'}`]
}

/**
 * 매니페스트 넷 — Claude Code(plugin·marketplace)와 Codex(plugin·marketplace)의 이름·버전·경로가 맞고 훅이 없어야 한다
 * @param {{ claudePlugin: any, claudeMarketplace: any, codexPlugin: any, agentsMarketplace: any }} manifests
 */
export const checkManifests = ({ claudePlugin, claudeMarketplace, codexPlugin, agentsMarketplace }) => {
  const errors = []
  const claudeEntry = claudeMarketplace.plugins?.[0] ?? {}
  const agentsEntry = agentsMarketplace.plugins?.[0] ?? {}

  const names = {
    '.claude-plugin/plugin.json': claudePlugin.name,
    '.claude-plugin/marketplace.json': claudeMarketplace.name,
    '.claude-plugin/marketplace.json plugins[0]': claudeEntry.name,
    '.codex-plugin/plugin.json': codexPlugin.name,
    '.agents/plugins/marketplace.json': agentsMarketplace.name,
    '.agents/plugins/marketplace.json plugins[0]': agentsEntry.name,
  }
  const wrongNames = Object.entries(names).filter(([, value]) => value !== PLUGIN)
  if (wrongNames.length > 0) errors.push(`매니페스트 이름이 ${PLUGIN}이 아님 — ${wrongNames.map(([where, value]) => `${where}(${value})`).join(', ')}`)

  // 버전을 올릴 때 한쪽만 고치면 도구마다 다른 버전이 설치된다
  const versions = {
    '.claude-plugin/plugin.json': claudePlugin.version,
    '.claude-plugin/marketplace.json metadata': claudeMarketplace.metadata?.version,
    '.claude-plugin/marketplace.json plugins[0]': claudeEntry.version,
    '.codex-plugin/plugin.json': codexPlugin.version,
  }
  if (new Set(Object.values(versions)).size !== 1) errors.push(`매니페스트 버전이 다름 — ${Object.entries(versions).map(([where, value]) => `${where} ${value}`).join(', ')}`)

  if (claudeEntry.source !== './') errors.push('.claude-plugin/marketplace.json 플러그인 source는 "./"(저장소 루트)여야 한다')
  if (agentsEntry.source?.source !== 'local' || agentsEntry.source?.path !== './') errors.push('.agents/plugins/marketplace.json 플러그인 source는 { "source": "local", "path": "./" }여야 한다')
  if (codexPlugin.skills !== './skills/') errors.push('.codex-plugin/plugin.json의 skills는 "./skills/"여야 한다')

  // 설치만으로 모든 프로젝트에서 훅이 돌지 않게 한다 — 끝내기 전 검사는 프로젝트별 옵트인(설계 결정 9)
  for (const [where, manifest] of [['.claude-plugin/plugin.json', claudePlugin], ['.codex-plugin/plugin.json', codexPlugin]]) {
    if (manifest.hooks) errors.push(`${where}: 훅이 있음 — gimi는 매니페스트에 훅을 두지 않는다(설계 결정 7·9)`)
  }
  return errors
}

// .mjs는 // 주석, Markdown은 HTML 주석으로 첫 줄에 단다
const SHARED_HEADER = /^(?:\/\/|<!--) @shared (\S+) origin: ([\w-]+)\s*(?:-->)?\s*$/

/**
 * 두 스킬이 함께 쓰는 파일 — 각 스킬에 복사본을 두고(스킬 하나만 설치해도 돈다), 첫 줄 머리로 원본을 가리킨다.
 * 복사본은 원본과 바이트 단위로 같아야 한다. 한쪽만 고치면 두 스킬이 다르게 동작한다.
 * @param {{ files: { skill: string, path: string, text: string }[] }} args path는 스킬 폴더 기준
 */
export const checkSharedCopies = ({ files }) => {
  const errors = []
  const byKey = new Map(files.map((file) => [`${file.skill}/${file.path}`, file]))
  for (const file of files) {
    const header = file.text.split('\n')[0].match(SHARED_HEADER)
    if (!header) continue
    const [, name, origin] = header
    const label = `skills/${file.skill}/${file.path}`
    if (!file.path.endsWith(`/${name}`)) errors.push(`${label}: @shared 머리의 파일 이름(${name})이 실제 파일 이름과 다름`)
    if (origin === file.skill) continue
    const source = byKey.get(`${origin}/${file.path}`)
    if (!source) errors.push(`${label}: 원본 skills/${origin}/${file.path} 없음`)
    else if (source.text !== file.text) errors.push(`${label}: 원본 skills/${origin}/${file.path}과 다름 — 원본을 다시 복사한다`)
  }
  return errors
}

/**
 * 규칙 파일(공통 금지선·분야 프리셋)의 형식과, 검사 error·warn 줄이 check.mjs가 실제로 내는 지적과 맞는지
 * @param {{ files: { path: string, text: string, kind: 'slop' | 'preset', area?: string, prefix?: string }[], slopSeverity: Record<string, 'error' | 'warn'> }} args
 */
export const checkRules = ({ files, slopSeverity }) => {
  const errors = files.flatMap((file) => checkRuleFile(file))
  const declared = new Map()
  for (const file of files.filter((f) => f.kind === 'slop')) {
    for (const rule of parseRuleFile(file.text).rules) {
      const check = itemText(rule, '검사').match(/^(error|warn)\b/)?.[1]
      if (check) declared.set(rule.id, { check, path: file.path })
    }
  }
  for (const [id, { check, path }] of declared) {
    if (!(id in slopSeverity)) errors.push(`${path} ${id} — 검사 ${check}인데 check.mjs에 없다 — 검사를 구현하거나 검사 항목을 리뷰로 바꾼다`)
    else if (slopSeverity[id] !== check) errors.push(`${path} ${id} — 검사는 ${check}인데 check.mjs는 ${slopSeverity[id]}로 낸다`)
  }
  for (const id of Object.keys(slopSeverity)) if (!declared.has(id)) errors.push(`${id} — check.mjs가 내는 지적인데 규칙 파일에 없다(또는 검사가 error·warn이 아니다)`)
  return errors
}

/** @param {{ entries: string[] }} args 저장소 루트의 파일·폴더 이름 */
export const checkRoot = ({ entries }) =>
  ROOT_COMPONENTS.filter((component) => entries.includes(component)).map((component) => `루트에 ${component}이(가) 있음 — 플러그인 구성으로 사용자 환경에 로드된다`)

/**
 * 공통 지침 — 다른 에이전트와 Claude가 같은 규칙을 읽어야 한다
 * @param {{ agentsMd: string | null, claudeMd: string | null }} args
 */
export const checkAgentDocs = ({ agentsMd, claudeMd }) => {
  const errors = []
  if (agentsMd == null) errors.push('AGENTS.md 없음 — 공통 작업 지침의 단일 출처다')
  if (!/^@AGENTS\.md\s*$/m.test(claudeMd ?? '')) errors.push('CLAUDE.md가 @AGENTS.md를 가져오지 않음 — 첫 줄에 @AGENTS.md')
  return errors
}
