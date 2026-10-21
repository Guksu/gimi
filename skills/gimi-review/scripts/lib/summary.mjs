/**
 * 맥락 묶음 요약 — 에이전트가 먼저 읽는 짧은 글. 전체는 JSON 파일에 있고, 요약은 줄 수 상한을 지킨다(설계 결정 19).
 * 순서: 범위 → 바뀐 파일 → 의도 → 이력 → 영향 범위 → 건너뜀 → 참고 → 전체 경로
 */

const STATUS = { added: 'A', deleted: 'D', modified: 'M', renamed: 'R' }
const TAG_LABEL = { fix: '수정', revert: '되돌리기', hotfix: '긴급', workaround: '우회' }
const CHANGE_LABEL = { signature: '시그니처 변경', removed: '삭제', body: '본문만 변경' }
const CHANGE_ORDER = { signature: 0, removed: 1, body: 2 }
const MAX_FILES = 30
const MAX_COMMITS = 10
const MAX_USAGES = 10

const capped = ({ rows, max, unit }) => (rows.length > max ? [...rows.slice(0, max), `  … 외 ${rows.length - max}${unit}`] : rows)

const fileRow = (file) => {
  const path = file.status === 'renamed' ? `${file.oldPath} → ${file.newPath}` : (file.newPath ?? file.oldPath)
  const counts = file.binary ? '(바이너리)' : `+${file.additions} −${file.deletions}`
  return `  ${STATUS[file.status] ?? '?'} ${path}  ${counts}`
}

const intentRows = (intent) => {
  const parts = []
  if (intent.pr) parts.push(`PR #${intent.pr.number} "${intent.pr.title}"`)
  for (const issue of intent.issues ?? []) parts.push(`이슈 #${issue.number} "${issue.title}"`)
  for (const number of intent.unreadIssues ?? []) parts.push(`이슈 #${number}(읽지 못함)`)
  for (const ticket of intent.tickets ?? []) parts.push(`${ticket.id}(${ticket.source === 'unknown' ? '출처 모름' : ticket.source} — 에이전트가 읽음)`)
  if ((intent.links ?? []).length > 0) parts.push(`링크 ${intent.links.length}개(${[...new Set(intent.links.map((link) => link.source))].join('·')} — 에이전트가 읽음)`)
  return [`의도    ${parts.join(' / ') || '없음'}`, `        브랜치 ${intent.branch ?? '(분리된 HEAD)'}, 커밋 ${intent.commits.length}`]
}

const commitRow = ({ commit, paths }) => {
  const tags = commit.tags.length > 0 ? ` [${commit.tags.map((tag) => TAG_LABEL[tag]).join('·')}]` : ''
  return `    ${commit.short} ${commit.subject}${tags} — ${paths.join(', ')}`
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
  if (symbols.length === 0 && literals.length === 0) return [`영향 범위  바뀐 export·문자열 없음${added.length > 0 ? ` / 새 export ${added.length}개` : ''}`]
  // 머리의 방법은 심볼마다 실제로 쓴 것을 센다 — TypeScript를 불러왔어도 tsconfig 밖이나 지운 export는 문자열로 찾는다
  const byTs = symbols.filter((symbol) => symbol.method === 'typescript').length
  const byText = symbols.length - byTs
  const method =
    impact.method === 'text' || byTs === 0 ? '문자열 검색' : byText === 0 ? 'TypeScript 참조' : `TypeScript 참조 ${byTs} · 문자열 검색 ${byText}`
  const rows = [`영향 범위  바뀐 export ${symbols.length}개(${method}) / 바뀐 문자열 ${literals.length}개 / 새 export ${added.length}개`]
  // 시그니처 변경·삭제가 먼저다 — 쓰는 쪽이 깨질 수 있다. 같은 종류 안에서는 이 변경에서 안 바뀐 사용처가 많은 것부터
  const ordered = [...symbols].sort((a, b) => CHANGE_ORDER[a.change] - CHANGE_ORDER[b.change] || b.unchanged - a.unchanged)
  for (const symbol of ordered) {
    const marker = symbol.method === 'text' && impact.method === 'typescript'
    rows.push(`  ${symbol.name} (${CHANGE_LABEL[symbol.change]}) — ${symbol.path}  ${usageSummary({ item: symbol, marker })}`, ...usageRows(symbol))
  }
  for (const literal of literals) rows.push(`  "${literal.value}" (바뀐 문자열) — ${literal.path}  ${usageSummary({ item: literal, marker: false })}`, ...usageRows(literal))
  return rows
}

const impactNotes = (impact) => {
  if (!impact) return []
  const fallback = impact.method === 'text' ? [`영향 범위는 문자열 검색으로 찾았다(정확도 낮음) — ${impact.reason}`] : []
  return [...fallback, ...impact.notes]
}

/**
 * @param {{ context: any, outPath: string | null, maxLines?: number }} args
 * @returns {string}
 */
export const renderSummary = ({ context, outPath, maxLines = 300 }) => {
  const { scope, files, intent, history } = context
  const rows = [`범위    ${scope.baseRef}...${scope.branch ?? scope.head.slice(0, 7)} (갈림점 ${scope.mergeBase.slice(0, 7)}, 커밋 ${scope.commitCount}, 파일 ${files.length})`]
  rows.push('바뀐 파일', ...(files.length > 0 ? capped({ rows: files.map(fileRow), max: MAX_FILES, unit: '개' }) : ['  없음']))
  rows.push(...intentRows(intent))
  if (history) rows.push(...historyRows(history))
  if (context.impact) rows.push(...impactRows(context.impact))
  rows.push(...(context.skipped.length > 0 ? context.skipped.map((skip) => `건너뜀  ${skip.context} — ${skip.reason}`) : ['건너뜀  없음']))
  for (const note of [...context.notes, ...(history?.notes ?? []), ...impactNotes(context.impact)]) rows.push(`참고    ${note}`)
  const last = `전체    ${outPath ?? '(JSON을 표준 출력으로 냈다)'}`

  // 상한을 넘으면 중간을 줄인다 — 마지막 줄(전체 경로)은 남겨 JSON을 열 수 있게 한다
  const body = rows.length + 1 > maxLines ? [...rows.slice(0, maxLines - 2), `… 외 ${rows.length - (maxLines - 2)}줄 — 전체는 JSON에 있다`] : rows
  return `${[...body, last].join('\n')}\n`
}
