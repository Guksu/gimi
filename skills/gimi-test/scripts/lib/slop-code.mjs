/**
 * 코드 슬롭 규칙(설계 7절 code/) 가운데 검사로 잡는 것 — 빈 catch, 타입 끄기, 주석 처리한 코드, 디버그 흔적, index key.
 * 지적은 { id, line, message, span?, severity? }다. 테스트 파일에는 주석 처리한 코드·디버그 흔적만 본다(as any 등은 가짜 객체에 흔하다).
 */
import { maskedMatches, maskedOf, splitArgs } from './syntax.mjs'

// 코드가 아니라 도구에게 주는 주석
const DIRECTIVE = /^(?:eslint|prettier|@ts-|istanbul|c8|v8\b|biome|jscpd|#?region\b|#?endregion\b|gimi-ignore|global\b|jshint|webpack|@vite-ignore|\/\s*<reference|TODO|FIXME|XXX|HACK|NOTE)/i
const CODE_LIKE = [
  /^(?:const|let|var)\s+[\w${[].*=/,
  /^(?:import|export)\b.*(?:\bfrom\b|[{};=]|\bdefault\b)/,
  /^(?:return|throw|await|yield)\b.*[;)\]}'"`\d]$/,
  /^(?:if|for|while|switch|catch)\s*\(.*\)\s*\{?$/,
  /^(?:\}\s*)?else\b.*\{$/,
  /^(?:async\s+)?function\b.*\)\s*\{?$/,
  /^class\s+[\w$]+.*\{$/,
  /^[\w$]+(?:\??\.[\w$]+)*\s*\(.*\)\s*;?$/,
  /^\.[\w$]+\s*\(.*\)?\s*;?$/,
  /^[\w$]+(?:\.[\w$]+|\[[^\]]+\])*\s*[+\-*/]?=\s*[^=].*$/,
  /^[}\])]+\s*[;,)]*$/,
  /^<\/?[A-Za-z][\w.]*(?:\s[^>]*)?\/?>/,
]
// 문자열 밖에 한글·줄표가 있으면 설명이다 — "CI=true — 한 번만 돈다"
const PROSE = /[—–]|[\u3131-\u318e\uac00-\ud7a3]/
const isCodeLike = (text) => !DIRECTIVE.test(text) && !PROSE.test(text.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '')) && CODE_LIKE.some((re) => re.test(text))
const ISSUE = /#\d+|\b[A-Z][A-Z0-9]+-\d+\b|https?:\/\//
// 주소 모양일 때만 — 문장 속 "localhost"라는 단어는 넘긴다
const LOCALHOST = /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?$|\b(?:https?|wss?):\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)\b|\blocalhost:\d+/
const CONFIG_FILE = /\.config\.(?:m|c)?[jt]s$/
// 비어 있는 처리기만 — .catch(() => null)처럼 대체값을 돌려주는 것은 실패를 값으로 바꾸는 처리다
const EMPTY_HANDLER = /^(?:async\s*)?(?:\(\s*[\w$]*\s*(?::\s*[\w$]+)?\s*\)|[\w$]+)\s*=>\s*\{\s*\}$|^(?:async\s+)?function\s*[\w$]*\s*\([^)]*\)\s*\{\s*\}$|^(?:_\.)?noop$/
const TYPE_MESSAGE = '타입을 좁히고, 피할 수 없으면 이유를 단 @ts-expect-error를 쓴다'

/** 주석 안의 위치가 몇째 줄인지 */
const lineInComment = (source, comment, offset) => comment.line + (comment.text.slice(0, offset).match(/\n/g) ?? []).length

/**
 * @param {{ source: ReturnType<typeof import('./source.mjs').readSource>, path: string, kind: 'test' | 'code', front: boolean }} args
 */
export const codeRules = ({ source, path, kind, front }) => {
  const out = []
  const add = (id, line, message, extra = {}) => out.push({ id, line, message, ...extra })
  const { masked } = source
  const hasComment = (start, end) => source.comments.some((c) => c.start > start && c.start < end)

  // 주석 처리한 코드 — 이어진 줄 주석을 묶고, 코드처럼 보이는 줄이 절반 이상일 때만(설명 속 예시 한 줄은 넘긴다)
  const own = source.comments.filter((c) => c.kind === 'line' && c.ownLine)
  for (let i = 0; i < own.length; ) {
    let j = i
    while (j + 1 < own.length && own[j + 1].line === own[j].line + 1) j += 1
    const group = own.slice(i, j + 1)
    const entries = group.map((c) => c.text.trim()).filter((text) => text !== '')
    const code = group.filter((c) => isCodeLike(c.text.trim()))
    if (code.length > 0 && code.length * 2 >= entries.length) {
      add('code/commented-out', code[0].line, `주석 처리한 코드다(${group.length}줄) — 지운다. 이력은 git에 있다`, { span: [group[0].line, group.at(-1).line] })
    }
    i = j + 1
  }

  // 디버그 흔적
  for (const m of maskedMatches(source, /(?<![\w$.])debugger\b/g)) add('code/debug-leftover', source.lineOf(m.index), 'debugger가 남았다 — 지운다', { severity: 'error' })
  // #!로 시작하는 실행 스크립트는 console.log가 출력이다
  if (!source.text.startsWith('#!')) {
    for (const m of maskedMatches(source, /(?<![\w$.])console\s*\.\s*(?:log|debug|trace|dir|table)\s*\(/g)) {
      add('code/debug-leftover', source.lineOf(m.index), 'console.log가 남았다 — 지운다. 남길 로그라면 프로젝트의 로거를 쓴다')
    }
  }
  for (const comment of source.comments) {
    const todo = comment.text.match(/\b(?:TODO|FIXME|XXX|HACK)\b/)
    if (todo && !ISSUE.test(comment.text)) add('code/debug-leftover', lineInComment(source, comment, todo.index), `${todo[0]}에 이슈 번호가 없다 — 이슈 번호를 달거나 지금 처리한다`)
  }
  if (kind === 'test') return out

  // 테스트 파일(MSW 핸들러 등)과 설정 파일(개발 서버)의 localhost는 제자리다
  if (!CONFIG_FILE.test(path)) {
    for (const s of source.strings) if (LOCALHOST.test(s.value)) add('code/debug-leftover', s.line, 'localhost 주소가 코드에 있다 — 배포하면 닿지 않는다. 설정·환경 변수로 뺀다')
  }

  // 빈 catch — 안에 이유 주석이 있으면 일부러 무시한 것이다
  for (const m of maskedMatches(source, /(?<![\w$.])catch\s*(?:\([^)]*\))?\s*\{/g)) {
    const open = m.index + m[0].length - 1
    const close = source.close(open)
    if (close === -1 || masked.slice(open + 1, close).trim() !== '' || hasComment(open, close)) continue
    add('code/empty-catch', source.lineOf(m.index), '빈 catch가 오류를 삼킨다 — 실패해도 아무도 모른다. 다시 던지거나 사용자에게 알리고, 정말 무시할 오류면 이유를 주석으로 단다')
  }
  for (const m of maskedMatches(source, /\.\s*catch\s*\(/g)) {
    const open = m.index + m[0].length - 1
    const args = splitArgs(source, open)
    if (args.length !== 1 || !EMPTY_HANDLER.test(maskedOf(source, args[0]).trim()) || hasComment(open, source.close(open))) continue
    add('code/empty-catch', source.lineOf(m.index), '빈 .catch가 오류를 삼킨다 — 실패해도 아무도 모른다. 오류를 알리거나 처리한다')
  }

  // 타입 끄기
  for (const m of maskedMatches(source, /(?<![\w$.])as\s+any\b/g)) add('code/type-escape', source.lineOf(m.index), `as any로 타입 검사를 끈다 — ${TYPE_MESSAGE}`)
  for (const m of maskedMatches(source, /(?<![\w$.])as\s+unknown\s+as\b/g)) add('code/type-escape', source.lineOf(m.index), `as unknown as로 타입을 억지로 바꾼다 — ${TYPE_MESSAGE}`)
  for (const comment of source.comments) {
    const directive = comment.text.match(/@ts-(ignore|nocheck|expect-error)\b(.*)/)
    if (!directive) continue
    const line = lineInComment(source, comment, directive.index)
    if (directive[1] === 'ignore') add('code/type-escape', line, `@ts-ignore로 타입 오류를 숨긴다 — ${TYPE_MESSAGE}`)
    else if (directive[1] === 'nocheck') add('code/type-escape', line, `@ts-nocheck로 파일 전체의 타입 검사를 끈다 — ${TYPE_MESSAGE}`)
    else if (!/[\p{L}\p{N}]/u.test(directive[2])) add('code/type-escape', line, '이유 없는 @ts-expect-error다 — 왜 피할 수 없는지 같은 줄에 적는다')
  }

  // index key — map 콜백의 둘째 인자를 key로 쓴다
  if (front && /\.[jt]sx$/.test(path)) {
    const indexNames = new Set(['index', 'idx', 'i'])
    for (const m of maskedMatches(source, /\.\s*map\s*\(\s*(?:async\s*)?(?:function\s*[\w$]*\s*)?\(/g)) {
      const second = splitArgs(source, m.index + m[0].length - 1)[1]
      const name = second && maskedOf(source, second).trim().match(/^[\w$]+/)?.[0]
      if (name) indexNames.add(name)
    }
    for (const m of maskedMatches(source, /(?<![\w$.-])key\s*=\s*\{/g)) {
      const open = m.index + m[0].length - 1
      const close = source.close(open)
      if (close === -1) continue
      const inner = masked.slice(open + 1, close).replace(/\$\{/g, ' ').replace(/\bString\s*\(|\.toString\s*\(\s*\)/g, ' ')
      const tokens = inner.match(/[\w$.]+/g) ?? []
      if (tokens.length > 0 && tokens.every((token) => indexNames.has(token))) add('code/index-key', source.lineOf(m.index), '목록의 key가 index다 — 항목을 더하거나 지우면 다른 항목의 상태가 섞인다. 항목의 고유 값을 key로 쓴다')
    }
  }
  return out
}
