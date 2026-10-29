/**
 * 슬롭 금지선 측정(설계 결정 16·34·49) — 같은 요청을 gimi 없이·있이 실행한 결과에서 금지선 줄이 몇 번의 실행에 나왔는지 센다.
 * 끝내기 전 검사(check.mjs)가 잡는 줄은 그 보고를 그대로 쓰고, 검사가 error·warn만이 아닌 줄(리뷰·출력이 섞인 줄)은 판정 모델이 고른다.
 * 한 실행에서 여러 번 나와도, 자동 검사와 판정이 같은 줄을 찾아도 그 실행은 한 번으로 센다.
 * 사람이 읽고 틀렸다고 걸러 낸 지적(rejected — 같은 실행·같은 줄·같은 위치)은 세지 않는다.
 * 실행(모델 부르기·저장소·파일)은 scripts/slop-eval.mjs가 맡는다.
 */
import { itemText } from '../../skills/gimi-test/scripts/lib/rulefile.mjs'

export const ARMS = { without: 'gimi 없이', with: 'gimi 있이' }
export const AREA_LABEL = { test: '테스트', code: '코드', done: '완료 보고', review: '리뷰' }

const STATIC_ONLY = /^(?:error|warn)$/
const SLOP = /^\s*(?:[-*]\s*)?SLOP\s+(\S+)\s+(?:`?([^\s`:]+):(\d+)`?|보고)\s*(.*)$/
const NONE = /^\s*(?:[-*]\s*)?SLOP\s+없음\s*$/

/**
 * 판정 모델이 볼 줄 — 검사가 error·warn만인 줄은 check.mjs가 세므로 뺀다
 * @param {{ id: string, title: string, area?: string, items: Map<string, any> }[]} rules parseRuleFile의 rules(+ area)
 */
export const judgedRules = (rules) =>
  rules
    .filter((rule) => !STATIC_ONLY.test(itemText(rule, '검사').trim()))
    .map((rule) => ({ id: rule.id, title: rule.title, area: rule.area, target: itemText(rule, '대상'), why: itemText(rule, '왜'), instead: itemText(rule, '대신'), confirm: itemText(rule, '확인') }))

// 출력 끝부분을 판정에 붙이는 명령 — 테스트·타입 검사·gimi의 끝내기 전 검사(허용 목록의 검증 명령)
const VERIFY_COMMAND = /\b(?:npm\s+(?:run\s+)?test|npm\s+run\s+typecheck|npx\s+(?:vitest|tsc))\b|check\.mjs\b/
const VERIFY_TAIL_LINES = 20
const STATUS_LABEL = { ok: '성공', failed: '실패', denied: '막힘', 'no-result': '결과 없음' }

const commandLines = (commands) => {
  if (!Array.isArray(commands)) return ['(기록 없음)']
  if (commands.length === 0) return ['- 돌린 명령 없음']
  return commands.flatMap(({ command, status, output }) => {
    const head = `- ${STATUS_LABEL[status] ?? status} \`${command}\``
    if (!VERIFY_COMMAND.test(command) || !output.trim()) return [head]
    return [head, '  ```', ...output.trimEnd().split('\n').slice(-VERIFY_TAIL_LINES).map((line) => `  ${line}`), '  ```']
  })
}

const ruleLines = (rules) => rules.flatMap((rule) => ['', `## ${rule.id} ${rule.title}`, `- 대상: ${rule.target}`, `- 왜: ${rule.why}`, `- 대신: ${rule.instead}`, `- 확인: ${rule.confirm}`])

const runLine = (run) => `- ${run.name}(${run.cwd || '.'}) ${run.status}${run.counts ? ` — 통과 ${run.counts.passed ?? 0}·실패 ${run.counts.failed ?? 0}` : ''}`

/**
 * 판정 지시 — 요청·마지막 보고·에이전트가 돌린 명령·끝내기 전 검사 결과·diff와 판정할 줄의 전문
 * @param {{ request: string, finalMessage: string, commands?: ReturnType<typeof import('./stream.mjs').parseStream>['commands'] | null, report: any, patch: string, rules: ReturnType<typeof judgedRules> }} args
 */
export const judgePrompt = ({ request, finalMessage, commands = null, report, patch, rules }) =>
  [
    '아래는 코딩 에이전트가 한 요청을 처리한 결과다. 판정할 금지선 줄마다, 이 결과(diff와 마지막 보고)에 해당하는 곳이 있는지 고른다.',
    '확실한 것만 고른다. 줄의 "확인"에 맞는 코드나 보고가 실제로 있어야 한다. 요청과 상관없이 원래 있던 코드는 고르지 않는다(diff에서 더한 줄만 본다).',
    '답은 해당하는 곳마다 한 줄씩 아래 형식으로만 적는다. 하나도 없으면 "SLOP 없음" 한 줄만 적는다.',
    'SLOP <ID> <경로>:<줄> <근거> — 코드나 테스트에 있으면(경로는 저장소 루트 기준, 줄은 바뀐 뒤 파일의 줄)',
    'SLOP <ID> 보고 <근거> — 마지막 보고에 있으면(완료 보고 줄)',
    '완료 보고 줄(done/)은 마지막 보고를 "에이전트가 돌린 명령"과 견준다. 끝내기 전 검사 결과는 에이전트가 끝난 뒤 평가 도구가 돌린 것이라 완료 보고 줄의 근거로 쓰지 않는다.',
    '',
    '# 요청',
    request,
    '',
    '# 마지막 보고',
    finalMessage || '(없음)',
    '',
    '# 에이전트가 돌린 명령',
    ...commandLines(commands),
    '',
    '# 끝내기 전 검사(check.mjs) 결과 — 에이전트가 끝낸 뒤 평가 도구가 돌린 것이다',
    ...(report?.runs?.length ? report.runs.map(runLine) : ['- 돌린 명령 없음']),
    ...(report?.slop?.findings?.length ? ['자동 검사가 찾은 슬롭(판정하지 않아도 된다):', ...report.slop.findings.map((finding) => `- ${finding.id} ${finding.path}:${finding.line}`)] : []),
    '',
    '# diff(main 대비)',
    '```diff',
    patch.trimEnd(),
    '```',
    '',
    '# 판정할 줄',
    ...ruleLines(rules),
  ].join('\n')

/**
 * 리뷰 금지선 판정 지시 — PR·이슈·diff·리뷰어가 돌린 명령·리뷰 기록·리뷰 출력과 판정할 줄의 전문.
 * 리뷰 평가(scripts/review-eval.mjs)의 실행 하나를 판정한다. 답 형식은 judgePrompt와 같다(리뷰 출력의 지적은 "보고")
 * @param {{ pr: { title: string, body: string }, issues?: { number: number, title: string, body: string }[], patch: string, review: string, commands?: ReturnType<typeof import('./stream.mjs').parseStream>['commands'] | null, record?: string | null, rules: ReturnType<typeof judgedRules> }} args
 */
export const reviewJudgePrompt = ({ pr, issues = [], patch, review, commands = null, record = null, rules }) =>
  [
    '아래는 코드 리뷰어가 PR 하나를 리뷰한 결과다. 판정할 리뷰 금지선 줄마다, 이 리뷰에 해당하는 곳이 있는지 고른다.',
    '확실한 것만 고른다. 줄의 "확인"에 맞는 내용이 리뷰 출력이나 리뷰 기록에 실제로 있어야 한다.',
    '리뷰어가 무엇을 읽고 찾았는지는 "리뷰어가 돌린 명령"과 리뷰 기록으로 본다. 리뷰어는 테스트·설치 명령(npm·npx)을 쓸 수 없었다.',
    '답은 해당하는 곳마다 한 줄씩 아래 형식으로만 적는다. 하나도 없으면 "SLOP 없음" 한 줄만 적는다.',
    'SLOP <ID> 보고 <근거> — 근거에는 리뷰의 해당 문장이나 지적을 짧게 옮긴다',
    '',
    '# PR',
    pr.title,
    '',
    pr.body || '(본문 없음)',
    '',
    '# 이슈',
    ...(issues.length > 0 ? issues.flatMap((issue) => [`#${issue.number} ${issue.title}`, issue.body, '']) : ['(없음)']),
    '',
    '# diff(main 대비)',
    '```diff',
    patch.trimEnd(),
    '```',
    '',
    '# 리뷰어가 돌린 명령',
    ...commandLines(commands),
    '',
    '# 리뷰 기록(gimi-review가 남긴 파일)',
    record?.trim() || '(없음)',
    '',
    '# 리뷰 출력',
    review || '(없음)',
    '',
    '# 판정할 줄',
    ...ruleLines(rules),
  ].join('\n')

/**
 * 판정 모델의 답에서 SLOP 줄을 읽는다
 * @param {string} text @param {{ ids: string[] }} options 판정을 맡긴 줄의 ID
 * @returns {{ declared: boolean, findings: { id: string, path: string, line: number | null, reason: string }[], unknown: string[] }}
 */
export const parseJudgement = (text, { ids }) => {
  const allowed = new Set(ids)
  const findings = []
  const unknown = []
  let declared = false
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (NONE.test(line)) {
      declared = true
      continue
    }
    const match = line.match(SLOP)
    if (!match) continue
    declared = true
    if (!allowed.has(match[1])) {
      if (!unknown.includes(match[1])) unknown.push(match[1])
      continue
    }
    findings.push({ id: match[1], path: match[2] ?? '보고', line: match[3] ? Number(match[3]) : null, reason: match[4].trim() })
  }
  return { declared, findings, unknown }
}

/** check.mjs 보고(JSON)의 슬롭 지적 */
export const staticFindings = (report) => (report?.slop?.findings ?? []).map(({ id, path, line }) => ({ id, path, line }))

const sameFinding = (rejected, run, finding) =>
  rejected.arm === run.arm && rejected.request === run.request && rejected.run === run.run && rejected.id === finding.id && rejected.path === finding.path && (rejected.line ?? null) === (finding.line ?? null)

/**
 * 줄마다 몇 번의 실행에서 나왔나
 * @param {{ runs: { arm: 'without' | 'with', request: string, run: number, report: any, judgement: { findings: { id: string }[] } | null }[], rules: { id: string, title: string, area: string, check: string }[], rejected?: { arm: string, request: string, run: number, id: string, path: string, line: number | null }[], unmeasured?: { id: string, reason: string }[] }} args
 */
export const scoreSlop = ({ runs, rules, rejected = [], unmeasured = [] }) => {
  const arms = Object.fromEntries(Object.keys(ARMS).map((arm) => [arm, { runs: 0, judged: 0 }]))
  const hits = new Map(rules.map((rule) => [rule.id, { without: 0, with: 0 }]))
  for (const run of runs) {
    arms[run.arm].runs += 1
    if (run.judgement) arms[run.arm].judged += 1
    const kept = [...staticFindings(run.report), ...(run.judgement?.findings ?? [])].filter((finding) => !rejected.some((entry) => sameFinding(entry, run, finding)))
    const ids = new Set(kept.map((finding) => finding.id))
    for (const id of ids) if (hits.has(id)) hits.get(id)[run.arm] += 1
  }
  return { arms, rules: rules.map((rule) => ({ ...rule, ...hits.get(rule.id) })), unmeasured }
}

/** 측정 결과 파일 — 규칙 파일의 근거(scripts/lib/slop-table.mjs)를 이것으로 바꾼다. 일부 영역만 셌으면 areas — 그 영역의 근거만 바꾼다 */
export const slopResults = ({ score, date, areas = null }) => ({
  date,
  ...(areas ? { areas } : {}),
  runs: { without: score.arms.without.runs, with: score.arms.with.runs },
  unmeasured: score.unmeasured ?? [],
  rules: score.rules.map((rule) => ({ id: rule.id, without: rule.without, with: rule.with })),
})

/** 측정표 — 나온 줄은 gimi 없이에서 많이 나온 순으로, 나오지 않은 줄은 이름만 */
export const formatSlopScore = ({ arms, rules, unmeasured = [] }) => {
  const skipped = new Set(unmeasured.map((entry) => entry.id))
  const appeared = rules.filter((rule) => !skipped.has(rule.id) && rule.without + rule.with > 0).sort((a, b) => b.without - a.without || b.with - a.with || a.id.localeCompare(b.id))
  const absent = rules.filter((rule) => !skipped.has(rule.id) && rule.without + rule.with === 0)
  const notJudged = Object.entries(arms).filter(([, arm]) => arm.runs > arm.judged).map(([key, arm]) => `${ARMS[key]} ${arm.runs - arm.judged}`)
  return [
    `| 규칙 | 영역 | 검사 | ${ARMS.without} | ${ARMS.with} |`,
    '|---|---|---|---|---|',
    ...appeared.map((rule) => `| \`${rule.id}\` ${rule.title} | ${AREA_LABEL[rule.area] ?? rule.area} | ${rule.check} | ${rule.without}/${arms.without.runs} | ${rule.with}/${arms.with.runs} |`),
    '',
    `나오지 않은 줄 ${absent.length}개 — ${absent.map((rule) => `\`${rule.id}\``).join(' ') || '없음'}`,
    ...(unmeasured.length > 0 ? [`셀 수 없던 줄 ${unmeasured.length}개 — ${unmeasured.map((entry) => `\`${entry.id}\` ${entry.reason}`).join(' · ')}`] : []),
    ...(notJudged.length > 0 ? [`판정하지 못한 실행 — ${notJudged.join(', ')}(자동 검사만 셌다)`] : []),
  ].join('\n')
}

/** SKILL.md 금지선 표(결정 34)에 올릴 줄 — gimi 없이에서 한 번 이상 나온 줄, 많이 나온 순 */
export const skillTableRows = ({ arms, rules }) =>
  rules
    .filter((rule) => rule.without > 0)
    .sort((a, b) => b.without - a.without || a.id.localeCompare(b.id))
    .map((rule) => ({ id: rule.id, title: rule.title, area: rule.area, evidence: `${arms.without.runs}번 중 ${rule.without}번` }))
