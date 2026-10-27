/**
 * 리뷰 품질 평가(설계 결정 15)의 채점 — 결함 PR마다 리뷰어의 지적을 정답(defect.json findings)과 맞춰 본다.
 * 리뷰어는 출력 끝에 지적마다 `FINDING <단계> <경로>:<줄> <요약>`을 적는다(두 리뷰어에 같은 지시). 지적이 없으면 `FINDING 없음`.
 * 내장 /code-review는 이 지시 대신 자기 JSON 지적 목록을 내므로, FINDING 줄이 없으면 그 목록을 읽는다.
 * 정답 줄(범위) ±3이나 정답의 근거 위치에서 지적하면 찾은 것이다. 결함 없는 PR(clean)의 지적은 오탐이다.
 * gimi는 맥락 묶음(context.mjs)을 쓰므로, 놓친 정답을 "수집 실패"(근거가 묶음에 없음)와 "판단 실패"(있는데 못 봄)로 나눈다.
 * 정답 밖 지적과 오탐은 PR diff와 견줘 바뀐 조각(±3)·바뀐 파일의 조각 밖·바뀌지 않은 파일로 나눠 센다.
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

/** 코드 블록 본문 — 여는 줄(```언어)과 닫는 줄(```)을 줄 단위로 짝짓는다 */
const codeBlocks = (text) => {
  const blocks = []
  let open = null
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (open === null) {
      if (/^\s*```[\w-]*\s*$/.test(line)) open = []
    } else if (/^\s*```\s*$/.test(line)) {
      blocks.push(open.join('\n'))
      open = null
    } else open.push(line)
  }
  return blocks
}

/** 내장 /code-review의 지적 목록 — 코드 블록 안의 JSON 배열([{ file, line, summary }]). 단계가 없다 */
const jsonFindings = (text, root) => {
  for (const body of codeBlocks(text)) {
    let list
    try {
      list = JSON.parse(body)
    } catch {
      continue
    }
    if (!Array.isArray(list) || !list.every((item) => typeof item?.file === 'string' && Number.isInteger(item?.line))) continue
    return list.map((item) => ({ level: null, path: normalizePath(item.file, root), line: item.line, endLine: Number.isInteger(item.endLine) ? item.endLine : item.line, summary: String(item.summary ?? '').trim() }))
  }
  return null
}

/**
 * 리뷰 출력에서 FINDING 줄을 읽는다. FINDING 줄이 없으면 내장 /code-review의 JSON 지적 목록을 읽는다(그 형식을 고집해 덧붙인 지시를 따르지 않는다)
 * @param {string} text @param {{ root?: string }} options root — 평가용 저장소의 절대 경로(지적에 붙어 오면 뗀다)
 * @returns {{ declared: boolean, findings: { level: string | null, path: string, line: number, endLine: number, summary: string }[] }}
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
  if (declared) return { declared, findings }
  const listed = jsonFindings(text, root)
  return listed ? { declared: true, findings: listed } : { declared: false, findings: [] }
}

export const LOCATIONS = { hunk: '바뀐 조각', file: '바뀐 파일', outside: '바뀌지 않은 파일' }

/**
 * PR diff의 새 줄 범위 — 파일마다 조각. 지운 파일은 뺀다. 지우기만 한 조각은 그 자리 한 줄로 둔다
 * @param {string} patch @returns {{ path: string, from: number, to: number }[]}
 */
export const hunksOf = (patch) => {
  const out = []
  let file = null
  for (const line of patch.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.startsWith('diff --git ')) {
      file = null
      continue
    }
    const plus = line.match(/^\+\+\+ (?:b\/(.+)|\/dev\/null)$/)
    if (plus) {
      file = plus[1] ?? null
      continue
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/)
    if (!hunk || !file) continue
    const from = Number(hunk[1])
    const count = hunk[2] === undefined ? 1 : Number(hunk[2])
    out.push({ path: file, from: Math.max(from, 1), to: Math.max(from + count - 1, from, 1) })
  }
  return out
}

/** 지적이 PR diff의 어디에 있나 — hunk(바뀐 조각 ±tolerance)·file(바뀐 파일의 조각 밖)·outside(바뀌지 않은 파일) */
export const locateFinding = ({ finding, hunks, tolerance = TOLERANCE }) => {
  if (hunks.some((hunk) => overlaps(finding, hunk, tolerance))) return 'hunk'
  return hunks.some((hunk) => hunk.path === finding.path) ? 'file' : 'outside'
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

/** 맥락 묶음의 영향 범위에서 위치를 담은 곳 — 사용처(중첩된 {path, line} 전부) */
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
 * @returns {{ answer: number, kind: 'location' | 'commit', what: string, covered: boolean, where: '바뀐 조각' | '영향 범위' | '바뀐 파일' | '이력' | null }[]}
 */
export const coverageOf = ({ bundle, defect, tolerance = TOLERANCE }) => {
  const hunks = (bundle.files ?? []).flatMap((file) => (file.hunks ?? []).map((hunk) => ({ path: file.newPath ?? file.path, from: hunk.newStart, to: hunk.newStart + Math.max(hunk.newLines, 1) - 1 })))
  const changedFiles = new Set((bundle.files ?? []).map((file) => file.newPath ?? file.path))
  const usages = usagesIn(bundle.impact ?? {})
  const subjects = Object.values(bundle.history?.commits ?? {}).map((commit) => commit.subject ?? '')
  const locate = ({ path, line, endLine }) => {
    const span = { path, line, endLine: endLine ?? line }
    if (hunks.some((hunk) => overlaps(span, hunk, tolerance))) return '바뀐 조각'
    if (usages.some((usage) => overlaps(span, { path: usage.path, from: usage.line, to: usage.line }, tolerance))) return '영향 범위'
    // 바뀐 파일의 조각 밖 — 묶음이 파일을 가리키고, 리뷰어가 그 파일을 열면 보인다
    if (changedFiles.has(path)) return '바뀐 파일'
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
    // 위치로 나누기 — 이 리뷰어의 실행 모두에 diff 조각이 있을 때만
    const located = mine.every((run) => Array.isArray(run.hunks))
    const tally = (pairs) => {
      const out = { hunk: 0, file: 0, outside: 0 }
      for (const { finding, hunks } of pairs) out[locateFinding({ finding, hunks })] += 1
      return out
    }
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
      // 단계가 없는 지적(JSON 목록)이 섞이면 "고쳐야 함"을 셀 수 없다
      blockingFalsePositives: falseFindings.some((finding) => finding.level === null) ? null : falseFindings.filter((finding) => finding.level === '고쳐야 함').length,
      noFormat: mine.filter((run) => !run.declared).length,
      extraAt: located ? tally(defectRuns.flatMap((run) => run.extra.map((finding) => ({ finding, hunks: run.hunks })))) : null,
      falseAt: located ? tally(cleanRuns.flatMap((run) => run.findings.map((finding) => ({ finding, hunks: run.hunks })))) : null,
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

const byLocation = (total, at) => (at ? `${total} — ${at.hunk} · ${at.file} · ${at.outside}` : '-')

/** 채점표 — 리뷰어마다 한 줄, (diff 조각이 있으면) 지적의 위치, 결함마다 한 줄 */
export const formatScore = ({ reviewers, perDefect }) =>
  [
    '| 리뷰어 | 실행 | 찾음 | 수집 실패 | 판단 실패 | 정답 밖 지적 | 오탐(결함 없는 PR) | 형식 어김 |',
    '|---|---|---|---|---|---|---|---|',
    ...reviewers.map((r) => `| ${r.name} | ${r.runs} | ${r.found}/${r.answers} (${percent(r.foundRate)}) | ${dash(r.collectMiss)} | ${dash(r.judgeMiss)} | ${r.extra} | ${r.falsePositives} (고쳐야 함 ${dash(r.blockingFalsePositives)}) | ${r.noFormat} |`),
    ...(reviewers.some((r) => r.extraAt)
      ? [
          '',
          `| 리뷰어 | 정답 밖 지적 — ${Object.values(LOCATIONS).join(' · ')} | 오탐 — ${Object.values(LOCATIONS).join(' · ')} |`,
          '|---|---|---|',
          ...reviewers.map((r) => `| ${r.name} | ${byLocation(r.extra, r.extraAt)} | ${byLocation(r.falsePositives, r.falseAt)} |`),
        ]
      : []),
    '',
    '| 결함 | 맥락 | 찾음 |',
    '|---|---|---|',
    ...perDefect.map((d) => `| ${d.id} | ${d.context} | ${d.text} |`),
  ].join('\n')
