/**
 * 예제 저장소의 결함 PR(설계 결정 15·41) — evals/shop-fixture/defects/{ID}/에 change.patch와 defect.json을 둔다.
 * 패치는 정상 버전(예제 저장소에서 defects/를 뺀 것)에 붙이는 diff다. defect.json은 어긴 규칙·맥락 종류·PR 제목과 본문,
 * 정답(단계 + file:line, 범위면 endLine까지 + 근거 위치), 결함을 잡는 테스트를 적는다. 경로는 모두 예제 저장소 루트 기준이다.
 * 이력 결함은 history(예전 커밋 — 메시지와 history/ 아래의 패치)를 더해, 평가용 저장소의 main에 그 커밋들을 쌓는다.
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
    ;(finding?.evidence ?? []).forEach((evidence, n) => errors.push(...locationErrors(`${label} 근거 ${n + 1}`, evidence, patchedLines)))
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

const isSlopAsset = (file) => /\.slop\.test\.tsx?$/.test(file)
const isTestAsset = (file) => /\.test\.tsx?$/.test(file)

/**
 * 패턴 예시 검증 설정(evals/patterns/{패턴}.json) 하나 — 오류 문장 목록. 예시(설계 결정 30)는 검사할 때 정상·결함 버전의 at 자리에
 * 복사해 돌린다. 좋은 예시(*.test.ts(x))는 결함 버전에서 실패해야 하고, 슬롭 예시(*.slop.test.ts(x))는 결함 버전에서도 통과해야 한다.
 * @param {{ file: string, spec: any, assetsOf: (pattern: string) => string[] | null, defectIds: Set<string>, workspaces: string[], baseHas: (path: string) => boolean }} args
 *   설정 파일 경로, 내용, 패턴의 assets/ 파일 이름(패턴이 없으면 null), 있는 결함 ID, 예제 저장소 워크스페이스, 정상 버전에 그 파일이 있는지
 */
export const validatePatternAssets = ({ file, spec, assetsOf, defectIds, workspaces, baseHas }) => {
  const files = assetsOf(spec?.pattern)
  if (files === null) return [`${file}: ${spec?.pattern} — 패턴이 없다(skills/gimi-test/patterns/${spec?.pattern}/PATTERN.md)`]
  const errors = []
  const assets = Array.isArray(spec.assets) ? spec.assets : []
  const ats = new Set()
  assets.forEach((asset, index) => {
    const label = `${file} 예시 ${index + 1}`
    if (!files.includes(asset?.file)) errors.push(`${label}: ${asset?.file} — 패턴의 assets에 없다`)
    if (!isTestAsset(asset?.at ?? '')) errors.push(`${label}: at은 테스트 파일(*.test.ts·*.test.tsx)이다 — ${asset?.at}`)
    else if (!workspaces.includes(asset.at.split('/')[0])) errors.push(`${label}: at(${asset.at})은 워크스페이스(${workspaces.join('·')}) 안이어야 한다`)
    else if (baseHas(asset.at)) errors.push(`${label}: ${asset.at} — 정상 버전에 이미 있다. 앱의 파일을 덮어쓰게 된다`)
    if (ats.has(asset?.at)) errors.push(`${label}: at(${asset.at})이 겹친다`)
    ats.add(asset?.at)
    if (!defectIds.has(asset?.defect)) errors.push(`${label}: ${asset?.defect} — 없는 결함이다(evals/shop-fixture/defects/)`)
  })
  const listed = new Set(assets.map((asset) => asset?.file))
  for (const name of files.filter(isTestAsset)) if (!listed.has(name)) errors.push(`${file}: assets/${name} — 검증하지 않는다. 예시는 모두 결함 버전에서 돌려 본다`)
  if (!assets.some((asset) => isTestAsset(asset?.file ?? '') && !isSlopAsset(asset.file))) errors.push(`${file}: 좋은 예시가 없다`)
  if (!assets.some((asset) => isSlopAsset(asset?.file ?? ''))) errors.push(`${file}: 슬롭 예시가 없다`)
  return errors
}

/** 결함 하나에 돌릴 패턴 예시 — 그 결함을 가리키는 것만, 좋은 예시(good)·슬롭 예시(slop)는 파일 이름으로 가른다 */
export const assetsFor = (specs, defectId) =>
  specs.flatMap((spec) =>
    (spec.assets ?? []).filter((asset) => asset.defect === defectId).map((asset) => ({ pattern: spec.pattern, file: asset.file, at: asset.at, kind: isSlopAsset(asset.file) ? 'slop' : 'good' })),
  )

/**
 * 패턴 예시를 정상·결함 버전에서 돌린다 — 예시는 이미 at 자리에 복사돼 있다.
 * 먼저 정상 버전에서 예시가 든 워크스페이스마다 타입 검사를 한다(사용자가 복사해 쓸 정본이다). 그다음 예시마다 정상 버전에서 통과해야 하고,
 * 결함 버전에서 좋은 예시는 실패·슬롭 예시는 통과해야 한다. 이 표가 깨지면 패턴이 틀린 것이다.
 * @param {{ base: string, patched: string, assets: { pattern: string, file: string, at: string, kind: 'good' | 'slop' }[], run: (args: { cwd: string, file: string }) => Promise<number>, typecheck: (args: { cwd: string }) => Promise<number> }} args
 */
export const runAssets = async ({ base, patched, assets, run, typecheck }) => {
  const results = []
  for (const workspace of [...new Set(assets.map((asset) => asset.at.split('/')[0]))]) {
    const code = await typecheck({ cwd: `${base}/${workspace}` })
    results.push(code === 0 ? { kind: 'typecheck', path: workspace, base: 0, patched: null, ok: true } : { kind: 'typecheck', path: workspace, base: code, patched: null, ok: false, error: `${workspace} 타입 검사가 정상 버전에서 실패한다(종료 코드 ${code}) — 예시의 타입이 틀렸다` })
  }
  for (const asset of assets) {
    const [workspace, ...rest] = asset.at.split('/')
    const file = rest.join('/')
    const name = `${asset.kind === 'good' ? '좋은 예시' : '슬롭 예시'} ${asset.pattern}/${asset.file}`
    const result = { kind: asset.kind, path: asset.at, base: await run({ cwd: `${base}/${workspace}`, file }), patched: null, ok: false }
    if (result.base !== 0) {
      results.push({ ...result, error: `${name} — 정상 버전에서 실패한다(종료 코드 ${result.base}). 예시나 앱이 먼저 틀렸다` })
      continue
    }
    result.patched = await run({ cwd: `${patched}/${workspace}`, file })
    if (asset.kind === 'good' && result.patched === 0) results.push({ ...result, error: `${name} — 결함 버전에서도 통과한다. 결함을 잡지 못하는 예시다` })
    else if (asset.kind === 'slop' && result.patched !== 0) results.push({ ...result, error: `${name} — 결함 버전에서 실패한다. 결함을 잡으니 슬롭이라고 부를 근거가 없다` })
    else results.push({ ...result, ok: true })
  }
  return results
}

/**
 * 검사 결과 보고 — 맨 위에 결함 수와 문제 수, 결함마다 한 줄(층 · 맥락 · 정답 수 · 잡는 테스트 · 패턴 예시), 문제는 그 아래에 적는다.
 * 결함에 묶이지 않은 패턴 예시 설정 오류는 맨 끝에 따로 적는다
 * @param {{ id: string, defect: any, errors: string[], catches: { ok: boolean }[] | null, assets?: { kind: string, ok: boolean }[] | null }[]} results catches·assets가 null이면 돌리지 않았다
 * @param {{ tests: boolean, setupErrors?: string[] }} options
 */
export const formatCheck = (results, { tests, setupErrors = [] }) => {
  const problems = results.reduce((sum, result) => sum + result.errors.length, 0) + setupErrors.length
  const width = Math.max(...results.map((result) => result.id.length))
  const lines = [`결함 PR ${results.length}개 — ${problems === 0 ? '문제 없음' : `문제 ${problems}개`}`]
  for (const { id, defect, errors, catches, assets } of results) {
    const parts = []
    if (defect) {
      parts.push(defect.layer, defect.context)
      parts.push(defect.clean === true ? '결함 없음' : `정답 ${defect.findings?.length ?? 0}`)
      const passed = (catches ?? []).filter((result) => result.ok).length
      if (catches && passed > 0) parts.push(`잡는 테스트 ${passed}개(정상 통과, 결함 실패)`)
      const examples = (assets ?? []).filter((result) => result.kind !== 'typecheck' && result.ok).length
      if (examples > 0) parts.push(`패턴 예시 ${examples}개(좋은 예시 결함 실패, 슬롭 예시 결함 통과)`)
    }
    lines.push(parts.length > 0 ? `  ${id.padEnd(width)}  ${parts.join(' · ')}` : `  ${id}`)
    for (const error of errors) lines.push(`    ✗ ${error}`)
  }
  if (setupErrors.length > 0) {
    lines.push('  패턴 예시 설정')
    for (const error of setupErrors) lines.push(`    ✗ ${error}`)
  }
  if (!tests) lines.push('잡는 테스트와 패턴 예시는 돌리지 않았다(--no-tests)')
  return lines.join('\n')
}
