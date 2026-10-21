/**
 * 슬롭 규칙이 함께 쓰는 코드 읽기 — 테스트 호출(it·test·describe·훅), 인자, 단언(expect·assert), import, 같은 파일의 함수.
 * 모두 readSource()의 가린 사본(masked) 위에서 찾고, 값이 필요할 때만 원본을 읽는다.
 */

/** 단언 — expect·assert·should·verify로 시작하는 호출(도우미 포함), supertest의 .expect, t.assert(node:test·ava) */
export const ASSERT =
  /(?<![\w$])(?:expect|assert|should|verify)\w*\s*[(.<`]|\.should\b|(?<![\w$])check[A-Z]\w*\s*\(|(?<![\w$.])t\s*\.\s*(?:assert|is|not|deepEqual|notDeepEqual|like|true|false|truthy|falsy|throws|throwsAsync|notThrows|notThrowsAsync|regex|notRegex|snapshot|pass|fail|plan)\b/
/** 단언 + 없으면 던지는 Testing Library 조회(getBy·findBy) — "단언이 없다"고 할 때만 조회도 단언으로 친다 */
export const ASSERT_OR_QUERY = new RegExp(`${ASSERT.source}|(?<![\\w$])(?:getBy|getAllBy|findBy|findAllBy)\\w*\\s*\\(`)

const TEST_MODIFIERS = new Set(['only', 'skip', 'todo', 'fixme', 'concurrent', 'sequential', 'each', 'fails', 'failing', 'runIf', 'skipIf', 'serial', 'parallel', 'slow'])
const DESCRIBES = new Set(['describe', 'fdescribe', 'xdescribe', 'suite', 'context'])
const HOOKS = new Set(['beforeEach', 'beforeAll', 'afterEach', 'afterAll'])
const CALL = /(?<![\w$.])(it|test|specify|fit|xit|xtest|describe|fdescribe|xdescribe|suite|context|beforeEach|beforeAll|afterEach|afterAll)((?:\s*\.\s*\w+)*)\s*[(`]/g

export const norm = (value) => value.replace(/\s+/g, ' ').replace(/,\s*([)\]}])/g, '$1').trim()
export const textOf = (source, range) => source.text.slice(range.start, range.end).trim()
export const maskedOf = (source, range) => source.masked.slice(range.start, range.end)
export const skipSpace = (value, from) => {
  let k = from
  while (k < value.length && /\s/.test(value[k])) k += 1
  return k
}

/** 가린 사본에서 찾는다 — 주석·문자열 안은 걸리지 않는다 */
export const maskedMatches = (source, re) => [...source.masked.matchAll(re)]

/** 원본에서 찾되 시작이 주석·문자열 안이면 버린다 — 문자열 인자까지 함께 봐야 할 때(vi.spyOn(console, 'error')) 쓴다 */
export const codeMatches = (source, re) => [...source.text.matchAll(re)].filter((m) => source.masked[m.index] === source.text[m.index])

/** 괄호 안의 인자 — 깊이 0의 쉼표로 나눈다. 위치는 [start, end) */
export const splitArgs = (source, open) => {
  const close = source.close(open)
  if (close === -1) return []
  const args = []
  let start = open + 1
  for (let k = open + 1; k < close; k += 1) {
    const ch = source.masked[k]
    if (ch === '(' || ch === '[' || ch === '{') {
      const end = source.close(k)
      if (end !== -1) k = end
    } else if (ch === ',') {
      args.push({ start, end: k })
      start = k + 1
    }
  }
  if (source.masked.slice(start, close).trim() !== '') args.push({ start, end: close })
  return args
}

/** 범위 안의 첫 문자열 리터럴 값 */
export const stringIn = (source, range) => source.strings.find((s) => s.start >= range.start && s.start < range.end)?.value ?? null

/**
 * 문장 끝 — 괄호를 건너뛰며 ; 또는 이어지지 않는 줄 바꿈, 바깥 괄호의 닫힘에서 멈춘다. 돌려주는 위치는 끝 글자다
 * @returns {number}
 */
export const statementEnd = (source, from) => {
  const m = source.masked
  let sawCode = false
  for (let k = from; k < m.length; k += 1) {
    const ch = m[k]
    if (ch === '(' || ch === '[' || ch === '{') {
      const end = source.close(k)
      if (end === -1) return m.length - 1
      k = end
      sawCode = true
    } else if (ch === ';' || ch === ')' || ch === ']' || ch === '}' || ch === ',') return k
    else if (ch === '\n' && sawCode) {
      const prev = m.slice(from, k).trimEnd().at(-1) ?? ''
      const next = m.slice(k + 1).match(/^\s*(\S)/)?.[1] ?? ''
      if (!/[=>,([{&|+\-*/?:.!<%^~]/.test(prev) && !/[.?:&|+\-*/=%^,)\]}]/.test(next)) return k
    } else if (!/\s/.test(ch)) sawCode = true
  }
  return m.length - 1
}

/**
 * 테스트 프레임워크 호출 — it·test·describe·훅. Playwright의 test.describe·test.beforeEach, it.each 표 다음의 호출도 따라간다.
 * @returns {{ base: string, kind: 'test' | 'describe' | 'hook' | 'configure', hook: string | null, only: boolean, skip: boolean, todo: boolean,
 *   index: number, line: number, endLine: number, argsOpen: number, argsClose: number, hasFn: boolean, hasString: boolean }[]}
 */
export const testCalls = (source) => {
  const out = []
  for (const m of maskedMatches(source, CALL)) {
    const base = m[1]
    const mods = m[2] ? m[2].split('.').map((part) => part.trim()).filter(Boolean) : []
    let kind = HOOKS.has(base) ? 'hook' : DESCRIBES.has(base) ? 'describe' : 'test'
    let hook = HOOKS.has(base) ? base : null
    const rest = []
    for (const mod of mods) {
      if (DESCRIBES.has(mod)) kind = 'describe'
      else if (HOOKS.has(mod)) {
        kind = 'hook'
        hook = mod
      } else if (mod === 'configure') kind = 'configure'
      else rest.push(mod)
    }
    if (kind !== 'configure' && rest.some((mod) => !TEST_MODIFIERS.has(mod))) continue

    let at = m.index + m[0].length - 1
    if (rest.includes('each')) {
      const tableEnd = source.masked[at] === '(' ? source.close(at) : (source.strings.find((s) => s.start === at)?.end ?? 0) - 1
      if (tableEnd < 0) continue
      at = skipSpace(source.masked, tableEnd + 1)
    }
    if (source.masked[at] !== '(') continue
    const argsClose = source.close(at)
    if (argsClose === -1) continue
    const args = source.masked.slice(at, argsClose)
    out.push({
      base,
      kind,
      hook,
      only: base === 'fit' || base === 'fdescribe' || rest.includes('only'),
      skip: base === 'xit' || base === 'xtest' || base === 'xdescribe' || rest.some((mod) => mod === 'skip' || mod === 'todo' || mod === 'fixme'),
      todo: rest.includes('todo'),
      index: m.index,
      line: source.lineOf(m.index),
      endLine: source.lineOf(argsClose),
      argsOpen: at,
      argsClose,
      hasFn: /=>|\bfunction\b/.test(args),
      hasString: source.strings.some((s) => s.start > at && s.start < argsClose),
    })
  }
  return out
}

/**
 * expect(대상)[.not|.resolves|.rejects].matcher(기대값)
 * @returns {{ index: number, line: number, subject: { start: number, end: number }, chain: string, matcher: string | null, args: { start: number, end: number }[], end: number }[]}
 */
export const expectations = (source) => {
  const out = []
  for (const m of maskedMatches(source, /(?<![\w$.])expect\s*\(/g)) {
    const open = m.index + m[0].length - 1
    const close = source.close(open)
    if (close === -1) continue
    const tail = source.masked.slice(close + 1).match(/^\s*((?:\.\s*(?:not|resolves|rejects)\s*)*)\.\s*(\w+)\s*\(/)
    const matcherOpen = tail ? close + tail[0].length : -1
    out.push({
      index: m.index,
      line: source.lineOf(m.index),
      subject: { start: open + 1, end: close },
      chain: tail ? tail[1].replace(/\s+/g, '') : '',
      matcher: tail ? tail[2] : null,
      args: tail ? splitArgs(source, matcherOpen) : [],
      end: tail ? source.close(matcherOpen) : close,
    })
  }
  return out
}

/** assert(x)·assert.equal(a, b) — method가 없으면 'ok' */
export const asserts = (source) =>
  maskedMatches(source, /(?<![\w$.])assert(?:\s*\.\s*(\w+))?\s*\(/g).map((m) => ({
    index: m.index,
    line: source.lineOf(m.index),
    method: m[1] ?? 'ok',
    args: splitArgs(source, m.index + m[0].length - 1),
  }))

/** import 문의 이름과 경로 — import { a, b as c } from './x' → [{ name: 'a', spec: './x' }, { name: 'c', spec: './x' }] */
export const imports = (source) => {
  const out = []
  for (const m of maskedMatches(source, /(?<![\w$.])import\s+(?:type\s+)?([\w$*{}\s,]+?)\s*from\s*(?=['"])/g)) {
    const spec = source.strings.find((s) => s.start === m.index + m[0].length)?.value
    if (spec === undefined) continue
    const clause = m[1]
    const names = []
    const braces = clause.match(/\{([^}]*)\}/)
    if (braces) {
      for (const part of braces[1].split(',')) {
        const words = part.trim().split(/\s+/).filter(Boolean)
        if (words.length === 0 || words[0] === 'type') continue
        names.push(words.at(-1))
      }
    }
    const namespace = clause.match(/\*\s*as\s+([\w$]+)/)
    if (namespace) names.push(namespace[1])
    const leading = clause.replace(/\{[^}]*\}/, '').replace(/\*\s*as\s+[\w$]+/, '').match(/^\s*([\w$]+)/)
    if (leading && leading[1] !== 'type') names.push(leading[1])
    for (const name of names) out.push({ name, spec })
  }
  return out
}

/** 같은 파일에서 정의한 함수 — function 이름() {}와 const 이름 = () => … */
export const localFunctions = (source) => {
  const out = new Map()
  for (const m of maskedMatches(source, /(?<![\w$.])(?:async\s+)?function\s*\*?\s*([\w$]+)\s*\(/g)) {
    const paramsClose = source.close(m.index + m[0].length - 1)
    if (paramsClose === -1) continue
    const brace = source.masked.indexOf('{', paramsClose)
    const end = brace === -1 ? -1 : source.close(brace)
    if (end !== -1) out.set(m[1], { start: m.index, end })
  }
  for (const m of maskedMatches(source, /(?<![\w$.])(?:const|let|var)\s+([\w$]+)\s*(?::[^=;\n]+)?=(?![=>])/g)) {
    const start = m.index + m[0].length
    const end = statementEnd(source, start)
    if (/=>|\bfunction\b/.test(source.masked.slice(start, end))) out.set(m[1], { start, end })
  }
  return out
}

/** 범위 안에서 부르거나(이름() ) 멤버를 읽는(이름.) 식별자 */
export const calledNames = (source, start, end) => new Set([...source.masked.slice(start, end).matchAll(/(?<![\w$.])([\w$]+)\s*[(.]/g)].map((m) => m[1]))
