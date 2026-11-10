/**
 * 커밋하지 않은 변경 리뷰(설계 결정 67) — `--worktree`면 범위가 갈림점부터 작업 트리까지다.
 * git이 추적하는 파일의 변경은 `git diff <갈림점>`이 주고, 추적하지 않는 새 파일은 여기서 "더한 파일"로 만든다.
 * 변경 후 내용은 HEAD가 아니라 작업 트리에서 읽는다.
 */
import { lstatSync } from 'node:fs'
import { join } from 'node:path'
import { attempt, readRepoFile } from './exec.mjs'

/** gimi가 쓰는 폴더 — 맥락 묶음과 리뷰 기록은 리뷰할 변경이 아니다 */
export const REVIEW_DIR = 'docs/gimi/reviews'
const MAX_UNTRACKED = 200
// 시크릿으로 보이는 이름 — 내용을 읽지 않고 이름만 알린다
export const SECRET_LIKE = /(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|\.netrc|id_(?:rsa|dsa|ecdsa|ed25519)|[^/]*\.(?:pem|key|p12|pfx|keystore|jks))$/i

/**
 * 변경 후의 파일 내용 — worktree면 작업 트리(저장소 안의 일반 파일만), 아니면 HEAD
 * @param {{ exec: { git: (args: string[]) => string }, root: string, scope: { worktree?: boolean }, path: string }} args
 * @returns {string | null}
 */
export const readAfter = ({ exec, root, scope, path }) => (scope.worktree ? readRepoFile({ root, path }) : attempt(() => exec.git(['show', `HEAD:${path}`])))

/**
 * 추적하지 않는 새 파일(.gitignore에 걸리지 않는 것)을 더한 파일로 돌려준다.
 * 심볼릭 링크와 읽을 수 없는 파일(저장소 밖·일반 파일 아님·4MB 넘음), 시크릿으로 보이는 파일(.env·키 파일), 안에 다른 git 저장소가 든 폴더는 넣지 않고 알린다.
 * @param {{ exec: { git: (args: string[]) => string }, root: string }} args
 * @returns {{ files: (import('./diff.mjs').FileDiff & { untracked: true })[], notes: string[] }}
 */
export const untrackedFiles = ({ exec, root }) => {
  const listed = (attempt(() => exec.git(['ls-files', '-z', '--others', '--exclude-standard'])) ?? '')
    .split('\0')
    .filter((path) => path && !path.startsWith(`${REVIEW_DIR}/`))
    .sort()
  const notes = []
  if (listed.length > MAX_UNTRACKED) notes.push(`추적하지 않는 새 파일이 ${listed.length}개다 — 앞 ${MAX_UNTRACKED}개만 넣었다(.gitignore에 빠진 폴더가 있는지 확인한다)`)
  const files = []
  const unread = []
  const secrets = []
  const nested = []
  for (const path of listed.slice(0, MAX_UNTRACKED)) {
    // git은 안에 다른 git 저장소가 든 폴더를 "폴더/" 한 줄로 준다
    if (path.endsWith('/')) {
      nested.push(path)
      continue
    }
    if (SECRET_LIKE.test(path)) {
      secrets.push(path)
      continue
    }
    const text = attempt(() => lstatSync(join(root, path)))?.isSymbolicLink() ? null : readRepoFile({ root, path })
    if (text == null) {
      unread.push(path)
      continue
    }
    const base = { oldPath: null, newPath: path, status: /** @type {const} */ ('added'), untracked: /** @type {const} */ (true), deletions: 0 }
    if (text.includes('\0')) {
      files.push({ ...base, binary: true, hunks: [], additions: 0 })
      continue
    }
    const rows = text === '' ? [] : text.replace(/\n$/, '').split('\n')
    const added = rows.map((row, i) => ({ line: i + 1, text: row }))
    files.push({ ...base, binary: false, hunks: added.length > 0 ? [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: added.length, removed: [], added }] : [], additions: added.length })
  }
  if (unread.length > 0) notes.push(`추적하지 않는 새 파일 ${unread.length}개(${unread.slice(0, 3).join(', ')}${unread.length > 3 ? ' 등' : ''})는 읽지 않았다 — 심볼릭 링크거나 일반 파일이 아니거나 너무 크다`)
  if (secrets.length > 0) notes.push(`시크릿으로 보이는 새 파일 ${secrets.length}개(${secrets.slice(0, 5).join(', ')}${secrets.length > 5 ? ' 등' : ''})는 읽지 않았다 — 커밋할 파일이 아니면 .gitignore에 더한다`)
  if (nested.length > 0) notes.push(`안에 다른 git 저장소가 든 폴더 ${nested.length}개(${nested.slice(0, 3).join(', ')}${nested.length > 3 ? ' 등' : ''})는 넣지 않았다`)
  return { files, notes }
}
