/**
 * 소스 읽기 — 슬롭 검사가 정규식으로 코드를 찾을 수 있게, 주석·문자열·정규식 리터럴의 내용을 공백으로 가린 사본(masked)을 만든다.
 * 가린 사본은 원본과 길이·줄 바꿈이 같아 위치를 그대로 쓴다. 괄호 짝과 줄 번호도 함께 준다.
 * 의존성 없이, 리뷰하는 프로젝트의 TypeScript 버전과 상관없이 같게 동작하려고 파서 대신 가벼운 토큰 읽기를 쓴다.
 * 그래서 틀릴 수 있는 곳(JSX 글자 안의 따옴표 등)은 그 줄 안에서만 틀리게 한다.
 */

// 이 단어 뒤의 /는 나눗셈이 아니라 정규식의 시작이다
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'await', 'yield'])
const OPEN = { '(': ')', '[': ']', '{': '}' }
const CLOSE = { ')': '(', ']': '[', '}': '{' }

/**
 * @typedef {{ start: number, end: number, line: number, kind: 'line' | 'block', ownLine: boolean, text: string }} Comment
 * @typedef {{ start: number, end: number, line: number, value: string }} StringLiteral
 */

/** @param {string} text */
export const readSource = (text) => {
  const n = text.length
  const out = text.split('')
  /** @type {Comment[]} */
  const comments = []
  /** @type {StringLiteral[]} */
  const strings = []
  const lineStarts = [0]
  for (let i = 0; i < n; i += 1) if (text[i] === '\n') lineStarts.push(i + 1)

  const lineOf = (index) => {
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid] <= index) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }
  const mask = (from, to) => {
    for (let k = from; k < to; k += 1) if (out[k] !== '\n') out[k] = ' '
  }
  const ownLine = (index) => /^[ \t]*$/.test(text.slice(lineStarts[lineOf(index) - 1], index))

  /** 템플릿 글자 읽기 — 닫는 `에서 끝나거나 ${에서 멈춘다 */
  const readTemplate = (from) => {
    for (let k = from; k < n; k += 1) {
      if (text[k] === '\\') k += 1
      else if (text[k] === '`') {
        mask(from, k)
        return { end: k + 1, expr: false }
      } else if (text[k] === '$' && text[k + 1] === '{') {
        mask(from, k)
        return { end: k + 2, expr: true }
      }
    }
    mask(from, n)
    return { end: n, expr: false }
  }

  let last = { type: 'start', value: '' }
  // 템플릿의 ${} 안에서 연 중괄호 수 — 0에서 }를 만나면 템플릿 글자로 돌아간다
  const templateDepths = []
  let depth = 0
  let i = 0
  // 실행 스크립트의 첫 줄(#!/usr/bin/env node)은 코드가 아니다
  if (text.startsWith('#!')) {
    i = text.indexOf('\n') === -1 ? n : text.indexOf('\n')
    mask(0, i)
  }
  while (i < n) {
    const c = text[i]
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i += 1
    } else if (c === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i) === -1 ? n : text.indexOf('\n', i)
      comments.push({ start: i, end, line: lineOf(i), kind: 'line', ownLine: ownLine(i), text: text.slice(i + 2, end) })
      mask(i, end)
      i = end
    } else if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2)
      const end = close === -1 ? n : close + 2
      comments.push({ start: i, end, line: lineOf(i), kind: 'block', ownLine: ownLine(i), text: text.slice(i + 2, close === -1 ? n : close) })
      mask(i, end)
      i = end
    } else if (c === "'" || c === '"') {
      let k = i + 1
      while (k < n && text[k] !== c && text[k] !== '\n') k += text[k] === '\\' ? 2 : 1
      // 닫지 않은 따옴표(JSX 글자의 Don't 등)는 그 줄에서 끝낸다
      const closed = text[k] === c
      strings.push({ start: i, end: closed ? k + 1 : k, line: lineOf(i), value: text.slice(i + 1, k) })
      mask(i + 1, k)
      i = closed ? k + 1 : k
      last = { type: 'value', value: '' }
    } else if (c === '`') {
      const read = readTemplate(i + 1)
      if (read.expr) {
        templateDepths.push(depth)
        depth = 0
        last = { type: 'punct', value: '{' }
      } else {
        strings.push({ start: i, end: read.end, line: lineOf(i), value: text.slice(i + 1, read.end - 1) })
        last = { type: 'value', value: '' }
      }
      i = read.end
    } else if (c === '/' && regexAllowed(last) && text[i - 1] !== '<' && text[i + 1] !== '>') {
      let k = i + 1
      let inClass = false
      while (k < n && text[k] !== '\n') {
        if (text[k] === '\\') k += 1
        else if (text[k] === '[') inClass = true
        else if (text[k] === ']') inClass = false
        else if (text[k] === '/' && !inClass) break
        k += 1
      }
      if (text[k] === '/') {
        mask(i + 1, k)
        k += 1
        while (k < n && /[a-z]/.test(text[k])) k += 1
        i = k
        last = { type: 'value', value: '' }
      } else {
        i += 1
        last = { type: 'punct', value: '/' }
      }
    } else if (/[A-Za-z_$\u0080-￿]/.test(c)) {
      let k = i + 1
      while (k < n && /[\w$\u0080-￿]/.test(text[k])) k += 1
      last = { type: 'word', value: text.slice(i, k) }
      i = k
    } else if (/\d/.test(c)) {
      let k = i + 1
      while (k < n && /[\w.]/.test(text[k])) k += 1
      last = { type: 'value', value: '' }
      i = k
    } else {
      if (templateDepths.length > 0 && c === '{') depth += 1
      if (templateDepths.length > 0 && c === '}') {
        if (depth === 0) {
          depth = templateDepths.pop()
          const read = readTemplate(i + 1)
          if (read.expr) {
            templateDepths.push(depth)
            depth = 0
          } else last = { type: 'value', value: '' }
          i = read.end
          continue
        }
        depth -= 1
      }
      last = { type: 'punct', value: c }
      i += 1
    }
  }

  const masked = out.join('')
  // 괄호 짝 — 짝이 안 맞으면(JSX 글자의 ":)" 등) 안쪽의 열린 괄호를 버리고 바깥 짝을 살린다
  const pairs = new Int32Array(n).fill(-1)
  const stack = []
  for (let k = 0; k < n; k += 1) {
    const ch = masked[k]
    if (OPEN[ch]) stack.push(k)
    else if (CLOSE[ch]) {
      const at = stack.findLastIndex((open) => masked[open] === CLOSE[ch])
      if (at === -1) continue
      pairs[stack[at]] = k
      stack.length = at
    }
  }

  return {
    text,
    masked,
    comments,
    strings,
    lineCount: text.endsWith('\n') ? lineStarts.length - 1 : lineStarts.length,
    lineOf,
    /** @param {number} line 1부터 */
    lineText: (line) => {
      const start = lineStarts[line - 1]
      if (start === undefined) return ''
      const next = lineStarts[line]
      return text.slice(start, next === undefined ? n : next - 1)
    },
    /** 여는 괄호 위치 → 닫는 괄호 위치(없으면 -1) */
    close: (open) => pairs[open] ?? -1,
  }
}

const regexAllowed = (last) =>
  last.type === 'start' || (last.type === 'punct' && !')]}'.includes(last.value)) || (last.type === 'word' && REGEX_AFTER_WORD.has(last.value))
