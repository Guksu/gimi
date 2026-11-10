/**
 * 맥락 묶음 요약 — 에이전트가 먼저 읽는 짧은 글. 전체는 JSON 파일에 있고, 요약은 줄 수 상한을 지킨다(설계 결정 19).
 * 순서: 범위 → 바뀐 파일 → 의도 → CI → 이력 → 영향 범위 → 건너뜀 → 참고 → 전체 경로
 */
import { oneLine, safeLine } from './text.mjs'

const STATUS = { added: 'A', deleted: 'D', modified: 'M', renamed: 'R' }
const TAG_LABEL = { fix: '수정', revert: '되돌리기', hotfix: '긴급', workaround: '우회' }
const CHANGE_LABEL = { signature: '시그니처 변경', removed: '삭제', body: '본문만 변경' }
const CHANGE_ORDER = { signature: 0, removed: 1, body: 2, wraps: 3 }
const MAX_FILES = 30
const MAX_COMMITS = 10
const MAX_USAGES = 10
const MAX_CHECKS = 10
const MAX_PRIORITY = 10
const MAX_PRIOR = 10
const BUCKET_LABEL = { fail: '실패', cancel: '취소', pending: '진행 중', unknown: '알 수 없음', pass: '통과', skipping: '생략' }

const capped = ({ rows, max, unit }) => (rows.length > max ? [...rows.slice(0, max), `  … 외 ${rows.length - max}${unit}`] : rows)

const fileRow = (file) => {
  const path = file.status === 'renamed' ? `${file.oldPath} → ${file.newPath}` : (file.newPath ?? file.oldPath)
  const counts = file.binary ? '(바이너리)' : `+${file.additions} −${file.deletions}`
  return `  ${STATUS[file.status] ?? '?'} ${path}  ${counts}${file.untracked ? '  (추적하지 않는 새 파일)' : ''}`
}

const MAX_INTENT_COMMITS = 5

// PR이 없으면 커밋 메시지가 의도의 출처다 — 주장(리팩터링만·동작 그대로 등)을 맞춰 볼 수 있게 제목을 보인다. 본문은 JSON에 있다.
// 의도가 담긴 첫 커밋이 리뷰 반영 커밋들 뒤에 숨지 않게 오래된 것부터 보인다(git log는 최근 것이 앞). prUnread면 PR을 읽지 못한 것이다
const intentRows = (intent, { prUnread = false } = {}) => {
  const parts = []
  const commits = [...(intent.commits ?? [])].reverse()
  if (intent.pr) parts.push(`PR #${intent.pr.number} "${oneLine(intent.pr.title)}"`)
  else if (commits.length > 0) parts.push(`커밋 메시지 ${commits.length}개(${prUnread ? 'PR을 읽지 못함' : 'PR 없음'}, 오래된 것부터)`)
  for (const issue of intent.issues ?? []) parts.push(`이슈 #${issue.number} "${oneLine(issue.title)}"`)
  for (const number of intent.unreadIssues ?? []) parts.push(`이슈 #${number}(읽지 못함)`)
  for (const ticket of intent.tickets ?? []) parts.push(`${ticket.id}(${ticket.source === 'unknown' ? '출처 모름' : ticket.source} — 에이전트가 읽음)`)
  if ((intent.links ?? []).length > 0) parts.push(`링크 ${intent.links.length}개(${[...new Set(intent.links.map((link) => link.source))].join('·')} — 에이전트가 읽음)`)
  const rows = [`의도    ${parts.join(' / ') || '없음'}`, `        브랜치 ${intent.branch ?? '(분리된 HEAD)'}, 커밋 ${commits.length}`]
  if (intent.pr) {
    rows.push(intent.pr.body?.trim() ? '        PR 본문은 JSON의 intent.pr.body에 있다' : '        PR 본문 없음')
  } else if (commits.length > 0) {
    const commitRows = commits.map((commit) => `        ${commit.sha.slice(0, 7)} ${oneLine(commit.subject) || '(제목 없음)'}${commit.body ? ' [본문 있음]' : ''}`)
    rows.push(...(commitRows.length > MAX_INTENT_COMMITS ? [...commitRows.slice(0, MAX_INTENT_COMMITS), `        … 외 ${commitRows.length - MAX_INTENT_COMMITS}개`] : commitRows))
    if (commits.some((commit) => commit.body)) rows.push('        커밋 본문은 JSON의 intent.commits에 있다')
  }
  return rows
}

// 결과마다 보통 상태 — 다르면(승인 대기·시간 초과 등) 함께 적는다
const USUAL_STATE = { fail: ['FAILURE'], cancel: ['CANCELLED'], pending: ['PENDING', 'IN_PROGRESS', 'QUEUED', 'REQUESTED', 'WAITING'] }

// 믿을 수 있는 것(결과·작업 번호)을 PR이 정할 수 있는 이름보다 앞에 둔다. 번호가 없는 체크(외부 CI)만 링크를 끝에 붙인다
const checkRow = (check) => {
  const label = !check.state || USUAL_STATE[check.bucket]?.includes(check.state) ? BUCKET_LABEL[check.bucket] : `${BUCKET_LABEL[check.bucket]} — ${check.state}`
  const id = check.jobId ? `작업 ${check.jobId}` : check.runId ? `실행 ${check.runId}` : '번호 없음'
  const link = !check.runId && check.link ? `  ${check.link}` : ''
  return `  [${label}] ${id} · ${check.workflow ? `${check.workflow} / ` : ''}${check.name}${link}`
}

// CI — 결과마다 수를 세고, 볼 것(실패·취소·진행 중·알 수 없음)만 줄로 보인다. 건너뛰었으면(null) 건너뜀에 이유가 있다
const ciRows = (checks) => {
  if (checks == null) return []
  if (checks.length === 0) return ['CI      체크 없음']
  const rank = Object.keys(BUCKET_LABEL)
  const counts = rank
    .map((bucket) => [bucket, checks.filter((check) => check.bucket === bucket).length])
    .filter(([, count]) => count > 0)
    .map(([bucket, count]) => `${BUCKET_LABEL[bucket]} ${count}`)
  const open = checks.filter((check) => !['pass', 'skipping'].includes(check.bucket)).sort((a, b) => rank.indexOf(a.bucket) - rank.indexOf(b.bucket))
  return [`CI      ${counts.join(' · ')}`, ...capped({ rows: open.map(checkRow), max: MAX_CHECKS, unit: '개' })]
}

const commitRow = ({ commit, paths }) => {
  const tags = commit.tags.length > 0 ? ` [${commit.tags.map((tag) => TAG_LABEL[tag]).join('·')}]` : ''
  return `    ${commit.short} ${oneLine(commit.subject)}${tags} — ${paths.join(', ')}`
}

const historyRows = (history) => {
  const changed = history.files.reduce((sum, file) => sum + file.changedOldLines, 0)
  if (changed === 0) return ['이력    바뀌거나 지운 옛 줄 없음(더하기만 한 변경)']
  const blamedPaths = new Map()
  for (const file of history.files) for (const { sha } of file.blamed) blamedPaths.set(sha, [...(blamedPaths.get(sha) ?? []), file.newPath ?? file.path])
  const recentPaths = new Map()
  for (const file of history.files) for (const sha of file.recent) if (!blamedPaths.has(sha)) recentPaths.set(sha, [...(recentPaths.get(sha) ?? []), file.newPath ?? file.path])

  // 수정·되돌리기 표시가 있는 커밋부터 — 새 변경이 예전 수정을 건드렸는지가 가장 먼저 볼 것이다. 서식 정리 커밋은 뺀다
  const ordered = (paths) =>
    [...paths]
      .map(([sha, list]) => ({ commit: history.commits[sha], paths: list }))
      .filter(({ commit }) => commit && !commit.formatting)
      .sort((a, b) => Number(b.commit.tags.length > 0) - Number(a.commit.tags.length > 0))
  const blamed = ordered(blamedPaths)
  const recentFlagged = ordered(recentPaths).filter(({ commit }) => commit.tags.length > 0)

  const rows = [`이력    바뀌거나 지운 줄 ${changed} → 커밋 ${blamedPaths.size}개 / 파일마다 최근 커밋 ${history.recentCommits}개`]
  if (blamed.length > 0) rows.push('  바뀐 줄을 넣은 커밋', ...capped({ rows: blamed.map(commitRow), max: MAX_COMMITS, unit: '개' }))
  if (recentFlagged.length > 0) rows.push('  같은 파일의 최근 수정·되돌리기 커밋', ...capped({ rows: recentFlagged.map(commitRow), max: MAX_COMMITS, unit: '개' }))
  return rows
}

// 요약에는 diff 밖(이 변경에서 안 바뀐) 사용처만 줄로 보인다 — 함께 바뀐 곳은 diff에서 이미 보이므로 수로 묶는다
const usageRows = (item) => {
  const rows = item.usages
    .filter((usage) => !usage.changedInPr)
    .slice(0, MAX_USAGES)
    .map((usage) => `    ${usage.path}:${usage.line}`)
  const moreUnchanged = item.unchanged - rows.length
  if (moreUnchanged > 0) rows.push(`    … 안 바뀐 곳 ${moreUnchanged}곳 더 — JSON에 있다`)
  const changed = item.total - item.unchanged
  if (changed > 0) rows.push(`    이 변경에서 함께 바뀐 곳 ${changed}곳 — diff에서 본다`)
  return rows
}

const usageSummary = ({ item, marker }) => {
  if (item.searched === false) return '사용처를 찾지 않음(이름 없는 default export)'
  if (item.total === 0) return '사용처 없음'
  return `사용처 ${item.total}(이 변경에서 안 바뀜 ${item.unchanged}${marker ? ' · 문자열 검색' : ''})`
}

const impactRows = (impact) => {
  const { symbols, literals, added } = impact
  const fields = impact.fields ?? []
  if (symbols.length === 0 && literals.length === 0 && fields.length === 0) return [`영향 범위  바뀐 export·문자열 없음${added.length > 0 ? ` / 새 export ${added.length}개` : ''}`]
  // 감싼 export는 바뀐 export가 아니다 — 머리에서 따로 센다
  const changedSymbols = symbols.filter((symbol) => symbol.change !== 'wraps')
  const wrappers = symbols.length - changedSymbols.length
  // 머리의 방법은 심볼마다 실제로 쓴 것을 센다 — TypeScript를 불러왔어도 tsconfig 밖이나 지운 export는 문자열로 찾는다
  const byTs = changedSymbols.filter((symbol) => symbol.method === 'typescript').length
  const byText = changedSymbols.length - byTs
  const method =
    impact.method === 'text' || byTs === 0 ? '문자열 검색' : byText === 0 ? 'TypeScript 참조' : `TypeScript 참조 ${byTs} · 문자열 검색 ${byText}`
  const extra = [wrappers > 0 ? ` / 감싼 export ${wrappers}개` : '', fields.length > 0 ? ` / 지운 필드 ${fields.length}개` : ''].join('')
  const rows = [`영향 범위  바뀐 export ${changedSymbols.length}개(${method}) / 바뀐 문자열 ${literals.length}개 / 새 export ${added.length}개${extra}`]
  // 시그니처 변경·삭제가 먼저다 — 쓰는 쪽이 깨질 수 있다. 같은 종류 안에서는 이 변경에서 안 바뀐 사용처가 많은 것부터
  const ordered = [...symbols].sort((a, b) => CHANGE_ORDER[a.change] - CHANGE_ORDER[b.change] || b.unchanged - a.unchanged)
  for (const symbol of ordered) {
    const marker = symbol.method === 'text' && impact.method === 'typescript'
    const label = symbol.change === 'wraps' ? `감싼 export — ${symbol.through} 호출` : CHANGE_LABEL[symbol.change]
    rows.push(`  ${symbol.name} (${label}) — ${symbol.path}  ${usageSummary({ item: symbol, marker })}`, ...usageRows(symbol))
  }
  for (const literal of literals) rows.push(`  "${literal.value}" (바뀐 문자열) — ${literal.path}  ${usageSummary({ item: literal, marker: false })}`, ...usageRows(literal))
  for (const field of fields) rows.push(`  ${field.name} (지운 필드 · 문자열 검색) — ${field.path}  ${usageSummary({ item: field, marker: false })}`, ...usageRows(field))
  return rows
}

const LEVEL_LABEL = { breaking: '깨질 수 있음', caution: '확인', additive: '추가' }
const PARSER_LABEL = { json: 'JSON', yaml: 'yaml 패키지', 'js-yaml': 'js-yaml', 내장: '내장 YAML 파서' }
const METHOD_LABEL = { text: '경로 문자열 검색', 'typescript+text': 'TypeScript 참조 + 경로 문자열 검색' }
const MAX_CONTRACT_CHANGES = 15

const contractUsage = (change, graphql) => {
  if (!change.searched) return ''
  const unit = graphql ? '연산' : '사용처'
  if (change.total === 0) return `  ${unit} 없음`
  const how = graphql ? '' : ` · ${METHOD_LABEL[change.method] ?? change.method}`
  const linked = (change.linked ?? []).map((repo) => ` · [${repo.repo}] ${repo.total}`).join('')
  return `  ${unit} ${change.total}(이 변경에서 안 바뀜 ${change.unchanged}${how}${linked})`
}

const contractRows = (contracts) => {
  if (!contracts || contracts.length === 0) return []
  const all = contracts.flatMap((c) => c.changes)
  const count = (level) => all.filter((c) => c.level === level).length
  const rows = [`계약      바뀐 계약 ${contracts.length}개 — 깨질 수 있음 ${count('breaking')} · 확인 ${count('caution')} · 추가 ${count('additive')}`]
  for (const contract of contracts) {
    const graphql = contract.kind === 'graphql'
    const kind = graphql ? 'GraphQL' : `OpenAPI · ${PARSER_LABEL[contract.parser] ?? contract.parser}`
    rows.push(`  ${contract.path} (${kind}) — 바뀐 것 ${contract.changes.length}`)
    for (const change of contract.changes.slice(0, MAX_CONTRACT_CHANGES)) {
      const endpoints = change.target === 'schema' && change.endpoints?.length > 0 ? ` / 엔드포인트 ${change.endpoints[0]}${change.endpoints.length > 1 ? ` 외 ${change.endpoints.length - 1}` : ''}` : ''
      rows.push(`    ${change.key}  ${LEVEL_LABEL[change.level]} — ${change.details.join(' / ')}${endpoints}${contractUsage(change, graphql)}`)
      if (!change.searched || change.total === 0) continue
      // 저장소마다 따로 보인다 — 리뷰하는 저장소의 사용처가 많아도 함께 보는 저장소의 것이 가려지지 않게
      const linkedUnchanged = (change.linked ?? []).reduce((sum, repo) => sum + repo.unchanged, 0)
      const groups = [{ repo: null, unchanged: change.unchanged - linkedUnchanged }, ...(change.linked ?? [])]
      for (const group of groups) {
        const shown = change.usages.filter((usage) => !usage.changedInPr && (usage.repo ?? null) === group.repo).slice(0, MAX_USAGES)
        const tag = group.repo ? `[${group.repo}] ` : ''
        for (const usage of shown) rows.push(`      ${tag}${usage.path}:${usage.line}${usage.operation ? `  ${usage.operation} › ${usage.fieldPath}` : ''}`)
        if (group.unchanged > shown.length) rows.push(`      … ${tag}안 바뀐 곳 ${group.unchanged - shown.length}곳 더 — JSON에 있다`)
      }
      if (change.total > change.unchanged) rows.push(`      이 변경에서 함께 바뀐 곳 ${change.total - change.unchanged}곳 — diff에서 본다`)
    }
    if (contract.changes.length > MAX_CONTRACT_CHANGES) rows.push(`    … 외 ${contract.changes.length - MAX_CONTRACT_CHANGES}개 — JSON에 있다`)
  }
  return rows
}

const impactNotes = (impact) => {
  if (!impact) return []
  const fallback = impact.method === 'text' ? [`영향 범위는 문자열 검색으로 찾았다(정확도 낮음) — ${impact.reason}`] : []
  return [...fallback, ...impact.notes]
}

/**
 * 큰 변경에서 먼저 볼 것(설계 결정 71) — 바뀐 파일이 요약 상한을 넘을 때만 보인다.
 * 순서: 깨질 수 있는 계약 → 안 바뀐 사용처가 남은 시그니처 변경·삭제(안 바뀐 사용처가 많은 순) → 수정·되돌리기 커밋이 넣은 줄을 바꾼 파일
 * @param {any} context @returns {string[]}
 */
export const priorityRows = (context) => {
  const { files, impact, history } = context
  if (files.length <= MAX_FILES) return []
  const rows = []
  for (const contract of impact?.contracts ?? []) {
    for (const change of contract.changes) {
      if (change.level === 'breaking') rows.push(`  계약 ${contract.path} — ${change.key} (깨질 수 있음${change.unchanged > 0 ? ` · 안 바뀐 사용처 ${change.unchanged}` : ''})`)
    }
  }
  const risky = (impact?.symbols ?? []).filter((symbol) => (symbol.change === 'signature' || symbol.change === 'removed') && symbol.unchanged > 0)
  for (const symbol of risky.sort((a, b) => b.unchanged - a.unchanged)) rows.push(`  ${symbol.name} (${CHANGE_LABEL[symbol.change]}) — ${symbol.path} · 안 바뀐 사용처 ${symbol.unchanged}`)
  for (const file of history?.files ?? []) {
    for (const { sha } of file.blamed) {
      const commit = history.commits[sha]
      if (commit && !commit.formatting && commit.tags.length > 0) rows.push(`  이력 ${file.newPath ?? file.path} — ${commit.short} ${oneLine(commit.subject)} [${commit.tags.map((tag) => TAG_LABEL[tag]).join('·')}]`)
    }
  }
  const head = `먼저 볼 것  바뀐 파일 ${files.length}개 — 요약 상한(${MAX_FILES}개)을 넘었다.`
  if (rows.length === 0) return [`${head} 위험 신호(깨질 수 있는 계약·안 바뀐 사용처가 남은 시그니처 변경과 삭제·수정 커밋에 닿은 줄)는 없다 — 바뀐 줄이 많은 파일부터 본다`]
  return [`${head} 아래 순서로 보고, 다 보지 못한 파일은 리뷰 기록에 적는다`, ...capped({ rows, max: MAX_PRIORITY, unit: '개 — 아래 영향 범위·계약·이력에 있다' })]
}

// 지난 리뷰 기록(설계 결정 72) — 지적마다 고쳐졌는지 확인하게 번호·머리·판정을 보인다
const priorRows = (prior) => {
  if (!prior) return []
  const counts = ['맞음', '틀림', '의도함', '미정'].map((verdict) => [verdict, prior.findings.filter((finding) => finding.verdict === verdict).length]).filter(([, count]) => count > 0)
  const tally = prior.findings.length > 0 ? `지적 ${prior.findings.length}(${counts.map(([verdict, count]) => `${verdict} ${count}`).join(' · ')})` : '지적 없음'
  const malformed = prior.malformed > 0 ? ` · 형식이 다른 지적 머리 ${prior.malformed}개는 직접 연다` : ''
  return [`지난 리뷰  ${prior.path} — ${tally}${malformed}`, ...capped({ rows: prior.findings.map((finding) => `  ${finding.index}. ${finding.heading} (${finding.verdict})`), max: MAX_PRIOR, unit: '개 — 기록 파일에 있다' })]
}

/**
 * @param {{ context: any, outPath: string | null, notWritten?: boolean, maxLines?: number }} args notWritten이면 전체를 어디에도 쓰지 않았다
 * @returns {string}
 */
export const renderSummary = ({ context, outPath, notWritten = false, maxLines = 300 }) => {
  const { scope, files, intent, history } = context
  const rows = [`범위    ${scope.baseRef}...${scope.branch ?? scope.head.slice(0, 7)} (갈림점 ${scope.mergeBase.slice(0, 7)}, 커밋 ${scope.commitCount}${scope.worktree && scope.dirty ? ' + 커밋하지 않은 변경' : ''}, 파일 ${files.length})`]
  rows.push(...priorityRows(context))
  rows.push('바뀐 파일', ...(files.length > 0 ? capped({ rows: files.map(fileRow), max: MAX_FILES, unit: '개' }) : ['  없음']))
  rows.push(...intentRows(intent, { prUnread: context.skipped.some((skip) => skip.context === '의도') }))
  rows.push(...ciRows(context.checks))
  if (history) rows.push(...historyRows(history))
  if (context.impact) rows.push(...impactRows(context.impact), ...contractRows(context.impact.contracts))
  rows.push(...priorRows(context.prior))
  rows.push(...(context.skipped.length > 0 ? context.skipped.map((skip) => `건너뜀  ${skip.context} — ${skip.reason}`) : ['건너뜀  없음']))
  for (const note of [...context.notes, ...(history?.notes ?? []), ...impactNotes(context.impact)]) rows.push(`참고    ${note}`)
  const last = `전체    ${notWritten ? '쓰지 않았다 — --out <경로>나 --json으로 다시 돌린다' : (outPath ?? '(JSON을 표준 출력으로 냈다)')}`

  // 상한을 넘으면 중간을 줄인다 — 마지막 줄(전체 경로)은 남겨 JSON을 열 수 있게 한다
  const body = rows.length + 1 > maxLines ? [...rows.slice(0, maxLines - 2), `… 외 ${rows.length - (maxLines - 2)}줄 — 전체는 JSON에 있다`] : rows
  // PR·커밋·경로·티켓 번호처럼 PR이 정할 수 있는 글이 어느 줄에 들어가도 줄을 나누지 못하게, 줄마다 한 번 더 거른다
  return `${[...body, last].map(safeLine).join('\n')}\n`
}
