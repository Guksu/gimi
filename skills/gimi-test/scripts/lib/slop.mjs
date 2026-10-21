/**
 * 슬롭 정적 검사(설계 7절의 "검사 error·warn" 줄) — 바뀐 JS·TS 파일의 바뀐 줄만 본다. 새 파일은 모든 줄이 바뀐 줄이다.
 * error는 확실한 결함이라 끝내기 전 검사를 실패로 만든다. warn은 알리고 판단은 맡긴다.
 * 줄 위나 끝의 `// gimi-ignore: {ID} — {이유}`로 지적을 무시한다. 이유가 없으면 무시하지 않는다.
 */
import { codeRules } from './slop-code.mjs'
import { snapshotRules, testConfigRules, testRules } from './slop-test.mjs'
import { readSource } from './source.mjs'

const JS = /\.(?:m|c)?[jt]sx?$/
// 테스트 파일 — 이름(.test·.spec), 테스트 폴더(__tests__·__mocks__·test·tests), 테스트 설정(jest.setup·setupTests)
const TEST = /(?:^|\/)(?:__tests__|__mocks__|__fixtures__|tests?)\/|\.(?:test|spec)\.(?:m|c)?[jt]sx?$|(?:^|\/)(?:(?:jest|vitest)\.setup|setupTests)\.(?:m|c)?[jt]sx?$/
const SKIPPED = /\.d\.(?:m|c)?ts$|\.min\.js$/
// .agents/·.claude/·.github/처럼 점으로 시작하는 폴더는 도구용 파일이다
const TOOLING = /(?:^|\/)\.[^/]+\//
const TEST_CONFIG = /(?:^|\/)(?:vitest|vite|jest|playwright|cypress)\.config\.(?:m|c)?[jt]s$|(?:^|\/)vitest\.workspace\.(?:m|c)?[jt]s$/
// 구현으로 보는 파일 — 기대값을 바꾼 테스트와 함께 바뀌었는지 볼 때 쓴다
const IMPLEMENTATION = /\.(?:m|c)?[jt]sx?$|\.(?:vue|svelte|py|go|kt|kts|java|rb|rs|cs|php|swift|scala)$/
const ERRORS = new Set(['test/only-left', 'test/no-assertion', 'test/mock-subject', 'test/swallowed-failure', 'code/empty-catch'])
const IGNORE = /gimi-ignore:\s*([\w/-]+(?:\s*,\s*[\w/-]+)*)\s*(?:(?:—|–|--|-|:)\s*([\s\S]*?))?\s*(?:\*\/)?\s*$/

/** @param {string} path @returns {'test' | 'code' | 'snapshot' | null} */
export const slopTargetOf = (path) => {
  if (TOOLING.test(path)) return null
  if (path.endsWith('.snap')) return 'snapshot'
  if (!JS.test(path) || SKIPPED.test(path)) return null
  return TEST.test(path) ? 'test' : 'code'
}

/** 줄 번호 → 그 줄을 무시하는 주석들. 자기 줄에만 있는 주석은 다음 줄에도 걸린다 */
const ignoresOf = (source) => {
  const map = new Map()
  for (const comment of source.comments) {
    const m = comment.text.match(IGNORE)
    if (!m) continue
    const entry = { ids: m[1].split(/\s*,\s*/), reason: (m[2] ?? '').trim() }
    const endLine = source.lineOf(Math.max(comment.start, comment.end - 1))
    for (const line of comment.ownLine ? [comment.line, endLine + 1] : [comment.line]) map.set(line, [...(map.get(line) ?? []), entry])
  }
  return map
}

const touched = (lines, finding) => {
  if (lines.all) return true
  const [from, to] = finding.span ?? [finding.line, finding.line]
  for (let line = from; line <= to; line += 1) if (lines.added.has(line)) return true
  return false
}

/**
 * @param {{
 *   files: { path: string, text: string, lines?: { all: boolean, added: Set<number>, hunks: import('./diff.mjs').Hunk[] } }[],
 *   changedPaths?: string[],
 *   stacks?: string[],
 * }} args
 */
export const checkSlop = ({ files, changedPaths = [], stacks = ['frontend-ts'] }) => {
  const front = stacks.includes('frontend-ts')
  const implementationChanged = changedPaths.some((path) => IMPLEMENTATION.test(path) && !TEST.test(path) && !SKIPPED.test(path) && !TOOLING.test(path) && !TEST_CONFIG.test(path))
  const findings = []
  const ignored = []
  const checked = { test: 0, code: 0, snapshot: 0 }

  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const target = slopTargetOf(file.path)
    if (!target) continue
    checked[target] += 1
    const lines = file.lines ?? { all: true, added: new Set(), hunks: [] }
    const source = readSource(file.text)
    const raw =
      target === 'snapshot'
        ? snapshotRules({ hunks: lines.hunks })
        : [
            ...(target === 'test' ? testRules({ source, path: file.path, hunks: lines.hunks, implementationChanged, front }) : []),
            ...(TEST_CONFIG.test(file.path) ? testConfigRules({ source }) : []),
            ...codeRules({ source, path: file.path, kind: target, front }),
          ]
    const ignores = target === 'snapshot' ? new Map() : ignoresOf(source)
    const seen = new Set()
    for (const found of raw.sort((a, b) => a.line - b.line || a.id.localeCompare(b.id))) {
      const key = `${found.id}:${found.line}`
      if (seen.has(key) || !touched(lines, found)) continue
      seen.add(key)
      const finding = {
        id: found.id,
        severity: found.severity ?? (ERRORS.has(found.id) ? 'error' : 'warn'),
        path: file.path,
        line: found.line,
        message: found.message,
        excerpt: source.lineText(found.line).trim().slice(0, 160),
      }
      const ignore = (ignores.get(found.line) ?? []).find((entry) => entry.ids.includes(found.id))
      if (ignore && /[\p{L}\p{N}]/u.test(ignore.reason)) ignored.push({ ...finding, reason: ignore.reason })
      else findings.push(ignore ? { ...finding, note: '무시 주석에 이유가 없어 무시하지 않았다 — // gimi-ignore: {ID} — {이유}' } : finding)
    }
  }
  return { findings, ignored, checked }
}
