/**
 * 테스트 패턴(설계 결정 28~31) — skills/gimi-test/patterns/{패턴}/PATTERN.md와 assets/의 좋은 예시·슬롭 예시.
 * PATTERN.md 형식 검사, SKILL.md의 패턴 카탈로그(생성 블록), 패턴 선택 평가(요청에 맞는 패턴이 1위인가)의 순수 로직이다.
 * 파일 읽기는 scripts/validateSkills.mjs·buildCatalog.mjs·evalSelection.mjs가 맡는다.
 */
import { bodyOf, fieldOf, frontmatterOf } from './frontmatter.mjs'
import { DEFAULT_STOPWORDS } from './selection.mjs'
import { evaluateTrigger, validateSpec } from './trigger.mjs'

export const TARGETS = ['둘 다', '프론트', '백엔드']
// 본문 순서(설계 5절 "PATTERN.md 본문 순서") — 이 절들이 이 순서로 있어야 하고, 뒤에 절을 더할 수 있다
export const PATTERN_SECTIONS = ['언제 쓰는가', '무엇을 단언하는가', '예시', 'AI가 흔히 쓰는 테스트', 'Jest와 다른 줄', '주의사항']
export const CATALOG_START = '<!-- catalog:start -->'
export const CATALOG_END = '<!-- catalog:end -->'
const MIN_QUERIES = 3

const TEST_ASSET = /\.test\.tsx?$/
const isSlop = (file) => /\.slop\.test\.tsx?$/.test(file)

/** @param {string} md */
export const parsePatternDoc = (md) => {
  const frontmatter = frontmatterOf(md)
  return { name: fieldOf({ frontmatter, key: 'name' }), description: fieldOf({ frontmatter, key: 'description' }), target: fieldOf({ frontmatter, key: 'target' }) }
}

/**
 * PATTERN.md 하나 — 오류 문장 목록
 * @param {{ name: string, md: string, assets: string[] }} args 폴더 이름, 문서 내용, assets/의 파일 이름
 */
export const checkPatternDoc = ({ name, md, assets }) => {
  const label = `skills/gimi-test/patterns/${name}/PATTERN.md`
  if (!frontmatterOf(md)) return [`${label}: frontmatter 없음`]
  const errors = []
  const doc = parsePatternDoc(md)
  if (doc.name !== name) errors.push(`${label}: frontmatter name(${doc.name})이 폴더명(${name})과 다름`)
  // description은 카탈로그에 그대로 실려 에이전트가 패턴을 고르는 단서가 된다
  const bytes = Buffer.byteLength(doc.description, 'utf8')
  if (doc.description.length < 80 || bytes > 1024) errors.push(`${label}: description ${doc.description.length}자·${bytes}바이트 (80자 이상, 1,024바이트 이하)`)
  if (doc.description.includes(': ')) errors.push(`${label}: description에 ": "가 있음 — YAML 해석이 깨진다`)
  if (!TARGETS.includes(doc.target)) errors.push(`${label}: target은 ${TARGETS.join('·')} 중 하나다 — 지금 ${doc.target || '없음'}`)

  const body = bodyOf(md)
  const headings = [...body.matchAll(/^## (.+)$/gm)].map((match) => match[1].trim())
  const positions = PATTERN_SECTIONS.map((section) => headings.findIndex((heading) => heading.startsWith(section)))
  PATTERN_SECTIONS.forEach((section, i) => {
    if (positions[i] === -1) errors.push(`${label}: "## ${section}" 절이 없다`)
  })
  const found = positions.filter((position) => position !== -1)
  if (found.some((position, i) => i > 0 && position < found[i - 1])) errors.push(`${label}: 절 순서는 ${PATTERN_SECTIONS.join(' → ')}다`)

  const tests = assets.filter((file) => TEST_ASSET.test(file))
  if (!tests.some((file) => !isSlop(file))) errors.push(`${label}: 좋은 예시(assets/*.test.ts(x))가 없다`)
  if (!tests.some(isSlop)) errors.push(`${label}: 슬롭 예시(assets/*.slop.test.ts(x))가 없다 — 결함 버전에서도 통과해 결함을 놓친다는 것을 보인다`)
  const refs = new Set([...body.matchAll(/assets\/([\w.-]+)/g)].map((match) => match[1]))
  for (const ref of refs) if (!assets.includes(ref)) errors.push(`${label}: 참조 경로 없음 — assets/${ref}`)
  for (const file of tests) if (!refs.has(file)) errors.push(`${label}: assets/${file} — 본문이 가리키지 않는다`)
  return errors
}

const escapeCell = (text) => text.replace(/\|/g, '\\|')

/**
 * SKILL.md의 패턴 카탈로그 — 표시 사이에 넣는 블록. 손으로 고치면 패턴을 더할 때 뒤처지므로 생성으로만 만든다
 * @param {{ name: string, description: string, target: string }[]} patterns
 */
export const renderCatalog = (patterns) => {
  const order = (pattern) => TARGETS.indexOf(pattern.target)
  const rows = [...patterns]
    .sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name))
    .map((pattern) => `| [\`${pattern.name}\`](patterns/${pattern.name}/PATTERN.md) | ${pattern.target} | ${escapeCell(pattern.description)} |`)
  return [CATALOG_START, '| 패턴 | 대상 | 무엇을·언제 |', '|---|---|---|', ...rows, CATALOG_END].join('\n')
}

/** 문서의 카탈로그 표시 사이를 block으로 바꾼다. 표시가 없으면 null */
export const replaceBlock = ({ document, block }) => {
  const start = document.indexOf(CATALOG_START)
  const end = document.indexOf(CATALOG_END)
  if (start === -1 || end === -1 || end < start) return null
  return document.slice(0, start) + block + document.slice(end + CATALOG_END.length)
}

/**
 * 패턴 선택 평가 — 에이전트는 SKILL.md 카탈로그의 description을 보고 패턴을 고른다.
 * 평가 파일(evals/selection/{패턴}.json)마다 should 요청은 그 패턴이 혼자 1위, shouldNot 요청은 1위가 아니어야 한다.
 * @param {{ patterns: { name: string, description: string }[], specs: { file: string, spec: { pattern?: string, should?: string[], shouldNot?: string[] } }[] }} args
 */
export const evaluatePatternSelection = ({ patterns, specs }) => {
  const errors = []
  const lines = []
  const margins = []
  let passed = 0
  let total = 0
  const docs = patterns.map(({ name, description }) => ({ name, description }))
  const covered = new Set()
  for (const { file, spec } of specs) {
    covered.add(spec.pattern)
    if (!patterns.some((pattern) => pattern.name === spec.pattern)) {
      errors.push(`${file}: skills/gimi-test/patterns/${spec.pattern}/PATTERN.md 없음`)
      continue
    }
    errors.push(...validateSpec({ spec, minShould: MIN_QUERIES, minShouldNot: MIN_QUERIES }))
    const result = evaluateTrigger({ target: spec.pattern, docs, should: spec.should ?? [], shouldNot: spec.shouldNot ?? [], stopwords: DEFAULT_STOPWORDS })
    passed += result.passed
    total += result.total
    for (const failure of result.failures) errors.push(`${spec.pattern} ${failure.kind} "${failure.query}" → ${failure.detail}`)
    for (const line of result.lines) lines.push(`${spec.pattern} ${line}`)
    for (const margin of result.margins) margins.push({ pattern: spec.pattern, ...margin })
  }
  for (const pattern of patterns) if (!covered.has(pattern.name)) errors.push(`${pattern.name}: evals/selection/${pattern.name}.json 없음 — 패턴마다 선택 평가를 문서보다 먼저 쓴다`)
  return { passed, total, errors, lines, margins }
}
