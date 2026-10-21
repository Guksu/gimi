/**
 * 끝내기 전 검사 보고 — 에이전트가 사용자에게 붙일 글. 실행한 명령·종료 코드·결과 수를 그대로 보인다(금지선 done/*).
 * 무엇을 돌리지 않았는지(건너뜀)와 범위(관련 테스트만·전체)를 함께 적어, 일부만 돌리고 전체가 통과한 것처럼 말하지 않게 한다.
 */

const SOURCE = {
  detected: '프로젝트 파일 감지',
  config: '설정(.agents/gimi.json의 finishCheck.commands)',
  harness: 'guksu-harness verifier 설정(.agents/hooks/verifierGate.config.json)',
}
const SCOPE = { related: '관련 테스트만', all: '전체', module: '모듈', config: '설정대로', harness: '설정대로' }
const LABEL = { pass: '통과      ', fail: '실패      ', timeout: '시간 초과  ' }
const FAIL_TAIL = 5

const seconds = (ms) => `${(ms / 1000).toFixed(1)}초`

const countsText = (counts) => (counts ? ` · 통과 ${counts.passed} · 실패 ${counts.failed} · 건너뜀 ${counts.skipped}${counts.unit === '패키지' ? '(패키지)' : ''}` : '')

const detailOf = (run) => {
  if (run.status === 'timeout') return `${seconds(run.durationMs)}에서 멈춤`
  if (run.status === 'pass') return `${seconds(run.durationMs)}${countsText(run.counts)}`
  return `${seconds(run.durationMs)} · 종료 코드 ${run.exitCode ?? '없음'}${countsText(run.counts)}`
}

const where = (cwd) => (cwd ? `[${cwd}] ` : '')

/** @param {{ report: any }} args @returns {string} */
export const renderCheckReport = ({ report }) => {
  const { scope, runs, skipped } = report
  const from = (source) => scope.files.filter((file) => file.sources.includes(source)).length
  const parts = [['커밋', from('commit')], ['작업 트리', from('worktree')], ['새 파일', from('untracked')]].filter(([, n]) => n > 0).map(([label, n]) => `${label} ${n}`)
  const rows = [
    `끝내기 전 검사  바뀐 파일 ${scope.files.length}개${parts.length > 0 ? `(${parts.join(' · ')})` : ''} — 기준 ${scope.baseRef}, 갈림점 ${scope.mergeBase.slice(0, 7)}`,
    `명령 출처  ${SOURCE[report.source] ?? report.source}`,
  ]
  for (const run of runs) {
    rows.push(`${LABEL[run.status]}${run.name}(${SCOPE[run.scope] ?? run.scope})  ${where(run.cwd)}${run.command}  (${detailOf(run)})`)
    if (run.status !== 'pass') for (const line of run.outputTail.slice(-FAIL_TAIL)) rows.push(`          ${line}`)
  }
  for (const skip of skipped) rows.push(`건너뜀    ${where(skip.cwd)}${skip.name} — ${skip.reason}`)

  const tally = (status) => runs.filter((run) => run.status === status).length
  rows.push(runs.length === 0 ? `결과      돌린 명령 없음 · 건너뜀 ${skipped.length}` : `결과      통과 ${tally('pass')} · 실패 ${tally('fail')} · 시간 초과 ${tally('timeout')} · 건너뜀 ${skipped.length}`)
  rows.push('보고      실행한 명령·종료 코드·결과 수를 그대로 붙인다. 건너뛴 검사는 이유와 함께 적는다. 실패를 "원래 있던 실패"라고 하려면 기본 브랜치에서 같은 명령을 돌려 본다.')
  return `${rows.join('\n')}\n`
}
