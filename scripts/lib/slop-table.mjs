/**
 * 슬롭 금지선 측정을 규칙 파일과 SKILL.md에 옮긴다(설계 결정 34).
 * 측정 결과(줄마다 gimi 없이·있이 몇 번의 실행에 나왔나)로 규칙 파일의 `근거`를 "N번 중 M번"으로 바꾸고,
 * 그 `근거`로 SKILL.md의 금지선 표(gimi 없이 한 번 이상 나온 줄)를 만든다. 표의 정본은 규칙 파일이다.
 */
import { parseRuleFile } from '../../skills/gimi-review/scripts/lib/rulefile.mjs'

export const SLOP_TABLE_START = '<!-- slop-table:start -->'
export const SLOP_TABLE_END = '<!-- slop-table:end -->'
const EVIDENCE = /^측정 (\d{4}-\d{2}-\d{2}) — gimi 없이 (\d+)번 중 (\d+)번 · gimi 있이 (\d+)번 중 (\d+)번$/

/** 근거 값 — "측정 {날짜} — gimi 없이 N번 중 M번 · gimi 있이 N번 중 K번" */
export const evidenceText = ({ date, without, with: withGimi, runs }) => `측정 ${date} — gimi 없이 ${runs.without}번 중 ${without}번 · gimi 있이 ${runs.with}번 중 ${withGimi}번`

/** 근거 값을 다시 읽는다 — 측정 전이면 null */
export const parseEvidence = (text) => {
  const match = text.trim().match(EVIDENCE)
  return match ? { date: match[1], without: Number(match[3]), with: Number(match[5]), runs: { without: Number(match[2]), with: Number(match[4]) } } : null
}

/**
 * 규칙 파일의 `- 근거:` 줄만 바꾼다 — 결과에 없는 줄은 0번이다(측정했지만 나오지 않았다).
 * 셀 수 없던 줄(unmeasured)은 "셀 수 없었다: 이유"로 적는다 — 0번과 구분한다
 * @param {{ text: string, results: { date: string, runs: { without: number, with: number }, rules: { id: string, without: number, with: number }[], unmeasured?: { id: string, reason: string }[] } }} args
 */
export const applyEvidence = ({ text, results }) => {
  const counts = new Map(results.rules.map((rule) => [rule.id, rule]))
  const unmeasured = new Map((results.unmeasured ?? []).map((entry) => [entry.id, entry.reason]))
  const lines = text.split('\n')
  for (const rule of parseRuleFile(text).rules) {
    const item = rule.items.get('근거')
    if (!item) continue
    if (unmeasured.has(rule.id)) {
      lines[item.line - 1] = `- 근거: 측정 ${results.date} — 셀 수 없었다: ${unmeasured.get(rule.id)}`
      continue
    }
    const count = counts.get(rule.id) ?? { without: 0, with: 0 }
    lines[item.line - 1] = `- 근거: ${evidenceText({ date: results.date, without: count.without, with: count.with, runs: results.runs })}`
  }
  return lines.join('\n')
}

/**
 * SKILL.md의 금지선 표 — gimi 없이 한 번 이상 나온 줄만, 많이 나온 순(같으면 ID 순)
 * @param {{ files: { area: string, text: string }[] }} args 표에 넣을 영역의 규칙 파일
 */
export const renderSlopTable = ({ files }) => {
  const rows = files
    .flatMap(({ text }) => parseRuleFile(text).rules)
    .map((rule) => ({ rule, evidence: parseEvidence(rule.items.get('근거')?.value ?? '') }))
    .filter(({ evidence }) => evidence && evidence.without > 0)
    .sort((a, b) => b.evidence.without - a.evidence.without || a.rule.id.localeCompare(b.rule.id))
  if (rows.length === 0) return [SLOP_TABLE_START, '금지선은 아직 측정 전이라 모두 가설이다.', SLOP_TABLE_END].join('\n')
  return [
    SLOP_TABLE_START,
    '| 줄 | gimi 없이 | gimi 있이 |',
    '|---|---|---|',
    ...rows.map(({ rule, evidence }) => `| \`${rule.id}\` ${rule.title} | ${evidence.runs.without}번 중 ${evidence.without}번 | ${evidence.runs.with}번 중 ${evidence.with}번 |`),
    SLOP_TABLE_END,
  ].join('\n')
}

/** 문서의 표 블록을 바꾼다 — 표시가 없으면 null */
export const replaceSlopBlock = ({ document, block }) => {
  const start = document.indexOf(SLOP_TABLE_START)
  const end = document.indexOf(SLOP_TABLE_END)
  if (start === -1 || end === -1 || end < start) return null
  return document.slice(0, start) + block + document.slice(end + SLOP_TABLE_END.length)
}
