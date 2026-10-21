/**
 * 끝내기 전 검사의 바뀐 범위 — 기준 브랜치와의 갈림점부터 지금 작업 트리까지다.
 * 끝내기 직전에는 보통 아직 커밋하지 않았으므로 커밋한 변경, 작업 트리 변경(스테이지 여부와 상관없이), 새 파일을 모두 넣는다.
 */
import { ContextError, attempt } from './exec.mjs'
import { defaultBranch } from './scope.mjs'

/**
 * `git diff --name-status -z` 출력 — 상태\0경로\0, 이름 바꿈·복사는 상태\0옛 경로\0새 경로\0
 * @param {string} text @returns {{ status: string, path: string, oldPath: string | null }[]}
 */
export const parseNameStatus = (text) => {
  const parts = text.split('\0').filter((part) => part !== '')
  const out = []
  for (let i = 0; i < parts.length; ) {
    const status = parts[i][0]
    if (status === 'R' || status === 'C') {
      out.push({ status, path: parts[i + 2], oldPath: parts[i + 1] })
      i += 3
    } else {
      out.push({ status, path: parts[i + 1], oldPath: null })
      i += 2
    }
  }
  return out
}

/**
 * @param {{ exec: { git: (args: string[]) => string }, base?: string | null }} args
 */
export const collectChanges = ({ exec, base = null }) => {
  const head = attempt(() => exec.git(['rev-parse', 'HEAD']).trim())
  if (!head) throw new ContextError('커밋이 없다 — 커밋을 하나 만든 뒤 돌린다')
  const baseRef = base ?? defaultBranch(exec)
  if (!baseRef) throw new ContextError('기준 브랜치를 찾지 못했다 — --base <브랜치>로 정한다')
  if (attempt(() => exec.git(['rev-parse', '--verify', '-q', `${baseRef}^{commit}`])) == null) throw new ContextError(`기준 "${baseRef}"를 찾지 못했다 — --base로 있는 브랜치를 정한다`)
  const mergeBase = attempt(() => exec.git(['merge-base', baseRef, 'HEAD']).trim())
  if (!mergeBase) throw new ContextError(`${baseRef}와 HEAD의 갈림점을 찾지 못했다 — 얕은 복제라면 git fetch --deepen으로 이력을 더 받는다`)

  const files = new Map()
  const add = ({ status, path, oldPath }, source) => {
    const prev = files.get(path)
    // 나중 출처(작업 트리)의 상태가 지금 상태다 — 커밋에서 바꾸고 작업 트리에서 지웠으면 지운 것이다
    files.set(path, { path, oldPath: oldPath ?? prev?.oldPath ?? null, status, sources: [...(prev?.sources ?? []), source] })
  }
  for (const entry of parseNameStatus(exec.git(['diff', '--name-status', '-z', '-M', mergeBase, 'HEAD']))) add(entry, 'commit')
  for (const entry of parseNameStatus(exec.git(['diff', '--name-status', '-z', '-M', 'HEAD']))) add(entry, 'worktree')
  for (const path of exec.git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)) add({ status: 'A', path, oldPath: null }, 'untracked')

  return {
    baseRef,
    mergeBase,
    head,
    branch: attempt(() => exec.git(['symbolic-ref', '--short', '-q', 'HEAD']).trim()) || null,
    files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)),
  }
}
