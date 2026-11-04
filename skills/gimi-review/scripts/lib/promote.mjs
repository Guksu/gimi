/**
 * 반복 지적을 규칙 후보로(설계 결정 3·62) — 리뷰 기록(docs/gimi/reviews/*.md)에서 규칙에 걸리지 않은 지적을 묶음 이름으로 센다.
 * 같은 기록의 같은 묶음은 한 번으로 센다(서로 다른 리뷰에서 되풀이될 때만 후보). 판정이 틀림·의도함인 지적은 세지 않는다.
 * 이미 후보(candidates.md)나 회사 규칙(rules.md)에 "- 묶음:"으로 남은 묶음은 다시 올리지 않는다. 후보 초안은 에이전트가 쓰고 사람이 승인한다.
 */

const FINDING = /^## (\d+)\. \[(고쳐야 함|고치면 좋음|확인 질문)\]/
const RULE = /^- 규칙:\s*(.*)$/
const VERDICT = /^- 판정:\s*(.*)$/
const BUNDLE_LINE = /^- 묶음:\s*`?([^`\s]+)`?\s*$/
const NO_RULE = /^없음(?:\s*(?:—|–|-)\s*묶음\s+`?([^`\s]+)`?)?\s*$/
// 묶음 이름 — 영어 소문자·숫자·하이픈(대문자는 소문자로 읽는다)
const BUNDLE_NAME = /^[a-z0-9][a-z0-9-]*$/
const VERDICTS = ['미정', '맞음', '틀림', '의도함']
const EXCLUDED = new Set(['틀림', '의도함'])

const lines = (text) => String(text ?? '').replace(/\r\n?/g, '\n').split('\n')

const readRule = (raw) => {
  const value = raw.trim()
  if (!value) return { rule: null, bundle: null, problem: '규칙 줄 없음' }
  if (!value.startsWith('없음')) return { rule: value, bundle: null, problem: null }
  const name = value.match(NO_RULE)?.[1]?.toLowerCase()
  return name && BUNDLE_NAME.test(name) ? { rule: null, bundle: name, problem: null } : { rule: null, bundle: null, problem: '묶음 이름이 없거나 형식이 틀림' }
}

/**
 * 리뷰 기록의 지적("## N. [단계] 맥락 — 제목" 절)마다 규칙·묶음·판정을 읽는다
 * @param {string} text
 * @returns {{ index: number, level: string, rule: string | null, bundle: string | null, verdict: string, problem: string | null }[]}
 */
export const parseReviewRecord = (text) => {
  const findings = []
  let current = null
  for (const line of lines(text)) {
    if (line.startsWith('## ') || line.startsWith('# ')) {
      const heading = line.match(FINDING)
      current = heading ? { index: Number(heading[1]), level: heading[2], rule: null, bundle: null, verdict: '미정', problem: '규칙 줄 없음', ruleSeen: false } : null
      if (current) findings.push(current)
      continue
    }
    if (!current) continue
    const rule = line.match(RULE)
    if (rule && !current.ruleSeen) Object.assign(current, readRule(rule[1]), { ruleSeen: true })
    const verdict = line.match(VERDICT)
    if (verdict) current.verdict = VERDICTS.find((word) => verdict[1].trim().startsWith(word)) ?? '미정'
  }
  return findings.map(({ ruleSeen, ...finding }) => finding)
}

/**
 * 후보·회사 규칙 파일에서 "- 묶음:" 줄의 이름 — 이미 후보로 올렸거나(대기·거절) 규칙이 된 묶음
 * @param {string | null} text
 * @returns {string[]}
 */
export const readBundleNames = (text) =>
  lines(text)
    .map((line) => line.match(BUNDLE_LINE)?.[1]?.toLowerCase())
    .filter((name) => name && BUNDLE_NAME.test(name))

const STATUS_ORDER = { reached: 0, growing: 1, known: 2 }

/**
 * @param {{ records: { path: string, findings: ReturnType<typeof parseReviewRecord> }[], known: Map<string, string>, threshold: number }} args
 *   known은 이미 후보·규칙인 묶음 이름 → 그 파일 경로
 */
export const tallyBundles = ({ records, known, threshold }) => {
  const bundles = new Map()
  const malformed = []
  let counted = 0
  let excluded = 0
  for (const { path, findings } of records) {
    for (const finding of findings) {
      if (finding.problem) {
        malformed.push({ path, finding: finding.index, problem: finding.problem })
        continue
      }
      if (!finding.bundle) continue
      if (EXCLUDED.has(finding.verdict)) {
        excluded += 1
        continue
      }
      counted += 1
      const bundle = bundles.get(finding.bundle) ?? new Map()
      bundle.set(path, [...(bundle.get(path) ?? []), finding.index])
      bundles.set(finding.bundle, bundle)
    }
  }
  const list = [...bundles].map(([name, byPath]) => {
    const where = known.get(name) ?? null
    const status = where ? 'known' : byPath.size >= threshold ? 'reached' : 'growing'
    return { name, reviews: byPath.size, status, where, sources: [...byPath].map(([path, indexes]) => ({ path, findings: indexes })) }
  })
  list.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.reviews - a.reviews || a.name.localeCompare(b.name))
  return { bundles: list, malformed, findings: { counted, excluded } }
}
