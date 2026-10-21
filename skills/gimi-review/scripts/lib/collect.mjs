/**
 * 맥락 묶음 만들기 — 범위·바뀐 파일·의도·이력을 모으고, 모으지 못한 것은 이유와 함께 skipped에 남긴다(설계 결정 19).
 * "없음"과 "건너뜀"을 섞지 않는다. 사용처를 찾지 못한 것과 찾기를 건너뛴 것은 다르다.
 */
import { parseDiff } from './diff.mjs'
import { attempt } from './exec.mjs'
import { collectHistory } from './history.mjs'
import { collectIntent } from './intent.mjs'
import { resolveScope } from './scope.mjs'

const PR_FIELDS = 'number,title,body,url,baseRefName,headRefOid,closingIssuesReferences'

/**
 * @param {{
 *   exec: { git: (args: string[]) => string, gh: (args: string[]) => string },
 *   pr?: number | null, base?: string | null, recentCommits?: number,
 *   keyPatterns?: { source: string, pattern: string }[], useGh?: boolean, now?: Date,
 * }} args
 */
export const collectContext = ({ exec, pr = null, base = null, recentCommits = 10, keyPatterns = [], useGh = true, now = new Date() }) => {
  const skipped = []
  const notes = []

  let gh = null
  if (!useGh) skipped.push({ context: '의도', reason: 'gh를 쓰지 않음(--no-gh) — PR·이슈 본문을 읽지 않았다' })
  else if (attempt(() => (exec.gh(['auth', 'status']), true))) gh = exec.gh
  else skipped.push({ context: '의도', reason: 'gh가 없거나 로그인하지 않았다 — PR·이슈 본문을 읽지 않았다(gh auth login)' })

  // 번호가 없으면 현재 브랜치의 PR을 찾는다. 없으면 PR 없이 간다(건너뜀이 아니라 "없음")
  const prInfo = gh ? attempt(() => JSON.parse(gh(['pr', 'view', ...(pr == null ? [] : [String(pr)]), '--json', PR_FIELDS]))) : null
  if (gh && pr != null && !prInfo) skipped.push({ context: '의도', reason: `PR #${pr}을(를) 열지 못했다` })

  const scope = resolveScope({ exec, base, pr: prInfo })
  // 사용자의 diff 설정(접두어 없애기 등)이 출력 모양을 바꾸지 않게 접두어를 정해 준다
  const files = parseDiff(exec.git(['diff', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', '--unified=0', '-M', scope.mergeBase, 'HEAD']))
  const intent = collectIntent({ exec, gh, scope, prInfo, keyPatterns })

  const shallow = exec.git(['rev-parse', '--is-shallow-repository']).trim() === 'true'
  if (shallow) skipped.push({ context: '이력', reason: '얕은 복제라 이력을 볼 수 없다(git fetch --unshallow 뒤 다시 돌린다)' })
  const history = shallow ? null : collectHistory({ exec, scope, files, recentCommits })

  skipped.push({ context: '영향 범위', reason: '아직 구현 전 — 바뀐 export·타입·API 응답의 사용처는 직접 찾는다' })
  if (scope.dirty) notes.push('작업 트리에 커밋하지 않은 변경이 있다 — 맥락에 넣지 않았다')

  const prRef = prInfo ? { number: prInfo.number, url: prInfo.url } : pr != null ? { number: pr, url: null } : null
  return { version: 1, generatedAt: now.toISOString(), scope: { ...scope, pr: prRef }, files, intent, history, impact: null, skipped, notes }
}
