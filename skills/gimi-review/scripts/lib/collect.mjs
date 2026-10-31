/**
 * 맥락 묶음 만들기 — 범위·바뀐 파일·의도·이력·영향 범위를 모으고, 모으지 못한 것은 이유와 함께 skipped에 남긴다(설계 결정 19).
 * "없음"과 "건너뜀"을 섞지 않는다. 사용처를 찾지 못한 것과 찾기를 건너뛴 것은 다르다.
 */
import { collectContracts } from './contracts.mjs'
import { parseDiff } from './diff.mjs'
import { attempt } from './exec.mjs'
import { collectHistory } from './history.mjs'
import { collectImpact, loadTypescript } from './impact.mjs'
import { collectIntent } from './intent.mjs'
import { resolveLinked } from './linked.mjs'
import { resolveScope } from './scope.mjs'
import { loadYaml } from './yaml.mjs'

const PR_FIELDS = 'number,title,body,url,baseRefName,headRefOid,closingIssuesReferences'
const MAX_LINE_TEXT = 300

// 맥락 묶음에는 지운 줄의 내용(파일에서 사라졌다)과 더한 줄의 번호만 담는다 — 더한 줄은 파일을 열면 있다
const slim = (file) => ({
  ...file,
  hunks: file.hunks.map((hunk) => ({
    ...hunk,
    removed: hunk.removed.map(({ line, text }) => ({ line, text: text.length > MAX_LINE_TEXT ? `${text.slice(0, MAX_LINE_TEXT)}…` : text })),
    added: hunk.added.map(({ line }) => line),
  })),
})

const CONTRACT_LIKE = /\.(?:ya?ml|json|graphqls?|gql)$/i
const LINKED_CONFIG = '.agents/gimi.json'

/**
 * 함께 보는 저장소 목록은 믿을 수 있는 설정에서만 쓴다 — 이 변경(PR)이 설정의 linkedRepos를 바꿨으면, 리뷰하는 사람 컴퓨터의
 * 다른 저장소를 읽게(그 저장소의 typescript를 불러오게) 할 수 있으니 기준(갈림점)에 커밋된 값을 쓴다.
 * 바꾸지 않았으면 작업 트리의 값(리뷰하는 사람이 고친 것 포함)을 쓴다
 */
const trustedLinkedRepos = ({ exec, scope, linkedRepos, notes }) => {
  const at = (rev) => attempt(() => JSON.parse(exec.git(['show', `${rev}:${LINKED_CONFIG}`])))?.linkedRepos ?? null
  const base = at(scope.mergeBase)
  if (JSON.stringify(at('HEAD')) === JSON.stringify(base)) return linkedRepos
  notes.push(`이 변경이 ${LINKED_CONFIG}의 linkedRepos를 바꿨다 — 리뷰하는 컴퓨터의 다른 저장소를 읽게 할 수 있어 기준(갈림점)의 값만 썼다`)
  return base
}

/**
 * @param {{
 *   exec: { git: (args: string[]) => string, gh: (args: string[]) => string },
 *   pr?: number | null, base?: string | null, recentCommits?: number,
 *   keyPatterns?: { source: string, pattern: string }[], useGh?: boolean, now?: Date,
 *   loadTs?: (args: { root: string }) => { ts: any, reason: string | null },
 *   linkedRepos?: unknown,
 * }} args linkedRepos는 작업 트리 설정의 값 — PR이 바꿨으면 기준의 값을 쓴다(trustedLinkedRepos)
 */
export const collectContext = ({ exec, pr = null, base = null, recentCommits = 10, keyPatterns = [], useGh = true, now = new Date(), loadTs = loadTypescript, linkedRepos = null }) => {
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

  const root = exec.git(['rev-parse', '--show-toplevel']).trim()
  const { ts, reason } = loadTs({ root })
  const impact = collectImpact({ exec, root, scope, files, ts, reason })
  // 프론트·백엔드를 잇는 계약 파일(OpenAPI·GraphQL 스키마) — 바뀐 엔드포인트·필드와 그 사용처(설계 결정 47).
  // 함께 보는 저장소(설계 결정 57)가 있으면 그 저장소에서도 찾는다 — 계약일 수 있는 파일이 바뀐 때만 읽는다
  const maybeContract = files.some((file) => !file.binary && CONTRACT_LIKE.test(file.newPath ?? file.oldPath))
  const linked = maybeContract ? resolveLinked({ root, linkedRepos: trustedLinkedRepos({ exec, scope, linkedRepos, notes: impact.notes }), loadTs }) : { linked: [], skipped: [], notes: [] }
  impact.notes.push(...linked.notes)
  skipped.push(...linked.skipped)
  const contracts = collectContracts({ exec, root, scope, files, ts, yaml: loadYaml({ root }), linked: linked.linked })
  impact.contracts = contracts.contracts
  impact.notes.push(...contracts.notes)
  skipped.push(...contracts.skipped)
  if (scope.dirty) notes.push('작업 트리에 커밋하지 않은 변경이 있다 — 맥락에 넣지 않았다')

  const prRef = prInfo ? { number: prInfo.number, url: prInfo.url } : pr != null ? { number: pr, url: null } : null
  return { version: 1, generatedAt: now.toISOString(), scope: { ...scope, pr: prRef }, files: files.map(slim), intent, history, impact, skipped, notes }
}
