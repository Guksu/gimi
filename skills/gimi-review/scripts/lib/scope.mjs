// @shared scope.mjs origin: gimi-review
/**
 * 리뷰 범위 — 기준 브랜치와 HEAD의 갈림점(merge-base)부터 HEAD까지다.
 * 기준은 --base → PR의 기준 브랜치 → 원격 기본 브랜치(origin/HEAD) → origin/main·origin/master → main·master 순서로 정한다.
 * PR을 지정했는데 그 PR이 체크아웃돼 있지 않으면 멈춘다 — 사용자 저장소에 ref를 만드는 부수효과를 피한다.
 */
import { ContextError, attempt } from './exec.mjs'

/** @param {{ git: (args: string[]) => string }} exec @param {string} ref */
const exists = (exec, ref) => attempt(() => exec.git(['rev-parse', '--verify', '-q', `${ref}^{commit}`])) != null

/** @param {{ git: (args: string[]) => string }} exec */
export const defaultBranch = (exec) => {
  const remoteHead = attempt(() => exec.git(['symbolic-ref', '--short', '-q', 'refs/remotes/origin/HEAD']).trim())
  if (remoteHead) return remoteHead
  // 원격 쪽이 먼저다 — 로컬 main은 오래됐을 수 있고, PR은 원격 기본 브랜치를 향한다
  return ['origin/main', 'origin/master', 'main', 'master'].find((ref) => exists(exec, ref)) ?? null
}

const baseFromPr = (exec, pr) => {
  if (!pr?.baseRefName) return null
  const remote = `origin/${pr.baseRefName}`
  if (exists(exec, remote)) return remote
  return exists(exec, pr.baseRefName) ? pr.baseRefName : null
}

/**
 * @param {{ exec: { git: (args: string[]) => string }, base?: string | null, pr?: { number: number, baseRefName?: string, headRefOid?: string } | null }} args
 */
export const resolveScope = ({ exec, base = null, pr = null }) => {
  const head = attempt(() => exec.git(['rev-parse', 'HEAD']).trim())
  if (!head) throw new ContextError('커밋이 없다 — 리뷰할 커밋을 만든 뒤 돌린다')
  if (pr?.headRefOid && pr.headRefOid !== head) {
    throw new ContextError(`PR #${pr.number}의 머리 커밋(${pr.headRefOid.slice(0, 7)})이 HEAD(${head.slice(0, 7)})와 다르다 — gh pr checkout ${pr.number}로 체크아웃한 뒤 다시 돌린다`)
  }
  const baseRef = base ?? baseFromPr(exec, pr) ?? defaultBranch(exec)
  if (!baseRef) throw new ContextError('기준 브랜치를 찾지 못했다 — --base <브랜치>로 정한다')
  if (!exists(exec, baseRef)) throw new ContextError(`기준 "${baseRef}"를 찾지 못했다 — --base로 있는 브랜치를 정한다`)
  const mergeBase = attempt(() => exec.git(['merge-base', baseRef, 'HEAD']).trim())
  if (!mergeBase) throw new ContextError(`${baseRef}와 HEAD의 갈림점을 찾지 못했다 — 얕은 복제라면 git fetch --deepen으로 이력을 더 받는다`)
  return {
    baseRef,
    head,
    branch: attempt(() => exec.git(['symbolic-ref', '--short', '-q', 'HEAD']).trim()) || null,
    mergeBase,
    commitCount: Number(exec.git(['rev-list', '--count', `${mergeBase}..HEAD`]).trim()),
    dirty: exec.git(['status', '--porcelain']).trim().length > 0,
  }
}
