/**
 * PR의 CI 결과(설계 결정 60) — 체크마다 이름·워크플로·결과·이벤트·링크와 GitHub Actions 실행·작업 번호만 모은다.
 * 로그는 모으지 않는다(에이전트가 작업 번호로 필요할 때 연다).
 * 테스트를 직접 돌리지 않고(PR 코드를 실행하게 된다 — 결정 20), CI가 이미 돌린 결과를 근거로 빌려 온다.
 * 체크 이름·워크플로는 PR이 바꾼 워크플로 파일이 정할 수 있어, 줄을 나누거나 방향을 바꾸는 문자를 없애고 짧게 자른다.
 * 번호는 PR과 같은 저장소의 Actions 링크에서만 읽는다 — 이름에 적은 가짜 링크나 외부 CI 링크로 엉뚱한 로그를 열지 않게.
 */
import { attempt } from './exec.mjs'
import { oneLine } from './text.mjs'

const FIELDS = 'name,workflow,bucket,state,event,link'
// 먼저 볼 것부터 — 실패·취소·진행 중·통과·생략
export const BUCKETS = ['fail', 'cancel', 'pending', 'pass', 'skipping']
// 모르는 결과는 진행 중 다음에 둔다 — 끝났다고 볼 수 없다
const order = (bucket) => (bucket === 'unknown' ? BUCKETS.indexOf('pending') + 0.5 : BUCKETS.indexOf(bucket))
const ACTIONS_PATH = /^\/([^/]+)\/([^/]+)\/actions\/runs\/(\d+)(?:\/job\/(\d+))?\/?$/

/** 링크는 URL로 읽어 https만 정규화해 남긴다. 실행·작업 번호는 PR과 같은 호스트·저장소의 Actions 링크일 때만 */
const readLink = (link, prUrl) => {
  const url = typeof link === 'string' ? attempt(() => new URL(link)) : null
  if (!url || url.protocol !== 'https:') return { link: null, runId: null, jobId: null }
  const pr = typeof prUrl === 'string' ? attempt(() => new URL(prUrl)) : null
  const [owner, repo] = pr ? pr.pathname.split('/').filter(Boolean) : []
  const match = url.pathname.match(ACTIONS_PATH)
  const same = Boolean(pr && match && url.host === pr.host && match[1].toLowerCase() === owner?.toLowerCase() && match[2].toLowerCase() === repo?.toLowerCase())
  return { link: url.href, runId: same ? match[3] : null, jobId: same ? (match[4] ?? null) : null }
}

// --json이면 gh 2.96은 체크가 실패하거나 진행 중이어도 0으로 끝난다. --json 없이는 1(실패)·8(진행 중)로 끝나므로,
// 다른 판에 대비해 0이 아닌 종료 코드여도 표준 출력이 있으면 읽는다
const run = (gh, args) => {
  try {
    return gh(args)
  } catch (error) {
    if (typeof error?.stdout === 'string' && error.stdout.trim()) return error.stdout
    throw error
  }
}

const skip = (reason) => ({ checks: null, skipped: [{ context: 'CI', reason }] })

/**
 * @param {{ gh: ((args: string[]) => string) | null, prInfo: { number: number, url?: string } | null, pr?: number | null }} args
 *   gh가 null이면 gh를 쓰지 않는다. pr은 사용자가 준 PR 번호(열지 못했으면 prInfo가 null)
 * @returns {{ checks: { name: string, workflow: string, bucket: string, state: string, event: string, link: string | null, runId: string | null, jobId: string | null }[] | null, skipped: { context: 'CI', reason: string }[] }}
 *   checks가 null이면 건너뛰었다(이유는 skipped), []이면 체크가 없는 PR이다(CI가 아직 시작하지 않았을 수도 있다)
 */
export const collectChecks = ({ gh, prInfo, pr = null }) => {
  if (!gh) return skip('gh가 없거나 쓰지 않아 CI 결과를 읽지 않았다')
  if (!prInfo) return skip(pr == null ? 'PR을 찾지 못해 CI 결과를 읽지 않았다(PR이 없는 브랜치 리뷰거나 gh가 PR을 열지 못했다)' : `PR #${pr}을(를) 열지 못해 CI 결과를 읽지 않았다`)
  const unread = `PR #${prInfo.number}의 CI 결과를 읽지 못했다`
  let text
  try {
    text = run(gh, ['pr', 'checks', String(prInfo.number), '--json', FIELDS])
  } catch (error) {
    // 체크가 하나도 없는 PR — gh가 오류로 알린다. 건너뜀이 아니라 없음이다
    if (/no checks reported/i.test(String(error?.stderr ?? ''))) return { checks: [], skipped: [] }
    return skip(unread)
  }
  const parsed = attempt(() => JSON.parse(text))
  if (!Array.isArray(parsed)) return skip(unread)
  const checks = parsed
    .map((check) => ({
      name: oneLine(check?.name),
      workflow: oneLine(check?.workflow),
      bucket: BUCKETS.includes(check?.bucket) ? check.bucket : 'unknown',
      state: oneLine(check?.state),
      event: oneLine(check?.event),
      ...readLink(check?.link, prInfo.url),
    }))
    .sort((a, b) => order(a.bucket) - order(b.bucket))
  return { checks, skipped: [] }
}
