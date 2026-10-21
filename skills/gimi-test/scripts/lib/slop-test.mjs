/**
 * 테스트 슬롭 규칙(설계 7절 test/·done/) — 테스트 파일에서 찾는다. 지적은 { id, line, message, span?, severity? }다.
 * error는 결함이 확실할 때만 낸다. 안을 볼 수 없는 것(다른 파일의 도우미)은 판단하지 않는다.
 */
import { posix } from 'node:path'
import { readSource } from './source.mjs'
import {
  ASSERT,
  ASSERT_OR_QUERY,
  asserts,
  calledNames,
  codeMatches,
  expectations,
  imports,
  localFunctions,
  maskedMatches,
  maskedOf,
  norm,
  skipSpace,
  splitArgs,
  statementEnd,
  stringIn,
  testCalls,
  textOf,
} from './syntax.mjs'

const ASSERT_MODULES = /^(?:node:)?assert(?:\/strict)?$|^chai$|^power-assert$|^uvu\/assert$|^expect$/
// 테스트 도우미가 사는 경로 — 이 모듈의 함수는 안에서 단언할 수 있다
const HELPER_MODULE = /(?:^|[/._-])(?:tests?|__tests__|e2e|testing|support|fixtures?|helpers?|test-?utils?|testUtils|spec-?helpers?)(?:[/._-]|$)/i
// 도우미 모듈에서 왔어도 단언하지 않는 이름 — 그리기·준비·가짜 만들기
const NON_ASSERTING = /^(?:render\w*|mount\w*|shallow|setup\w*|act|cleanup|within|screen|user|userEvent|fireEvent|waitFor\w*|create\w*|make\w*|build\w*|mock\w*|seed\w*|reset\w*|given\w*|server|wrapper|providers?)$/
const LITERAL = /^(?:true|false|null|undefined|NaN|-?\d[\d_]*(?:\.\d+)?|'[^'\\]*'|"[^"\\]*"|`[^`$\\]*`)$/
const TRIVIAL = /^(?:true|false|null|undefined|NaN|-?[01]|''|""|``|\[\]|\{\})$/
// 같은 식을 양쪽에 둔 단언 — 호출이 들어 있으면 결정성 확인(같은 입력 → 같은 값)이라 넘긴다
const EQUALITY = new Set(['toBe', 'toEqual', 'toStrictEqual'])
const ASSERT_EQUALITY = /^(?:equal|strictEqual|deepEqual|deepStrictEqual)$/
// render 결과는 늘 있다 — toBeDefined·toBeTruthy를 붙여도 아무것도 확인하지 않는다.
// getBy 결과의 toBeTruthy(React Native 관용구)는 조회가 이미 있는지 확인하므로 넘긴다
const RENDERED = /^render\(/
const WHOLE_SCREEN = /^(?:container|baseElement|document\.body|document\.documentElement|(?:\w+\.)?asFragment\(\)|\w*[Ww]rapper|tree|component|\w+\.container|render\([\s\S]*\)(?:\.\w+)*|[\s\S]*\.toJSON\(\)|[\s\S]*\.html\(\))$/
const SNAPSHOT_MATCHERS = new Set(['toMatchSnapshot', 'toMatchInlineSnapshot', 'toMatchFileSnapshot'])
const NETWORK_MODULES = new Set(['axios', 'node-fetch', 'cross-fetch', 'isomorphic-fetch', 'whatwg-fetch', 'ky', 'got', 'undici', 'superagent', 'redaxios', 'ofetch'])
const NETWORK_MESSAGE = 'fetch를 직접 바꾼다 — 요청 주소·본문이 틀려도 통과한다. MSW나 가짜 HTTP 서버로 네트워크 경계에서 바꾼다'
const RETRY_MESSAGE = '재시도 설정이 가끔 깨지는 테스트를 덮는다 — 깨지는 원인(시간·순서·공유 상태)을 찾는다'

const short = (value) => (value.length > 40 ? `${value.slice(0, 37)}…` : value)
const escape = (value) => value.replace(/[$]/g, '\\$')

/** 같은 줄이나 바로 윗줄의 설명 주석 */
const reasonComment = (source, line) =>
  source.comments.some((c) => {
    const endLine = source.lineOf(Math.max(c.start, c.end - 1))
    return (c.line === line || (c.ownLine && endLine === line - 1)) && /[\p{L}\p{N}]{2,}/u.test(c.text)
  })

/** 바뀌기 전·뒤 한 줄의 단언 — 같은 대상·matcher인데 기대값만 다른지 보려고 */
const lineExpectation = (text) => {
  const source = readSource(text)
  const found = expectations(source).find((e) => e.matcher && e.args.length > 0)
  if (found) return { key: `${norm(textOf(source, found.subject))}${found.chain}.${found.matcher}`, expected: norm(found.args.map((a) => textOf(source, a)).join(', ')) }
  const equal = asserts(source).find((a) => ASSERT_EQUALITY.test(a.method) && a.args.length >= 2)
  if (equal) return { key: `assert.${equal.method}(${norm(textOf(source, equal.args[0]))})`, expected: norm(textOf(source, equal.args[1])) }
  return null
}

/** 테스트 파일과 이름이 같은 모듈 — cart.test.ts → cart, __tests__/cart.test.ts → ../cart */
const subjectsOf = (path) => {
  const dir = posix.dirname(path)
  const name = posix.basename(path).replace(/(?:\.(?:test|spec))?\.(?:m|c)?[jt]sx?$/, '')
  const out = [posix.join(dir, name)]
  if (posix.basename(dir) === '__tests__') out.push(posix.join(posix.dirname(dir), name))
  return out.map(stripModule)
}
const stripModule = (path) => path.replace(/\.(?:m|c)?[jt]sx?$/, '').replace(/\/index$/, '')

/** mockReturnValue·mockResolvedValue(값)과 mockImplementation(() => 값)의 값 */
const mockValues = (source, start, end) => {
  const out = []
  for (const m of maskedMatches(source, /\.\s*(mockReturnValue|mockReturnValueOnce|mockResolvedValue|mockResolvedValueOnce|mockImplementation|mockImplementationOnce)\s*\(/g)) {
    if (m.index < start || m.index > end) continue
    const arg = splitArgs(source, m.index + m[0].length - 1)[0]
    if (!arg) continue
    let value = norm(textOf(source, arg))
    if (m[1].startsWith('mockImplementation')) {
      const body = value.match(/^(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>\s*([\s\S]+)$/)?.[1]
      if (!body || body.startsWith('{')) continue
      value = body.startsWith('(') && body.endsWith(')') ? body.slice(1, -1).trim() : body
      value = value.match(/^Promise\.resolve\(([\s\S]*)\)$/)?.[1].trim() ?? value
    }
    if (!TRIVIAL.test(value)) out.push(value)
  }
  return out
}

/**
 * @param {{ source: ReturnType<typeof readSource>, path: string, hunks: import('./diff.mjs').Hunk[], implementationChanged: boolean, front: boolean }} args
 */
export const testRules = ({ source, path, hunks, implementationChanged, front }) => {
  const out = []
  const add = (id, line, message, extra = {}) => out.push({ id, line, message, ...extra })
  const { masked } = source
  const calls = testCalls(source)
  const tests = calls.filter((c) => c.kind === 'test' && !c.skip && c.hasFn)
  const exps = expectations(source)
  const assertCalls = asserts(source)
  const imported = imports(source)
  const within = (index, call) => index > call.argsOpen && index < call.argsClose

  // only·skip
  for (const call of calls) {
    if (call.only) add('test/only-left', call.line, '.only가 남아 있다 — 이 파일의 다른 테스트가 돌지 않는다. 지운다')
    if (!call.skip) continue
    // Playwright의 test.skip(조건, 이유)는 함수 없이 이유 문자열을 받는다
    const reasoned = reasonComment(source, call.line) || (!call.hasFn && !call.todo && call.hasString)
    if (reasoned) add('done/test-bent', call.line, '이 변경에서 테스트를 건너뛰게 했다 — 건너뛴 테스트와 이유를 보고에 밝힌다')
    else add('test/skip-without-reason', call.line, '이유 없이 건너뛰는 테스트다 — 이유와 이슈 번호를 주석으로 달거나 지운다. 이 변경에서 건너뛰게 했다면 보고에 밝힌다')
  }

  // 단언 없음 — 같은 파일의 도우미는 안을 보고, 다른 파일의 도우미는 판단하지 않는다
  const locals = localFunctions(source)
  const assertImports = new Set(imported.filter((i) => ASSERT_MODULES.test(i.spec)).map((i) => i.name))
  const helperImports = new Set(imported.filter((i) => /^[.~@#]/.test(i.spec) && HELPER_MODULE.test(i.spec) && !NON_ASSERTING.test(i.name)).map((i) => i.name))
  const asserting = new Set()
  for (let grew = true; grew; ) {
    grew = false
    for (const [name, range] of locals) {
      if (asserting.has(name)) continue
      const names = calledNames(source, range.start, range.end)
      if (ASSERT_OR_QUERY.test(masked.slice(range.start, range.end)) || [...names].some((n) => asserting.has(n) || assertImports.has(n))) {
        asserting.add(name)
        grew = true
      }
    }
  }
  for (const call of tests) {
    if (ASSERT_OR_QUERY.test(masked.slice(call.argsOpen, call.argsClose))) continue
    const names = calledNames(source, call.argsOpen, call.argsClose)
    if ([...names].some((n) => asserting.has(n) || assertImports.has(n) || helperImports.has(n))) continue
    add('test/no-assertion', call.line, '단언이 없는 테스트다 — 무엇이 틀려도 통과한다. 사용자가 보는 결과(화면·응답·저장된 값)를 단언한다', { span: [call.line, call.endLine] })
  }

  // 늘 참인 단언
  for (const e of exps) {
    const subject = norm(textOf(source, e.subject))
    const expected = e.args.length === 1 ? norm(textOf(source, e.args[0])) : null
    const alwaysTrueMatcher = (e.chain === '' && (e.matcher === 'toBeDefined' || e.matcher === 'toBeTruthy')) || (e.chain === '.not' && ['toBeNull', 'toBeUndefined', 'toBeFalsy'].includes(e.matcher))
    if (LITERAL.test(subject) || (e.chain === '' && EQUALITY.has(e.matcher) && expected === subject && !subject.includes('(')) || (RENDERED.test(subject) && alwaysTrueMatcher)) {
      add('test/tautology', e.line, '늘 참인 단언이다 — 값이 틀리면 실패하는 단언으로 바꾼다')
    }
  }
  for (const a of assertCalls) {
    const args = a.args.map((arg) => norm(textOf(source, arg)))
    if ((a.method === 'ok' && /^(?:true|-?[1-9]\d*|'[^']+'|"[^"]+")$/.test(args[0] ?? '')) || (ASSERT_EQUALITY.test(a.method) && args.length >= 2 && args[0] === args[1])) {
      add('test/tautology', a.line, '늘 참인 단언이다 — 값이 틀리면 실패하는 단언으로 바꾼다')
    }
  }

  // mock이 돌려준 값을 그대로 단언
  const hookValues = calls.filter((c) => c.hook === 'beforeEach' || c.hook === 'beforeAll').flatMap((c) => mockValues(source, c.argsOpen, c.argsClose))
  for (const call of tests) {
    const values = new Set([...mockValues(source, call.argsOpen, call.argsClose), ...hookValues])
    if (values.size === 0) continue
    for (const e of exps) {
      if (!within(e.index, call) || !['toBe', 'toEqual', 'toStrictEqual', 'toMatchObject'].includes(e.matcher) || !e.args[0]) continue
      const expected = norm(textOf(source, e.args[0]))
      if (values.has(expected)) add('test/mock-echo', e.line, `mock이 돌려준 값(${short(expected)})을 그대로 단언한다 — 대상 코드가 틀려도 통과한다. 입력에 따른 출력·부수효과를 단언한다`)
    }
    for (const a of assertCalls) {
      if (!within(a.index, call) || !ASSERT_EQUALITY.test(a.method) || !a.args[1]) continue
      const expected = norm(textOf(source, a.args[1]))
      if (values.has(expected)) add('test/mock-echo', a.line, `mock이 돌려준 값(${short(expected)})을 그대로 단언한다 — 대상 코드가 틀려도 통과한다. 입력에 따른 출력·부수효과를 단언한다`)
    }
  }

  // 모듈 mock — 테스트 대상(error), 네트워크 모듈(warn)
  const subjects = subjectsOf(path)
  for (const m of maskedMatches(source, /(?<![\w$.])(?:vi|jest)\s*\.\s*(?:mock|doMock|unstable_mockModule)\s*\(/g)) {
    const args = splitArgs(source, m.index + m[0].length - 1)
    const spec = args[0] ? stringIn(source, args[0]) : null
    if (!spec) continue
    const line = source.lineOf(m.index)
    if (NETWORK_MODULES.has(spec)) add('test/network-module-mock', line, `${spec} 모듈을 mock한다 — 요청 주소·본문이 틀려도 통과한다. MSW나 가짜 HTTP 서버로 네트워크 경계에서 바꾼다`)
    if (!spec.startsWith('.')) continue
    // 일부만 바꾸는 mock은 대상의 나머지를 실물로 둔다 — 확실한 결함이 아니다
    if (args[1] && /\b(?:importActual|requireActual|importOriginal|importMock)\b/.test(maskedOf(source, args[1]))) continue
    if (subjects.includes(stripModule(posix.join(posix.dirname(path), spec)))) {
      add('test/mock-subject', line, `테스트 대상 모듈(${spec})을 통째로 mock한다 — 대상 코드가 틀려도 통과한다. 대상은 실물로 두고 경계(네트워크·시간)만 바꾼다`)
    }
  }
  for (const m of [
    // 원래 fetch로 되돌리는 대입(globalThis.fetch = originalFetch)은 바꾸기가 아니다
    ...codeMatches(source, /(?<![\w$.])(?:global|globalThis|window)\s*\.\s*fetch\s*=(?!=)(?!\s*(?:original|orig|real|saved|prev|previous|native)\w*\s*(?:[;\n)}]|$))/gi),
    ...codeMatches(source, /\bspyOn\s*\(\s*(?:global|globalThis|window)\s*,\s*['"]fetch['"]/g),
    ...codeMatches(source, /\bstubGlobal\s*\(\s*['"]fetch['"]/g),
  ]) {
    add('test/network-module-mock', source.lineOf(m.index), NETWORK_MESSAGE)
  }

  // 실패를 삼키는 try/catch, if 안에만 있는 단언
  for (const call of tests) {
    const body = masked.slice(call.argsOpen, call.argsClose)
    const planned = /\bexpect\s*\.\s*(?:assertions|hasAssertions)\s*\(|(?<![\w$.])t\s*\.\s*plan\s*\(/.test(body)
    for (const m of maskedMatches(source, /(?<![\w$.])try\s*\{/g)) {
      if (!within(m.index, call)) continue
      const tryOpen = m.index + m[0].length - 1
      const tryClose = source.close(tryOpen)
      const handler = tryClose === -1 ? null : masked.slice(tryClose + 1).match(/^\s*catch\s*(?:\([^)]*\))?\s*\{/)
      if (!handler) continue
      const catchOpen = tryClose + handler[0].length
      const catchClose = source.close(catchOpen)
      if (catchClose === -1) continue
      const tryText = masked.slice(tryOpen, tryClose)
      const catchText = masked.slice(catchOpen, catchClose)
      const line = source.lineOf(tryClose + 1 + handler[0].indexOf('catch'))
      const span = [source.lineOf(m.index), source.lineOf(catchClose)]
      const tryAsserts = ASSERT.test(tryText)
      const catchAsserts = ASSERT.test(catchText)
      if (tryAsserts && !catchAsserts && !/\bthrow\b/.test(catchText)) {
        add('test/swallowed-failure', line, 'try 안의 단언 실패를 catch가 삼킨다 — 단언이 실패해도 테스트가 통과한다. 오류는 rejects·toThrow로 단언한다', { span })
      } else if (catchAsserts && !tryAsserts && !/\bthrow\b|\bfail\s*\(/.test(tryText) && !planned) {
        add('test/swallowed-failure', line, '단언이 catch 안에만 있다 — 오류가 나지 않으면 아무것도 확인하지 않고 통과한다. await expect(...).rejects·toThrow로 단언한다', { span })
      }
    }
    // 단언이 모두 if 안에 있을 때만 알린다 — if 밖에도 단언이 있으면 조건이 거짓이어도 무언가는 확인한다
    const conditional = []
    for (const m of maskedMatches(source, /(?<![\w$.])if\s*\(/g)) {
      if (!within(m.index, call)) continue
      const condClose = source.close(m.index + m[0].length - 1)
      if (condClose === -1) continue
      const start = skipSpace(masked, condClose + 1)
      const end = masked[start] === '{' ? source.close(start) : statementEnd(source, start)
      if (end === -1 || !ASSERT.test(masked.slice(start, end + 1))) continue
      const otherwise = masked.slice(end + 1).match(/^\s*;?\s*else\b/)
      if (otherwise) {
        const altStart = skipSpace(masked, end + 1 + otherwise[0].length)
        const altEnd = masked[altStart] === '{' ? source.close(altStart) : statementEnd(source, altStart)
        const alt = masked.slice(altStart, altEnd + 1)
        if (ASSERT.test(alt) || /\bthrow\b|\bfail\s*\(/.test(alt)) continue
      }
      conditional.push({ index: m.index, start, end })
    }
    let outside = body
    for (const range of conditional) outside = `${outside.slice(0, range.start - call.argsOpen)}${' '.repeat(range.end + 1 - range.start)}${outside.slice(range.end + 1 - call.argsOpen)}`
    if (ASSERT.test(outside)) continue
    for (const range of conditional) {
      add('test/swallowed-failure', source.lineOf(range.index), '단언이 if 안에만 있다 — 조건이 거짓이면 아무것도 확인하지 않고 통과한다. 조건을 먼저 단언하고 단언은 늘 실행되게 한다', {
        span: [source.lineOf(range.index), source.lineOf(range.end)],
      })
    }
  }

  // 구현과 함께 바꾼 기대값 — 테스트만 바뀌었으면 테스트를 고친 것일 수 있어 보지 않는다
  if (implementationChanged) {
    for (const hunk of hunks) {
      if (hunk.removed.length === 0 || hunk.added.length === 0) continue
      const before = hunk.removed.map((l) => lineExpectation(l.text)).filter(Boolean)
      for (const added of hunk.added) {
        const now = lineExpectation(added.text)
        const was = now && before.find((b) => b.key === now.key && b.expected !== now.expected)
        if (was) {
          add('test/rewritten-expectation', added.line, `구현과 함께 기대값을 바꿨다(${short(was.expected)} → ${short(now.expected)}) — 실패 원인을 코드에서 찾았는지 확인한다. 요구사항이 바뀌었다면 그 출처를 보고에 적는다`)
        }
      }
    }
  }

  // 스냅샷
  for (const e of exps) {
    if (!SNAPSHOT_MATCHERS.has(e.matcher)) continue
    if (WHOLE_SCREEN.test(norm(textOf(source, e.subject)))) add('test/snapshot-dump', e.line, '화면 전체를 스냅샷한다 — 무엇이 바뀌어도 갱신하면 통과한다. 필요한 값만 단언한다')
    else if (e.matcher === 'toMatchInlineSnapshot') {
      const last = source.lineOf(e.end)
      if (hunks.some((h) => h.removed.length > 0 && h.added.some((a) => a.line >= e.line && a.line <= last))) {
        add('test/snapshot-dump', e.line, '같은 변경에서 인라인 스냅샷을 갱신했다 — 바뀐 값이 의도한 것인지 확인하고 이유를 보고에 적는다')
      }
    }
  }

  // 실제 시간
  const fakeTimers = /\buseFakeTimers\b|\bFakeTimers\b|\bclock\s*\.\s*(?:tick|install)\b/.test(masked)
  const fixedClock = fakeTimers || /\bsetSystemTime\b|\bMockDate\b|\btimekeeper\b/.test(masked)
  if (!fakeTimers) {
    for (const m of maskedMatches(source, /(?<![\w$.])setTimeout\s*\(/g)) {
      const delay = splitArgs(source, m.index + m[0].length - 1)[1]
      if (delay && !/^0+$/.test(textOf(source, delay))) add('test/real-wait', source.lineOf(m.index), 'setTimeout으로 실제 시간을 기다린다 — 느리고 가끔 깨진다. 가짜 타이머로 시간을 넘기거나 findBy·waitFor로 결과를 기다린다')
    }
    for (const m of maskedMatches(source, /(?<![\w$.])(?:sleep|delay|wait|pause)\s*\(\s*(?:[1-9]|0\.\d)/g)) {
      add('test/real-wait', source.lineOf(m.index), '실제 시간을 기다린다 — 느리고 가끔 깨진다. 가짜 타이머로 시간을 넘기거나 기다릴 조건을 쓴다')
    }
  }
  for (const m of maskedMatches(source, /\.\s*waitForTimeout\s*\(|(?<![\w$.])cy\s*\.\s*wait\s*\(\s*\d/g)) {
    add('test/real-wait', source.lineOf(m.index), '정한 시간만큼 기다린다 — 느리고 가끔 깨진다. 기다릴 조건(expect(...).toBeVisible() 등)을 쓴다')
  }
  if (!fixedClock) {
    for (const m of maskedMatches(source, /(?<![\w$.])new\s+Date\s*\(\s*\)|(?<![\w$.])Date\s*\.\s*now\s*\(/g)) {
      add('test/real-wait', source.lineOf(m.index), '고정하지 않은 현재 시각에 기댄다 — 실행 시각에 따라 결과가 바뀐다. setSystemTime으로 시각을 고정한다')
    }
  }

  // console 막기 — 막은 경고를 단언하면 기대한 경고다
  for (const m of codeMatches(source, /\bspyOn\s*\(\s*console\s*,\s*['"](error|warn)['"]\s*\)/g)) {
    if (!/^\s*\.\s*(?:mockImplementation|mockReturnValue)\s*\(/.test(masked.slice(m.index + m[0].length))) continue
    // spy를 담은 이름 — const spy = …, spy = …, { error: … }
    const held = masked.slice(masked.lastIndexOf('\n', m.index) + 1, m.index).match(/([\w$]+)\s*[=:]\s*[\w$.\s]*$/)?.[1]
    if (new RegExp(`(?<![\\w$.])expect\\s*\\(\\s*console\\s*\\.\\s*${m[1]}\\b`).test(masked)) continue
    if (held && new RegExp(`(?<![\\w$.])expect\\s*\\(\\s*(?:[\\w$]+\\s*\\.\\s*)*${escape(held)}\\b|\\b${escape(held)}\\s*\\.\\s*mock\\s*\\.\\s*calls`).test(masked)) continue
    add('test/silenced-console', source.lineOf(m.index), `console.${m[1]}를 막아 경고를 숨긴다 — 경고의 원인을 고친다. 기대한 경고라면 그 호출을 단언한다`)
  }
  for (const m of [...codeMatches(source, /(?<![\w$.])console\s*\.\s*(?:error|warn)\s*=(?!=)/g), ...codeMatches(source, /\bstubGlobal\s*\(\s*['"]console['"]/g)]) {
    add('test/silenced-console', source.lineOf(m.index), 'console을 바꿔 경고를 숨긴다 — 경고의 원인을 고친다. 기대한 경고라면 그 호출을 단언한다')
  }

  // 재시도 — 테스트·describe의 옵션 객체, retryTimes, this.retries, describe.configure
  for (const call of calls) {
    const args = splitArgs(source, call.argsOpen)
    const options = call.kind === 'configure' ? args : args.slice(0, -1)
    for (const arg of options) {
      const text = maskedOf(source, arg)
      const retry = text.trim().startsWith('{') ? text.match(/\bretr(?:y|ies)\s*:\s*([^,}\n]*)/) : null
      if (retry && /[1-9]/.test(retry[1])) add('test/retry-mask', source.lineOf(arg.start + retry.index), RETRY_MESSAGE)
    }
  }
  for (const m of maskedMatches(source, /\bretryTimes\s*\(\s*[1-9]|\.\s*retries\s*\(\s*[1-9]/g)) add('test/retry-mask', source.lineOf(m.index), RETRY_MESSAGE)

  if (front) {
    for (const m of maskedMatches(source, /(?<![\w$])(?:querySelector|querySelectorAll|getElementsByClassName|getElementsByTagName)\s*\(/g)) {
      add('test/implementation-detail', source.lineOf(m.index), 'DOM 선택자로 찾는다 — 마크업이 바뀌면 깨지고 사용자가 보는 것과 다르다. 역할·이름(getByRole)으로 찾는다')
    }
    for (const e of exps) if (e.matcher === 'toHaveClass') add('test/implementation-detail', e.line, '클래스명을 단언한다 — 화면에 보이는 결과(글자·역할·상태)를 단언한다')
    if (imported.some((i) => i.spec === 'enzyme')) {
      for (const m of maskedMatches(source, /\.\s*(?:state|instance|setState)\s*\(/g)) add('test/implementation-detail', source.lineOf(m.index), '컴포넌트 내부 state를 본다 — 화면에 보이는 결과를 단언한다')
    }
    // React Native Testing Library는 testID로 찾는 것이 관례다(React Native는 2차 범위)
    const native = imported.some((i) => i.spec === '@testing-library/react-native')
    for (const m of native ? [] : maskedMatches(source, /(?<![\w$])(?:getBy|getAllBy|queryBy|queryAllBy|findBy|findAllBy)TestId\s*\(/g)) {
      add('test/testid-first', source.lineOf(m.index), 'testid로 찾는다 — 역할로 찾을 수 있으면 getByRole + 이름을 쓴다')
    }
    for (const m of maskedMatches(source, /(?<![\w$.])waitFor\s*\(/g)) {
      const arg = splitArgs(source, m.index + m[0].length - 1)[0]
      if (!arg) continue
      const fn = maskedOf(source, arg)
      const body = fn.includes('=>') ? fn.slice(fn.indexOf('=>') + 2) : fn
      const count = (body.match(/(?<![\w$.])expect\s*\(/g) ?? []).length
      const line = source.lineOf(m.index)
      if (/^\s*\{\s*\}\s*$/.test(body)) add('test/waitfor-misuse', line, 'waitFor가 아무것도 기다리지 않는다 — 기다릴 결과를 단언하거나 지운다')
      else if (/\b(?:fireEvent|userEvent)\s*\.|(?<![\w$.])user\s*\.\s*(?:click|dblClick|type|clear|selectOptions|deselectOptions|hover|unhover|keyboard|tab|upload|paste|pointer)\s*\(|\.click\s*\(\s*\)|(?<![\w$.])render\s*\(/.test(body)) {
        add('test/waitfor-misuse', line, 'waitFor 안에서 동작을 실행한다 — 기다리는 동안 동작이 여러 번 실행된다. 동작은 밖에서 하고 결과만 기다린다')
      } else if (count >= 2) add('test/waitfor-misuse', line, 'waitFor 안에 단언이 여러 개다 — 첫 단언이 통과할 때까지 나머지를 보지 못한다. 단언 하나만 두고 나머지는 밖으로 뺀다')
      else if (count === 0 && /(?:getBy|getAllBy)\w*\s*\(/.test(body)) add('test/waitfor-misuse', line, 'waitFor로 요소를 찾기만 한다 — findBy를 쓴다')
    }
  }
  return out
}

/** 테스트 설정 파일(vitest·jest·playwright·cypress)의 재시도 */
export const testConfigRules = ({ source }) =>
  maskedMatches(source, /\bretr(?:y|ies)\s*:\s*([^,}\n]*)/g)
    .filter((m) => /[1-9]/.test(m[1]))
    .map((m) => ({ id: 'test/retry-mask', line: source.lineOf(m.index), message: RETRY_MESSAGE }))

/** 스냅샷 파일 — 새로 만든 것은 괜찮고, 고쳤으면 이유를 보고에 적게 한다 */
export const snapshotRules = ({ hunks }) =>
  hunks
    .filter((hunk) => hunk.removed.length > 0)
    .slice(0, 1)
    .map((hunk) => ({ id: 'test/snapshot-dump', line: hunk.added[0]?.line ?? Math.max(1, hunk.newStart), message: '같은 변경에서 스냅샷 파일을 갱신했다 — 바뀐 화면이 의도한 것인지 확인하고 이유를 보고에 적는다' }))
