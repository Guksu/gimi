/**
 * 변경 이력 맥락 — 바꾸거나 지운 줄을 마지막으로 바꾼 커밋(blame)과 파일마다 최근 커밋 N개를 모은다(설계 결정 22).
 * 기준은 이번 변경 전(갈림점)이다. 새 변경이 예전 수정을 되돌리는지는 에이전트가 판단한다.
 */
import { join } from 'node:path'
import { oldChangedRanges } from './diff.mjs'
import { attempt, readRepoFile } from './exec.mjs'

/** git log 형식 — 필드는 \x1f, 커밋은 \x1e로 나눈다(제목·본문에 거의 나오지 않는 문자) */
export const LOG_FORMAT = '%H%x1f%s%x1f%b%x1f%cI%x1e'

const FIX = /^fix(\([^)]*\))?!?:|\bfix(e[sd])?\b|\bbug ?fix\b|버그 ?(수정|픽스)|(오류|문제|결함) ?수정/i
const REVERT = /^revert\b|\brevert(s|ed)?\b|되돌/i
const HOTFIX = /hotfix|핫픽스/i
const WORKAROUND = /workaround|우회|임시 ?(처리|조치|방편)|\bhack\b/i
const FORMATTING = [
  /^(style|chore)(\([^)]*\))?!?:.*(format|lint|prettier|eslint|포맷|린트|서식)/i,
  /\b(prettier|reformat(ted|ting)?|formatting)\b/i,
  /서식 ?정리|포맷 ?정리|코드 ?정렬/,
]

const CONVENTIONAL = /^(\w+)(\([^)]*\))?!?\s*:/
const NON_FIX_TYPES = new Set(['feat', 'docs', 'chore', 'refactor', 'test', 'style', 'perf', 'build', 'ci'])

/**
 * 제목에 수정이 아닌 유형(feat·docs…)이 있으면 제목만 본다 — 큰 기능 커밋 본문에 섞인 "버그 수정" 항목으로 표시하지 않는다.
 * 유형이 없으면 본문까지 본다.
 * @param {{ subject: string, body?: string }} commit @returns {('fix' | 'revert' | 'hotfix' | 'workaround')[]}
 */
export const classifyCommit = ({ subject, body = '' }) => {
  const type = subject.match(CONVENTIONAL)?.[1]?.toLowerCase()
  const text = type && NON_FIX_TYPES.has(type) ? subject : `${subject}\n${body}`
  const tags = []
  if (FIX.test(text)) tags.push('fix')
  if (REVERT.test(text)) tags.push('revert')
  if (HOTFIX.test(text)) tags.push('hotfix')
  if (WORKAROUND.test(text)) tags.push('workaround')
  return tags
}

/** 서식만 바꾼 커밋 — blame과 요약에서 뺀다 @param {{ subject: string }} commit */
export const isFormatting = ({ subject }) => FORMATTING.some((pattern) => pattern.test(subject))

/** 스쿼시 "(#12)"·머지 "Merge pull request #7"에서 PR 번호 @param {{ subject: string }} commit */
export const prRefsOf = ({ subject }) => {
  const squash = subject.match(/\(#(\d+)\)\s*$/)
  const merge = subject.match(/Merge pull request #(\d+)/)
  return [squash?.[1], merge?.[1]].filter(Boolean).map(Number)
}

/** @param {string} text LOG_FORMAT으로 받은 출력 */
export const parseLog = (text) =>
  text
    .split('\x1e')
    .map((record) => record.replace(/^\n+/, ''))
    .filter(Boolean)
    .map((record) => {
      const [sha, subject = '', body = '', date = ''] = record.split('\x1f')
      return { sha: sha.trim(), subject, body: body.trim(), date: date.trim() }
    })

/**
 * `git blame --porcelain` 해석 — 줄마다 커밋, 커밋마다 요약
 * @param {string} text
 * @returns {{ lines: { line: number, sha: string }[], commits: Map<string, { summary?: string, boundary?: boolean }> }}
 */
export const parseBlamePorcelain = (text) => {
  const lines = []
  const commits = new Map()
  let current = null
  for (const row of text.split('\n')) {
    const header = row.match(/^([0-9a-f]{40}) \d+ (\d+)(?: \d+)?$/)
    if (header) {
      current = { sha: header[1], line: Number(header[2]) }
      if (!commits.has(current.sha)) commits.set(current.sha, {})
      continue
    }
    if (!current) continue
    if (row.startsWith('\t')) {
      lines.push({ line: current.line, sha: current.sha })
      current = null
    } else if (row.startsWith('summary ')) commits.get(current.sha).summary = row.slice('summary '.length)
    else if (row === 'boundary') commits.get(current.sha).boundary = true
  }
  return { lines, commits }
}

const describe = (commit) => ({
  sha: commit.sha,
  short: commit.sha.slice(0, 7),
  subject: commit.subject,
  body: commit.body,
  date: commit.date,
  tags: classifyCommit(commit),
  formatting: isFormatting(commit),
  prRefs: prRefsOf(commit),
})

/**
 * @param {{ exec: { git: (args: string[]) => string }, scope: { mergeBase: string }, files: import('./diff.mjs').FileDiff[], recentCommits: number }} args
 */
export const collectHistory = ({ exec, scope, files, recentCommits }) => {
  const root = exec.git(['rev-parse', '--show-toplevel']).trim()
  const ignoreFile = join(root, '.git-blame-ignore-revs')
  // 무시 목록은 저장소 안의 일반 파일일 때만 쓴다(심볼릭 링크로 밖·장치 파일을 가리키지 못하게)
  const ignoreArgs = readRepoFile({ root, path: '.git-blame-ignore-revs' }) != null ? ['--ignore-revs-file', ignoreFile] : []
  const notes = []
  const commits = new Map()
  const result = []

  for (const file of files) {
    // 새 파일에는 옛 줄이 없다. 바이너리는 줄 단위 이력을 볼 수 없다
    if (file.status === 'added' || !file.oldPath || file.binary) continue
    const blamed = new Map()
    let changedOldLines = 0
    for (const [start, end] of oldChangedRanges(file)) {
      changedOldLines += end - start + 1
      // --no-textconv — 저장소의 .gitattributes가 고른 변환 프로그램을 돌리지 않는다
      const args = ['blame', '--porcelain', '--no-textconv', '-L', `${start},${end}`, scope.mergeBase, '--', file.oldPath]
      // 무시 목록에 잘못된 커밋이 있으면 blame이 실패한다 — 목록 없이 다시 돌리고 알린다
      let out = attempt(() => exec.git([...args.slice(0, 2), ...ignoreArgs, ...args.slice(2)]))
      if (out == null && ignoreArgs.length > 0) {
        out = attempt(() => exec.git(args))
        if (out != null) notes.push('.git-blame-ignore-revs를 읽지 못해 무시 목록 없이 blame했다')
      }
      if (out == null) continue
      for (const { line, sha } of parseBlamePorcelain(out).lines) blamed.set(sha, [...(blamed.get(sha) ?? []), line])
    }
    const recent = parseLog(exec.git(['log', '-n', String(recentCommits), `--format=${LOG_FORMAT}`, scope.mergeBase, '--', file.oldPath]))
    for (const commit of recent) commits.set(commit.sha, describe(commit))
    result.push({
      path: file.oldPath,
      newPath: file.newPath,
      status: file.status,
      changedOldLines,
      blamed: [...blamed].map(([sha, lines]) => ({ sha, lines })),
      recent: recent.map((commit) => commit.sha),
    })
  }

  // 최근 N개 밖의 오래된 커밋이 blame에 나오면 내용을 따로 읽는다
  const missing = [...new Set(result.flatMap((file) => file.blamed.map((b) => b.sha)))].filter((sha) => !commits.has(sha))
  if (missing.length > 0) for (const commit of parseLog(exec.git(['show', '-s', `--format=${LOG_FORMAT}`, ...missing]))) commits.set(commit.sha, describe(commit))

  return { recentCommits, ignoreRevs: ignoreArgs.length > 0, files: result, commits: Object.fromEntries(commits), notes }
}
