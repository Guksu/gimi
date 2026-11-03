/**
 * PR의 CI 결과(설계 결정 60) — 체크마다 이름·워크플로·결과·링크만 모은다. 로그는 모으지 않는다(에이전트가 필요할 때 연다).
 * 테스트를 직접 돌리지 않고(PR 코드를 실행하게 된다 — 결정 20), CI가 이미 돌린 결과를 근거로 빌려 온다.
 * 체크 이름·워크플로는 PR이 바꾼 워크플로 파일이 정할 수 있어, 줄바꿈을 없애고 짧게 자른다.
 */
import { attempt } from './exec.mjs'

const FIELDS = 'name,workflow,bucket,state,link'
// 먼저 볼 것부터 — 실패·취소·진행 중·통과·생략
export const BUCKETS = ['fail', 'cancel', 'pending', 'pass', 'skipping']
// 모르는 결과는 진행 중 다음에 둔다 — 끝났다고 볼 수 없다
const order = (bucket) => (bucket === 'unknown' ? BUCKETS.indexOf('pending') + 0.5 : BUCKETS.indexOf(bucket))
const MAX_TEXT = 120

const clean = (text) => {
  const one = String(text ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
  return one.length > MAX_TEXT ? `${one.slice(0, MAX_TEXT)}…` : one
}

// gh pr checks는 체크가 실패하거나(1) 아직 돌면(8) 0이 아닌 종료 코드로 끝나도 표준 출력에 결과를 낸다
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
 * @param {{ gh: ((args: string[]) => string) | null, prInfo: { number: number } | null, pr?: number | null }} args
 *   gh가 null이면 gh를 쓰지 않는다. pr은 사용자가 준 PR 번호(열지 못했으면 prInfo가 null)
 * @returns {{ checks: { name: string, workflow: string, bucket: string, state: string, link: string | null }[] | null, skipped: { context: 'CI', reason: string }[] }}
 *   checks가 null이면 건너뛰었다(이유는 skipped), []이면 체크가 없는 PR이다
 */
export const collectChecks = ({ gh, prInfo, pr = null }) => {
  if (!gh) return skip('gh가 없거나 쓰지 않아 CI 결과를 읽지 않았다')
  if (!prInfo) return skip(pr == null ? 'PR이 없어 CI 결과를 읽지 않았다(브랜치 리뷰)' : `PR #${pr}을(를) 열지 못해 CI 결과를 읽지 않았다`)
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
      name: clean(check?.name),
      workflow: clean(check?.workflow),
      bucket: BUCKETS.includes(check?.bucket) ? check.bucket : 'unknown',
      state: clean(check?.state),
      link: typeof check?.link === 'string' && check.link.startsWith('https://') ? check.link : null,
    }))
    .sort((a, b) => order(a.bucket) - order(b.bucket))
  return { checks, skipped: [] }
}
