/**
 * 끝내기 전 검사 보고 — 에이전트가 사용자에게 붙일 글. 실행한 명령·종료 코드·결과 수를 그대로 보인다(금지선 done/*).
 * 무엇을 돌리지 않았는지(건너뜀)와 범위(관련 테스트만·전체)를 함께 적어, 일부만 돌리고 전체가 통과한 것처럼 말하지 않게 한다.
 */

const SOURCE = {
  detected: '프로젝트 파일 감지',
  config: '설정(.agents/gimi.json의 finishCheck.commands)',
  harness: 'guksu-harness verifier 설정',
}
const SCOPE = { related: '관련 테스트만', all: '전체', module: '모듈', config: '설정대로', harness: '설정대로' }
const LABEL = { pass: '통과      ', fail: '실패      ', timeout: '시간 초과  ' }
const FAIL_TAIL = 5
const SLOP_LABEL = { error: 'error     ', warn: 'warn      ' }
// warn은 이만큼만 글로 쓴다 — 나머지는 --json으로 본다. error는 모두 쓴다
const MAX_WARN_ROWS = 40
const INDENT = '          '

const seconds = (ms) => `${(ms / 1000).toFixed(1)}초`

const countsText = (counts) => (counts ? ` · 통과 ${counts.passed} · 실패 ${counts.failed} · 건너뜀 ${counts.skipped}${counts.unit === '패키지' ? '(패키지)' : ''}` : '')

const detailOf = (run) => {
  if (run.status === 'timeout') return `${seconds(run.durationMs)}에서 멈춤`
  if (run.status === 'pass') return `${seconds(run.durationMs)}${countsText(run.counts)}`
  return `${seconds(run.durationMs)} · 종료 코드 ${run.exitCode ?? '없음'}${countsText(run.counts)}`
}

const where = (cwd) => (cwd ? `[${cwd}] ` : '')

/** 같은 파일의 같은 지적(같은 ID·내용)을 첫 줄로 묶는다 */
const groupFindings = (findings) => {
  const groups = new Map()
  for (const finding of findings) {
    const key = `${finding.id}\0${finding.path}\0${finding.message}\0${finding.note ?? ''}`
    const group = groups.get(key)
    if (group) group.more += 1
    else groups.set(key, { ...finding, more: 0 })
  }
  return [...groups.values()]
}

const slopRows = (slop) => {
  const { test, code, snapshot } = slop.checked
  const total = test + code + snapshot
  if (total === 0) return ['슬롭 검사  바뀐 JS·TS 파일 없음']
  const parts = [['테스트', test], ['코드', code], ['스냅샷', snapshot]].filter(([, n]) => n > 0).map(([label, n]) => `${label} ${n}`)
  const errors = slop.findings.filter((f) => f.severity === 'error')
  const warns = slop.findings.filter((f) => f.severity !== 'error')
  const tally = slop.findings.length + slop.ignored.length === 0 ? '지적 없음' : `error ${errors.length} · warn ${warns.length} · 무시 ${slop.ignored.length}`
  const rows = [`슬롭 검사  바뀐 파일 ${total}개(${parts.join(' · ')}) — ${tally}`]
  const row = (f) => {
    rows.push(`${SLOP_LABEL[f.severity] ?? SLOP_LABEL.warn}${f.id}  ${f.path}:${f.line}${f.more > 0 ? ` 외 ${f.more}곳` : ''}  ${f.message}`)
    if (f.note) rows.push(`${INDENT}${f.note}`)
  }
  groupFindings(errors).forEach(row)
  const warnRows = groupFindings(warns)
  warnRows.slice(0, MAX_WARN_ROWS).forEach(row)
  if (warnRows.length > MAX_WARN_ROWS) rows.push(`${INDENT}warn ${warnRows.length - MAX_WARN_ROWS}줄 더 — --json으로 모두 본다`)
  for (const f of slop.ignored) rows.push(`무시      ${f.id}  ${f.path}:${f.line} — ${f.reason}`)
  return rows
}

/** @param {{ report: any }} args @returns {string} */
export const renderCheckReport = ({ report }) => {
  const { scope, runs, skipped } = report
  const from = (source) => scope.files.filter((file) => file.sources.includes(source)).length
  const parts = [['커밋', from('commit')], ['작업 트리', from('worktree')], ['새 파일', from('untracked')]].filter(([, n]) => n > 0).map(([label, n]) => `${label} ${n}`)
  const rows = [
    `끝내기 전 검사  바뀐 파일 ${scope.files.length}개${parts.length > 0 ? `(${parts.join(' · ')})` : ''} — 기준 ${scope.baseRef}, 갈림점 ${scope.mergeBase.slice(0, 7)}`,
    `명령 출처  ${SOURCE[report.source] ?? report.source}${report.source === 'harness' ? `(${report.harnessPath ?? '.agents/hooks/verifierGate.config.json'})` : ''}`,
  ]
  for (const run of runs) {
    rows.push(`${LABEL[run.status]}${run.name}(${SCOPE[run.scope] ?? run.scope})  ${where(run.cwd)}${run.command}  (${detailOf(run)})`)
    if (run.status !== 'pass') for (const line of run.outputTail.slice(-FAIL_TAIL)) rows.push(`${INDENT}${line}`)
    const base = run.baseline
    if (!base) continue
    // 기준에서 돌렸으면 결과를, 돌리지 않았으면(볼 파일 없음·준비 실패) 이유만 쓴다
    rows.push(base.status ? `기준      ${base.message}  (${detailOf(base)})` : `기준      ${base.message}`)
    if (base.status && base.status !== 'pass') for (const line of base.outputTail.slice(-FAIL_TAIL)) rows.push(`${INDENT}${line}`)
  }
  if (report.baseline) {
    if (!runs.some((run) => run.baseline)) rows.push(`기준      실패한 명령이 없어 기준(갈림점 ${report.baseline.mergeBase.slice(0, 7)})에서 돌리지 않았다`)
    else if (report.baseline.dependenciesChanged) rows.push('기준      의존성 파일(package.json·잠금 파일)이 바뀌었다 — 기준도 지금의 node_modules로 돌렸다')
  }
  for (const skip of skipped) rows.push(`건너뜀    ${where(skip.cwd)}${skip.name} — ${skip.reason}`)
  const { slop } = report
  if (slop) rows.push(...slopRows(slop))

  const tally = (status) => runs.filter((run) => run.status === status).length
  const slopErrors = slop ? slop.findings.filter((f) => f.severity === 'error').length : 0
  const slopTally = slop && slop.findings.length > 0 ? ` · 슬롭 error ${slopErrors} · warn ${slop.findings.length - slopErrors}` : ''
  rows.push(runs.length === 0 ? `결과      돌린 명령 없음 · 건너뜀 ${skipped.length}${slopTally}` : `결과      통과 ${tally('pass')} · 실패 ${tally('fail')} · 시간 초과 ${tally('timeout')} · 건너뜀 ${skipped.length}${slopTally}`)
  const advice = [
    '실행한 명령·종료 코드·결과 수를 그대로 붙인다.',
    '건너뛴 검사는 이유와 함께 적는다.',
    runs.some((run) => run.baseline) ? '실패를 "원래 있던 실패"라고 하려면 기준 줄을 그대로 붙인다.' : '실패를 "원래 있던 실패"라고 하려면 --baseline으로 기준(갈림점)에서 같은 명령을 돌려 본다.',
  ]
  if (slopErrors > 0) advice.push('슬롭 error는 고친 뒤 다시 돌린다.')
  if (slop && slop.findings.some((f) => f.severity !== 'error')) advice.push('슬롭 warn은 고치거나, 그대로 두면 이유를 적는다.')
  if (slop && slop.findings.some((f) => f.disclose)) advice.push('건너뛰게 한 테스트·바꾼 기대값·갱신한 스냅샷은 이유와 함께 밝힌다.')
  rows.push(`보고      ${advice.join(' ')}`)
  return `${rows.join('\n')}\n`
}
