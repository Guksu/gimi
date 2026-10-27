/**
 * 바뀐 문자열 — 지우거나 바꾼 줄에서 키처럼 생긴 문자열(쿼리 키·라우트 경로·i18n 키·저장소 키)을 뽑는다.
 * 타입으로 이어지지 않는 연결이라 TypeScript 참조 찾기로는 잡히지 않는다. 저장소에서 문자열로 찾는다(설계 결정 20).
 * 특수 문자가 없는 낱말('orders')은 어디에나 있어 소음이 크므로 뽑지 않는다.
 */

const LITERAL = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g
const KEY_CHAR = /[/:._-]/
const VERSION = /^v?\d+(\.\d+)+$/
const MODULE_LINE = /^\s*import\b|\bfrom\s+['"]|\brequire\(|\bimport\(/

/** 한 줄에서 키처럼 생긴 문자열 @param {string} line @returns {string[]} */
export const keyLiteralsOf = (line) => {
  // 모듈 경로는 import 관계라 TypeScript 참조 찾기가 맡는다
  if (MODULE_LINE.test(line)) return []
  const out = []
  for (const match of line.matchAll(LITERAL)) {
    const [, quote, value] = match
    if (quote === '`' && value.includes('${')) continue
    if (value.length < 4 || value.length > 100 || /\s/.test(value)) continue
    if (!KEY_CHAR.test(value) || VERSION.test(value)) continue
    out.push(value)
  }
  return out
}

/**
 * 지운 줄에만 있고 더한 줄에는 없는 문자열 — 바뀌거나 사라진 키. 그대로 남은 키는 쓰는 쪽이 깨지지 않는다
 * @param {{ hunks: { removed: { text: string }[], added: { text: string }[] }[] }} file
 */
export const changedLiterals = (file) => {
  const removed = new Set(file.hunks.flatMap((hunk) => hunk.removed).flatMap((row) => keyLiteralsOf(row.text)))
  const added = new Set(file.hunks.flatMap((hunk) => hunk.added).flatMap((row) => keyLiteralsOf(row.text)))
  return [...removed].filter((value) => !added.has(value))
}

// 객체·타입의 키 — 줄 머리나 { , 바로 뒤의 "이름:"(삼항 연산자의 ":"와 함수 인자는 앞 글자로 거른다)
const FIELD_KEY = /(?:^|[{,])\s*([A-Za-z_$][\w$]*)\??\s*:(?!:)/g
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/
const NOT_FIELDS = new Set(['default', 'case', 'return', 'break', 'continue', 'http', 'https'])
const wordIn = (name, text) => new RegExp(`(?<![\\w$])${name.replace(/\$/g, '\\$')}(?![\\w$])`).test(text)

/**
 * 지운 필드 — 지운 줄의 객체·타입 키 가운데 더한 줄에 없는 이름(응답 객체에서 뺀 필드 등).
 * export도 계약 파일도 바뀌지 않으면 TypeScript 참조로는 쓰는 쪽(다른 층의 화면·목)을 찾지 못한다. 이름으로 찾는다
 * @param {{ hunks: { removed: { text: string }[], added: { text: string }[] }[] }} file
 */
export const removedFieldsOf = (file) => {
  const added = file.hunks.flatMap((hunk) => hunk.added).map((row) => row.text).join('\n')
  const names = []
  for (const row of file.hunks.flatMap((hunk) => hunk.removed)) {
    if (COMMENT_LINE.test(row.text) || MODULE_LINE.test(row.text)) continue
    for (const match of row.text.matchAll(FIELD_KEY)) {
      const name = match[1]
      if (name.length < 4 || NOT_FIELDS.has(name) || names.includes(name) || wordIn(name, added)) continue
      names.push(name)
    }
  }
  return names
}
