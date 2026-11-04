/**
 * 반복 지적을 규칙 후보로(설계 결정 3·62) — 리뷰 기록(docs/gimi/reviews/*.md)에서 규칙에 걸리지 않은 지적을 묶음 이름으로 센다.
 * 같은 리뷰의 같은 묶음은 한 번으로 센다 — 같은 PR·브랜치를 다른 날 다시 리뷰한 기록도 한 리뷰다(서로 다른 리뷰에서 되풀이될 때만 후보). 판정이 틀림·의도함인 지적은 세지 않는다.
 * 이미 후보(candidates.md)나 회사 규칙(rules.md)에 "- 묶음:"으로 남은 묶음은 다시 올리지 않는다. 후보 초안은 에이전트가 쓰고 사람이 승인한다.
 */

const FINDING = /^## (\d+)\. \[(고쳐야 함|고치면 좋음|확인 질문)\]/
// 단계 표시가 든 머리처럼 보이는 줄 — 꼴이 다르면 조용히 빼지 않고 형식 어김으로 남긴다
const LEVEL_TAG = /\[(고쳐야 함|고치면 좋음|확인 질문)\]/
const HEAD_LIKE = /^(?:#{1,6}\s|\*\*|\d+[.)]\s)/
const HEADING = /^#{1,6}\s/
const FENCE = /^\s*(?:```|~~~)/
// "- 규칙: …"·"- **규칙**: …" — 굵은 글은 떼고 읽는다
const ITEM = (name) => new RegExp(`^[-*]\\s+\\**${name}\\**\\s*:\\s*(.*)$`)
const RULE = ITEM('규칙')
const VERDICT = ITEM('판정')
const BUNDLE_LINE = /^- 묶음:\s*`?([^`\s]+)`?\s*$/
const NO_RULE = /^없음\s*(?:—|–|-)\s*묶음\s+(\S+)\s*$/
// 묶음 이름 — 영어 소문자·숫자·하이픈(대문자는 소문자로 읽는다)
const BUNDLE_NAME = /^[a-z0-9][a-z0-9-]*$/
const VERDICTS = ['미정', '맞음', '틀림', '의도함']
const EXCLUDED = new Set(['틀림', '의도함'])
const DATE_HEAD = /^\d{4}-\d{2}-\d{2}-/

const lines = (text) => String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
// 굵은 글·백틱 표시를 뗀 값
const plain = (value) => value.replace(/\*\*|__|`/g, '').trim()

const readRule = (raw) => {
  const value = plain(raw)
  if (!value) return { rule: null, bundle: null, problem: '규칙 줄 없음' }
  // "없음"이나 "묶음"이 든 값은 묶음으로만 읽는다 — "해당 없음" 같은 글을 규칙 ID로 읽어 조용히 빼지 않게
  if (!/없음|묶음/.test(value)) return { rule: value, bundle: null, problem: null }
  const name = value.match(NO_RULE)?.[1]?.toLowerCase()
  return name && BUNDLE_NAME.test(name) ? { rule: null, bundle: name, problem: null } : { rule: null, bundle: null, problem: '묶음 이름이 없거나 형식이 틀림' }
}

const readVerdict = (raw) => {
  const value = plain(raw)
  const verdict = VERDICTS.find((word) => value === word || value.startsWith(`${word} `) || value.startsWith(`${word}—`) || value.startsWith(`${word}(`))
  return verdict ? { verdict, problem: null } : { verdict: '미정', problem: `판정을 모름(${VERDICTS.join('·')})` }
}

/**
 * 리뷰 기록의 지적("## N. [단계] 맥락 — 제목" 절)마다 규칙·묶음·판정을 읽는다. 코드 블록 안의 줄은 읽지 않는다.
 * 단계 표시가 있는데 꼴이 다른 머리는 index 없이 형식 어김으로 남긴다. 어느 머리든 앞 지적을 끝낸다
 * @param {string} text
 * @returns {{ index: number | null, line: number, level: string, rule: string | null, bundle: string | null, verdict: string, problem: string | null }[]}
 */
export const parseReviewRecord = (text) => {
  const findings = []
  let current = null
  let fenced = false
  lines(text).forEach((line, at) => {
    if (FENCE.test(line)) {
      fenced = !fenced
      return
    }
    if (fenced) return
    const heading = line.match(FINDING)
    const tag = line.match(LEVEL_TAG)
    if (heading || (tag && HEAD_LIKE.test(line)) || HEADING.test(line)) {
      current = null
      if (heading) {
        current = { index: Number(heading[1]), line: at + 1, level: heading[2], rule: null, bundle: null, verdict: '미정', problem: '규칙 줄 없음', ruleSeen: false, verdictSeen: false }
        findings.push(current)
      } else if (tag && HEAD_LIKE.test(line)) {
        findings.push({ index: null, line: at + 1, level: tag[1], rule: null, bundle: null, verdict: '미정', problem: '지적 머리 형식 어김' })
      }
      return
    }
    if (!current) return
    const rule = line.match(RULE)
    if (rule && !current.ruleSeen) Object.assign(current, readRule(rule[1]), { ruleSeen: true })
    const verdict = line.match(VERDICT)
    if (verdict && !current.verdictSeen) {
      const read = readVerdict(verdict[1])
      current.verdict = read.verdict
      current.verdictSeen = true
      if (read.problem && !current.problem) current.problem = read.problem
    }
  })
  return findings.map(({ ruleSeen, verdictSeen, ...finding }) => finding)
}

/** 같은 PR·브랜치를 다른 날 다시 리뷰한 기록은 한 리뷰다 — 파일 이름에서 날짜 머리와 .md를 뗀 이름 */
export const reviewKey = (path) =>
  String(path)
    .split('/')
    .at(-1)
    .replace(/\.md$/, '')
    .replace(DATE_HEAD, '')

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
        malformed.push({ path, finding: finding.index, line: finding.line, problem: finding.problem })
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
    // 같은 PR·브랜치의 기록은 한 리뷰로 센다(reviewKey)
    const reviews = new Set([...byPath.keys()].map(reviewKey)).size
    const status = where ? 'known' : reviews >= threshold ? 'reached' : 'growing'
    return { name, reviews, status, where, sources: [...byPath].map(([path, indexes]) => ({ path, findings: indexes })) }
  })
  list.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.reviews - a.reviews || a.name.localeCompare(b.name))
  return { bundles: list, malformed, findings: { counted, excluded } }
}
