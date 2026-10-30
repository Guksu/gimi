/**
 * 규칙 파일 읽기(설계 결정 26·35·40·43) — 공통 금지선(shared/rules/*.md), 분야 프리셋(shared/domains/{이름}/rules.md),
 * 회사 규칙(docs/gimi/rules.md)은 같은 형식이다. 규칙 하나가 "## {ID} {한 줄}" 절 하나이고, 절 안에 "- 이름: 값" 항목을 둔다.
 * 들여쓴 "  - …" 줄은 바로 앞 항목의 목록(경계값의 프론트·백엔드, 근거 목록)이고, 들여쓴 글은 앞 값에 이어 붙는다.
 * ID가 아닌 "##" 제목은 묶음 제목이다. 회사 규칙의 "## 끈 프리셋 규칙" 절은 끈 프리셋 규칙의 ID와 이유다.
 */

export const RULE_ID = /^(?:[a-z]+\/[a-z0-9-]+|[A-Z][A-Z0-9]*-\d{3})$/
const ITEM = /^- ([^:\s][^:]*?):\s?(.*)$/
const SUB = /^\s{2,}- (.*)$/
const CONTINUATION = /^\s{2,}(\S.*)$/
const DISABLED = /^- ([A-Z][A-Z0-9]*-\d{3})\s*(?:(?:—|–|-|:)\s*(.*))?$/
export const DISABLED_TITLE = '끈 프리셋 규칙'

const REQUIRED = {
  slop: ['대상', '왜', '대신', '확인', '검사', '근거'],
  preset: ['대상', '왜', '대신', '확인', '경계값', '근거'],
  company: ['왜', '대신', '확인'],
}

/**
 * @param {string} text
 * @returns {{ rules: { id: string, title: string, line: number, items: Map<string, { value: string, list: string[], line: number }> }[], groups: { title: string, line: number }[], disabled: { id: string, reason: string, line: number }[] }}
 */
export const parseRuleFile = (text) => {
  const rules = []
  const groups = []
  const disabled = []
  let current = null
  let lastItem = null
  text.replace(/\r\n?/g, '\n').split('\n').forEach((raw, index) => {
    const line = index + 1
    if (raw.startsWith('## ')) {
      lastItem = null
      const title = raw.slice(3).trim()
      const m = title.match(/^(\S+)\s+(.+)$/)
      if (m && RULE_ID.test(m[1])) {
        current = { kind: 'rule', id: m[1], title: m[2].trim(), line, items: new Map() }
        rules.push(current)
      } else if (title === DISABLED_TITLE) current = { kind: 'disabled' }
      else {
        current = { kind: 'group' }
        groups.push({ title, line })
      }
      return
    }
    if (raw.startsWith('# ')) {
      current = null
      lastItem = null
      return
    }
    if (!current) return
    if (current.kind === 'disabled') {
      const d = raw.match(DISABLED)
      if (d) disabled.push({ id: d[1], reason: (d[2] ?? '').trim(), line })
      return
    }
    if (current.kind !== 'rule') return
    const item = raw.match(ITEM)
    if (item) {
      lastItem = { value: item[2].trim(), list: [], line }
      current.items.set(item[1].trim(), lastItem)
      return
    }
    if (!lastItem) return
    const sub = raw.match(SUB)
    if (sub) {
      lastItem.list.push(sub[1].trim())
      return
    }
    const more = raw.match(CONTINUATION)
    if (more) {
      if (lastItem.list.length > 0) lastItem.list[lastItem.list.length - 1] += ` ${more[1].trim()}`
      else lastItem.value = `${lastItem.value} ${more[1].trim()}`.trim()
    }
  })
  return { rules, groups, disabled }
}

/** 항목의 글 전체 — 값과 목록 */
export const itemText = (rule, name) => {
  const item = rule.items.get(name)
  return item ? [item.value, ...item.list].filter(Boolean).join(' ') : ''
}

/**
 * 대상(또는 경계값 줄의 머리)이 설정의 stacks에 맞는지 — "둘 다"는 늘, "프론트"는 frontend-ts, "백엔드"는 backend
 * @param {string} target @param {string[]} stacks
 */
export const matchesStacks = (target, stacks) => {
  const head = target.split(/[:(]/)[0].trim()
  if (head.startsWith('둘 다')) return true
  return (head.includes('프론트') && stacks.includes('frontend-ts')) || (head.includes('백엔드') && stacks.includes('backend'))
}

/**
 * 형식 검사 — 구조 검사(validate)가 쓴다
 * @param {{ path: string, text: string, kind: 'slop' | 'preset' | 'company', area?: string, prefix?: string }} args
 * @returns {string[]}
 */
export const checkRuleFile = ({ path, text, kind, area, prefix }) => {
  const errors = []
  const seen = new Map()
  const { rules } = parseRuleFile(text)
  if (kind !== 'company' && rules.length === 0) errors.push(`${path}: 규칙이 없다`)
  for (const rule of rules) {
    const at = `${path}:${rule.line} ${rule.id}`
    if (seen.has(rule.id)) errors.push(`${at} — ID가 겹친다(${seen.get(rule.id)}번째 줄)`)
    else seen.set(rule.id, rule.line)
    for (const name of REQUIRED[kind]) if (!itemText(rule, name)) errors.push(`${at} — 필수 항목 ${name}이(가) 없다`)
    if (kind === 'slop' && !rule.id.startsWith(`${area}/`)) errors.push(`${at} — ${area} 영역 파일에 다른 영역의 규칙이 있다`)
    if (kind === 'preset' && !rule.id.startsWith(`${prefix}-`)) errors.push(`${at} — 이 프리셋의 ID는 ${prefix}-로 시작한다`)
    const target = itemText(rule, '대상')
    if (target && !/^(?:프론트|백엔드|둘 다)/.test(target)) errors.push(`${at} — 대상은 프론트·백엔드·둘 다 중 하나로 시작한다`)
    if (kind === 'slop' && itemText(rule, '검사') && !/^(?:error|warn|리뷰|기록|출력)/.test(itemText(rule, '검사'))) errors.push(`${at} — 검사는 error·warn·리뷰·기록·출력 중 하나로 시작한다`)
    if (kind === 'preset') {
      const source = itemText(rule, '근거')
      if (/URL 확인 필요/.test(source)) errors.push(`${at} — 근거에 "URL 확인 필요"가 남았다 — 직접 열어 확인하고 고친다`)
      else if (source && !/https?:\/\/|출처 없음/.test(source)) errors.push(`${at} — 근거에 URL이나 "출처 없음"이 있어야 한다`)
    }
  }
  return errors
}
