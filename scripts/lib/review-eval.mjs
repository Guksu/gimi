/**
 * 리뷰 품질 평가(설계 결정 15)의 채점 — 결함 PR마다 리뷰어의 지적을 정답(defect.json findings)과 맞춰 본다.
 * 리뷰어는 출력 끝에 지적마다 `FINDING <단계> <경로>:<줄> <요약>`을 적는다(두 리뷰어에 같은 지시). 지적이 없으면 `FINDING 없음`.
 * 정답 줄(범위) ±3이나 정답의 근거 위치에서 지적하면 찾은 것이다. 결함 없는 PR(clean)의 지적은 오탐이다.
 * gimi는 맥락 묶음(context.mjs)을 쓰므로, 놓친 정답을 "수집 실패"(근거가 묶음에 없음)와 "판단 실패"(있는데 못 봄)로 나눈다.
 * 실행(모델 부르기·파일)은 scripts/review-eval.mjs가 맡는다.
 */

export const TOLERANCE = 3
export const LEVELS = ['고쳐야 함', '고치면 좋음', '확인 질문']
// 맥락 묶음을 쓰는 리뷰어 — 수집 실패·판단 실패를 나눈다
export const CONTEXT_REVIEWERS = ['gimi']

const FINDING = /^\s*(?:[-*]\s*)?FINDING\s+(.+?)\s+`?([^\s`:]+):(\d+)(?:\s*[-–~]\s*(\d+))?`?(?:\s+(.*))?$/
const NONE = /^\s*(?:[-*]\s*)?FINDING\s+없음\s*$/

const normalizePath = (path, root) => {
  let out = path.trim()
  if (root && out.startsWith(`${root}/`)) out = out.slice(root.length + 1)
  return out.replace(/^\.\//, '')
}

/**
 * 리뷰 출력에서 FINDING 줄을 읽는다
 * @param {string} text @param {{ root?: string }} options root — 평가용 저장소의 절대 경로(지적에 붙어 오면 뗀다)
 * @returns {{ declared: boolean, findings: { level: string, path: string, line: number, endLine: number, summary: string }[] }}
 */
export const parseFindings = (text, { root } = {}) => {
  const findings = []
  let declared = false
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (NONE.test(line)) {
      declared = true
      continue
    }
    const match = line.match(FINDING)
    if (!match) continue
    declared = true
    const start = Number(match[3])
    findings.push({ level: match[1].trim(), path: normalizePath(match[2], root), line: start, endLine: match[4] ? Number(match[4]) : start, summary: (match[5] ?? '').trim() })
  }
  return { declared, findings }
}

/** 정답 하나가 받아 주는 위치 — 정답 줄(범위)과 위치 근거들 */
const targetsOf = (answer) => [
  { path: answer.path, from: answer.line, to: answer.endLine ?? answer.line },
  ...(answer.evidence ?? []).filter((evidence) => typeof evidence?.path === 'string').map((evidence) => ({ path: evidence.path, from: evidence.line, to: evidence.endLine ?? evidence.line })),
]
const overlaps = (finding, target, tolerance) => finding.path === target.path && finding.line <= target.to + tolerance && finding.endLine >= target.from - tolerance

/**
 * 지적을 정답과 맞춘다 — 정답마다 맞는 지적이 있으면 찾은 것이다. 지적 하나는 정답 하나에만 쓴다
 * @param {{ findings: { path: string, line: number, endLine: number }[], answers: any[], tolerance?: number }} args
 */
export const matchFindings = ({ findings, answers, tolerance = TOLERANCE }) => {
  const used = new Set()
  const matched = []
  const missed = []
  answers.forEach((answer, index) => {
    const at = findings.findIndex((finding, i) => !used.has(i) && targetsOf(answer).some((target) => overlaps(finding, target, tolerance)))
    if (at === -1) missed.push({ ...answer, index })
    else {
      used.add(at)
      matched.push({ answer: { ...answer, index }, finding: findings[at] })
    }
  })
  // 이미 찾은 정답을 또 가리키는 지적은 정답 밖으로 세지 않는다(같은 결함을 두 곳에서 말한 것)
  const extra = findings.filter((finding, i) => !used.has(i) && !answers.some((answer) => targetsOf(answer).some((target) => overlaps(finding, target, tolerance))))
  return { matched, missed, extra }
}

/** 맥락 묶음에서 위치를 담은 곳 — 바뀐 조각과 영향 범위의 사용처(중첩된 {path, line} 전부) */
const usagesIn = (value, out = []) => {
  if (Array.isArray(value)) for (const item of value) usagesIn(item, out)
  else if (value && typeof value === 'object') {
    if (typeof value.path === 'string' && Number.isInteger(value.line)) out.push({ path: value.path, line: value.line })
    for (const item of Object.values(value)) if (item && typeof item === 'object') usagesIn(item, out)
  }
  return out
}

/**
 * 결함의 정답·근거가 맥락 묶음에 있는가 — 모델 없이 맥락 수집을 점검한다
 * @param {{ bundle: any, defect: any, tolerance?: number }} args
 * @returns {{ answer: number, kind: 'location' | 'commit', what: string, covered: boolean, where: string | null }[]}
 */
export const coverageOf = ({ bundle, defect, tolerance = TOLERANCE }) => {
  const hunks = (bundle.files ?? []).flatMap((file) => (file.hunks ?? []).map((hunk) => ({ path: file.newPath ?? file.path, from: hunk.newStart, to: hunk.newStart + Math.max(hunk.newLines, 1) - 1 })))
  const usages = usagesIn(bundle.impact ?? {})
  const subjects = Object.values(bundle.history?.commits ?? {}).map((commit) => commit.subject ?? '')
  const locate = ({ path, line, endLine }) => {
    const span = { path, line, endLine: endLine ?? line }
    if (hunks.some((hunk) => overlaps(span, hunk, tolerance))) return '바뀐 조각'
    if (usages.some((usage) => overlaps(span, { path: usage.path, from: usage.line, to: usage.line }, tolerance))) return '영향 범위'
    return null
  }
  return (defect.findings ?? []).flatMap((answer, index) => [answer, ...(answer.evidence ?? [])].map((item) => {
    if (typeof item?.commit === 'string') {
      const covered = subjects.some((subject) => subject.startsWith(item.commit))
      return { answer: index, kind: 'commit', what: item.commit, covered, where: covered ? '이력' : null }
    }
    const where = locate(item)
    return { answer: index, kind: 'location', what: `${item.path}:${item.line}`, covered: where !== null, where }
  }))
}

/**
 * 리뷰어마다 집계한다
 * @param {{ runs: { reviewer: string, id: string, run: number, defect: any, output: string, root?: string }[], coverage?: Record<string, ReturnType<typeof coverageOf>> }} args
 */
export const scoreRuns = ({ runs, coverage = {} }) => {
  const names = [...new Set(runs.map((run) => run.reviewer))]
  const perRun = runs.map((run) => {
    const parsed = parseFindings(run.output, { root: run.root })
    const clean = run.defect.clean === true
    const result = clean ? { matched: [], missed: [], extra: parsed.findings } : matchFindings({ findings: parsed.findings, answers: run.defect.findings ?? [] })
    return { ...run, clean, declared: parsed.declared, findings: parsed.findings, ...result }
  })
  const reviewers = names.map((name) => {
    const mine = perRun.filter((run) => run.reviewer === name)
    const defectRuns = mine.filter((run) => !run.clean)
    const cleanRuns = mine.filter((run) => run.clean)
    const split = CONTEXT_REVIEWERS.includes(name)
    const missed = defectRuns.flatMap((run) => run.missed.map((answer) => ({ id: run.id, answer })))
    const collectMiss = missed.filter(({ id, answer }) => (coverage[id] ?? []).some((item) => item.answer === answer.index && !item.covered)).length
    const answers = defectRuns.reduce((sum, run) => sum + (run.defect.findings ?? []).length, 0)
    const found = defectRuns.reduce((sum, run) => sum + run.matched.length, 0)
    const falseFindings = cleanRuns.flatMap((run) => run.findings)
    return {
      name,
      runs: mine.length,
      answers,
      found,
      foundRate: answers === 0 ? null : found / answers,
      collectMiss: split ? collectMiss : null,
      judgeMiss: split ? missed.length - collectMiss : null,
      extra: defectRuns.reduce((sum, run) => sum + run.extra.length, 0),
      falsePositives: falseFindings.length,
      blockingFalsePositives: falseFindings.filter((finding) => finding.level === '고쳐야 함').length,
      noFormat: mine.filter((run) => !run.declared).length,
    }
  })
  const ids = [...new Set(runs.map((run) => run.id))]
  const perDefect = ids.map((id) => {
    const sample = perRun.find((run) => run.id === id)
    const byReviewer = names
      .map((name) => {
        const mine = perRun.filter((run) => run.id === id && run.reviewer === name)
        if (mine.length === 0) return null
        if (sample.clean) return { name, text: `${name} 지적 ${mine.reduce((sum, run) => sum + run.findings.length, 0)}` }
        return { name, text: `${name} ${mine.reduce((sum, run) => sum + run.matched.length, 0)}/${mine.reduce((sum, run) => sum + (run.defect.findings ?? []).length, 0)}` }
      })
      .filter(Boolean)
    return { id, context: sample.clean ? '결함 없음' : sample.defect.context ?? '', text: byReviewer.map((entry) => entry.text).join(' · ') }
  })
  return { reviewers, perDefect, runs: perRun }
}

const percent = (rate) => (rate === null ? '-' : `${Math.round(rate * 100)}%`)
const dash = (value) => (value === null ? '-' : String(value))

/** 채점표 — 리뷰어마다 한 줄, 결함마다 한 줄 */
export const formatScore = ({ reviewers, perDefect }) =>
  [
    '| 리뷰어 | 실행 | 찾음 | 수집 실패 | 판단 실패 | 정답 밖 지적 | 오탐(결함 없는 PR) | 형식 어김 |',
    '|---|---|---|---|---|---|---|---|',
    ...reviewers.map((r) => `| ${r.name} | ${r.runs} | ${r.found}/${r.answers} (${percent(r.foundRate)}) | ${dash(r.collectMiss)} | ${dash(r.judgeMiss)} | ${r.extra} | ${r.falsePositives} (고쳐야 함 ${r.blockingFalsePositives}) | ${r.noFormat} |`),
    '',
    '| 결함 | 맥락 | 찾음 |',
    '|---|---|---|',
    ...perDefect.map((d) => `| ${d.id} | ${d.context} | ${d.text} |`),
  ].join('\n')
