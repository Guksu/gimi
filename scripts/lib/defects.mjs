/**
 * 예제 저장소의 결함 PR(설계 결정 15·41) — evals/shop-fixture/defects/{ID}/에 change.patch와 defect.json을 둔다.
 * 패치는 정상 버전(예제 저장소에서 defects/를 뺀 것)에 붙이는 diff다. defect.json은 어긴 규칙·맥락 종류·PR 제목과 본문,
 * 정답(단계 + file:line, 범위면 endLine까지 + 근거 위치), 결함을 잡는 테스트를 적는다. 경로는 모두 예제 저장소 루트 기준이다.
 * 이력 결함은 history(예전 커밋 — 메시지와 history/ 아래의 패치)를 더해, 평가용 저장소의 main에 그 커밋들을 쌓는다.
 * 근거(evidence)는 위치(path·line)나 이력 커밋(commit — history의 메시지 앞부분)이다.
 * 파일 읽기·git·테스트 실행은 scripts/defects.mjs가 맡고, 여기에는 판단만 둔다.
 */

export const CONTEXTS = ['영향 범위', '의도', '이력', '슬롭', '도메인 규칙']
export const LAYERS = ['프론트', '백엔드', '둘 다']
export const LEVELS = ['고쳐야 함', '고치면 좋음', '확인 질문']
// 이 맥락의 결함은 어긴 규칙이 있다 — 영향 범위·의도·이력은 규칙 없이 맥락만으로도 결함이다
const NEEDS_RULE = new Set(['슬롭', '도메인 규칙'])
const ID = /^[A-Za-z0-9][A-Za-z0-9-]*$/

const isText = (value) => typeof value === 'string' && value.trim() !== ''

/** 위치 하나(path + line)가 그 버전에 있는지 */
const locationErrors = (label, location, linesOf) => {
  if (!isText(location?.path)) return [`${label}: path가 없다`]
  if (!Number.isInteger(location.line) || location.line < 1) return [`${label}: ${location.path}의 line은 1 이상의 정수다`]
  const total = linesOf(location.path)
  if (total === null) return [`${label}: ${location.path} — 결함 버전에 없다`]
  if (location.line > total) return [`${label}: ${location.path}:${location.line} — 파일 길이(${total}줄)를 넘는다`]
  if (location.endLine === undefined) return []
  if (!Number.isInteger(location.endLine) || location.endLine < location.line) return [`${label}: endLine은 line(${location.line}) 이상의 정수다`]
  if (location.endLine > total) return [`${label}: ${location.path}:${location.endLine} — 파일 길이(${total}줄)를 넘는다`]
  return []
}

/** 근거가 이력 커밋이면 — history의 커밋 메시지 앞부분이어야 한다(평가용 저장소의 main에 그 커밋이 있다) */
const commitEvidenceErrors = (label, commit, history) => {
  if (!isText(commit)) return [`${label}: 커밋(commit)이 비었다 — history의 커밋 메시지 앞부분을 적는다`]
  const messages = Array.isArray(history) ? history.map((entry) => entry?.message).filter(isText) : []
  return messages.some((message) => message.startsWith(commit)) ? [] : [`${label}: ${commit} — history에 없다`]
}

/** 근거가 이슈면 — issues에 그 번호가 있어야 한다(평가 도구의 가짜 gh가 그 이슈를 돌려준다) */
const issueEvidenceErrors = (label, number, issues) => {
  const numbers = Array.isArray(issues) ? issues.map((issue) => issue?.number) : []
  return Number.isInteger(number) && numbers.includes(number) ? [] : [`${label}: 이슈 #${number} — issues에 없다`]
}

/**
 * defect.json 하나 — 오류 문장 목록(없으면 빈 배열)
 * @param {{ dir: string, json: any, ruleIds: Set<string>, patchedLines: (path: string) => number | null, baseLines: (path: string) => number | null, touched: string[] }} args
 *   폴더 이름, defect.json 내용, 아는 규칙 ID, 결함 버전·정상 버전의 파일 줄 수(없으면 null), 패치가 고치는 파일
 */
export const validateDefect = ({ dir, json, ruleIds, patchedLines, baseLines, touched }) => {
  const errors = []
  if (!isText(json?.id) || !ID.test(json.id)) errors.push(`id는 영문·숫자·하이픈이다: ${json?.id}`)
  else if (json.id !== dir) errors.push(`폴더 이름(${dir})과 id(${json.id})가 다르다`)

  const rules = Array.isArray(json?.rules) ? json.rules : null
  if (!rules) errors.push('rules는 규칙 ID 목록이다')
  else {
    for (const rule of rules) if (!ruleIds.has(rule)) errors.push(`모르는 규칙: ${rule}`)
    if (rules.length === 0 && NEEDS_RULE.has(json.context)) errors.push(`${json.context} 결함은 어긴 규칙을 하나 이상 적는다`)
  }
  if (!CONTEXTS.includes(json?.context)) errors.push(`맥락 종류는 ${CONTEXTS.join('·')} 중 하나다: ${json?.context}`)
  if (!LAYERS.includes(json?.layer)) errors.push(`층은 ${LAYERS.join('·')} 중 하나다: ${json?.layer}`)
  if (!isText(json?.pr?.title)) errors.push('PR 제목(pr.title)이 없다')
  if (!isText(json?.pr?.body)) errors.push('PR 본문(pr.body)이 없다')

  const findings = Array.isArray(json?.findings) ? json.findings : []
  if (json?.clean === true) {
    if (findings.length > 0) errors.push('결함이 없는 PR(clean)에는 정답을 두지 않는다')
  } else if (findings.length === 0) errors.push('정답이 없다 — 결함이 없는 PR이면 clean: true로 적는다')
  findings.forEach((finding, index) => {
    const label = `정답 ${index + 1}`
    if (!LEVELS.includes(finding?.level)) errors.push(`${label}: 단계는 ${LEVELS.join('·')} 중 하나다: ${finding?.level}`)
    if (!isText(finding?.summary)) errors.push(`${label}: 설명(summary)이 없다`)
    errors.push(...locationErrors(label, finding, patchedLines))
    ;(finding?.evidence ?? []).forEach((evidence, n) => {
      const evidenceLabel = `${label} 근거 ${n + 1}`
      if (evidence && typeof evidence === 'object' && 'commit' in evidence) errors.push(...commitEvidenceErrors(evidenceLabel, evidence.commit, json?.history))
      else if (evidence && typeof evidence === 'object' && 'issue' in evidence) errors.push(...issueEvidenceErrors(evidenceLabel, evidence.issue, json?.issues))
      else errors.push(...locationErrors(evidenceLabel, evidence, patchedLines))
    })
  })

  // 이력 — 평가용 저장소의 main에 쌓을 예전 커밋. 패치는 그 커밋 앞의 상태 → 뒤의 상태이고, 마지막 커밋 뒤가 정상 버전이다
  if (json?.history !== undefined) {
    if (!Array.isArray(json.history) || json.history.length === 0) errors.push('history는 예전 커밋 목록이다 — 이력이 없으면 history를 뺀다')
    else
      json.history.forEach((commit, index) => {
        const label = `history ${index + 1}`
        if (!isText(commit?.message)) errors.push(`${label}: 커밋 메시지(message)가 없다`)
        if (!isText(commit?.patch)) errors.push(`${label}: 패치 파일(patch)이 없다`)
        else if (!/^history\/[\w.-]+\.patch$/.test(commit.patch)) errors.push(`${label}: patch는 history/ 아래의 .patch 파일이다 — ${commit.patch}`)
      })
  }

  // 이슈 — 평가 도구의 가짜 gh가 돌려줄 GitHub 이슈. 요구사항이 PR 본문이 아니라 이슈에만 있는 결함에 쓴다
  if (json?.issues !== undefined) {
    if (!Array.isArray(json.issues) || json.issues.length === 0) errors.push('issues는 이슈 목록이다 — 이슈가 없으면 issues를 뺀다')
    else {
      const seen = new Set()
      json.issues.forEach((issue, index) => {
        const label = `이슈 ${index + 1}`
        if (!Number.isInteger(issue?.number) || issue.number < 1) errors.push(`${label}: 번호(number)는 1 이상의 정수다`)
        else if (seen.has(issue.number)) errors.push(`${label}: #${issue.number} — 번호가 겹친다`)
        else seen.add(issue.number)
        if (!isText(issue?.title)) errors.push(`${label}: 제목(title)이 없다`)
        if (!isText(issue?.body)) errors.push(`${label}: 본문(body)이 없다`)
      })
    }
  }

  const catches = Array.isArray(json?.catches) ? json.catches : []
  if (json?.clean === true && catches.length > 0) errors.push('결함이 없는 PR에는 잡는 테스트를 두지 않는다')
  for (const path of catches) {
    if (baseLines(path) === null) errors.push(`잡는 테스트가 정상 버전에 없다: ${path}`)
    else if (touched.includes(path)) errors.push(`잡는 테스트 ${path} — 패치가 고친다. 결함 버전에서 다른 테스트를 돌리게 된다`)
  }
  return errors
}

/** 패치가 고치는 파일 — 고친 파일, 새 파일, 지운 파일, 이름을 바꾼 파일의 옛 이름과 새 이름 */
export const patchedPaths = (patch) => {
  const paths = []
  const add = (path) => {
    if (path && !paths.includes(path)) paths.push(path)
  }
  for (const line of patch.replace(/\r\n?/g, '\n').split('\n')) {
    const header = line.match(/^(?:---|\+\+\+) [ab]\/(.+?)\t?$/)
    if (header) add(header[1])
    const rename = line.match(/^rename (?:from|to) (.+)$/)
    if (rename) add(rename[1])
  }
  return paths
}

/**
 * 잡는 테스트를 정상 버전과 결함 버전에서 돌린다 — 정상에서 통과하고 결함에서 실패해야 결함을 잡는 것이다.
 * 경로의 첫 마디가 워크스페이스(server·web·fake-pg)다. 그 폴더에서 그 파일만 돌린다. 정상에서 실패하면 결함 버전은 돌리지 않는다.
 * @param {{ base: string, patched: string, catches: string[], run: (args: { cwd: string, file: string }) => Promise<number> }} args run은 종료 코드를 돌려준다
 */
export const runCatches = async ({ base, patched, catches, run }) => {
  const results = []
  for (const path of catches) {
    const [workspace, ...rest] = path.split('/')
    const file = rest.join('/')
    const baseCode = await run({ cwd: `${base}/${workspace}`, file })
    if (baseCode !== 0) {
      results.push({ path, base: baseCode, patched: null, ok: false, error: `잡는 테스트 ${path} — 정상 버전에서 실패한다(종료 코드 ${baseCode}). 앱이나 테스트가 먼저 틀렸다` })
      continue
    }
    const patchedCode = await run({ cwd: `${patched}/${workspace}`, file })
    if (patchedCode === 0) results.push({ path, base: 0, patched: 0, ok: false, error: `잡는 테스트 ${path} — 결함 버전에서도 통과한다. 결함을 잡지 못한다` })
    else results.push({ path, base: 0, patched: patchedCode, ok: true })
  }
  return results
}

/**
 * 검사 결과 보고 — 맨 위에 결함 수와 문제 수, 결함마다 한 줄(층 · 맥락 · 정답 수 · 잡는 테스트), 문제는 그 아래에 적는다
 * @param {{ id: string, defect: any, errors: string[], catches: { ok: boolean }[] | null }[]} results catches가 null이면 돌리지 않았다
 * @param {{ tests: boolean }} options
 */
export const formatCheck = (results, { tests }) => {
  const problems = results.reduce((sum, result) => sum + result.errors.length, 0)
  const width = Math.max(...results.map((result) => result.id.length))
  const lines = [`결함 PR ${results.length}개 — ${problems === 0 ? '문제 없음' : `문제 ${problems}개`}`]
  for (const { id, defect, errors, catches } of results) {
    const parts = []
    if (defect) {
      parts.push(defect.layer, defect.context)
      parts.push(defect.clean === true ? '결함 없음' : `정답 ${defect.findings?.length ?? 0}`)
      const passed = (catches ?? []).filter((result) => result.ok).length
      if (catches && passed > 0) parts.push(`잡는 테스트 ${passed}개(정상 통과, 결함 실패)`)
    }
    lines.push(parts.length > 0 ? `  ${id.padEnd(width)}  ${parts.join(' · ')}` : `  ${id}`)
    for (const error of errors) lines.push(`    ✗ ${error}`)
  }
  if (!tests) lines.push('잡는 테스트는 돌리지 않았다(--no-tests)')
  return lines.join('\n')
}
