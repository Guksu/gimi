/**
 * 영향 범위 — 바뀐 export와 바뀐 문자열을 쓰는 곳을 찾는다(설계 결정 20).
 * 리뷰하는 프로젝트에 설치된 typescript의 언어 서비스로 참조를 찾는다. 이름이 같은 다른 심볼과 구분된다.
 * typescript가 없거나 언어 서비스 API가 없는 버전(TypeScript 7 등)이면 git grep으로 찾고 "정확도 낮음"으로 적는다.
 * 지운 export는 이미 심볼이 없으니 이름으로 찾는다. import 줄은 쓰는 곳이 아니라서 뺀다.
 * 바뀐 export를 같은 파일의 다른 export가 부르면(감싼 export) 그 export의 사용처도 한 단계 더 찾는다.
 * 지운 필드(응답 객체에서 뺀 키 등)는 export도 계약도 바뀌지 않으면 참조로 이어지지 않아 이름으로 찾는다(정확도 낮음).
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { attempt } from './exec.mjs'
import { compareExports, extractExportsText, extractExportsTs } from './exports.mjs'
import { changedLiterals, removedFieldsOf } from './literals.mjs'

const CODE = /\.(m|c)?[jt]sx?$|\.(vue|svelte)$/
export const CODE_GLOBS = ['*.ts', '*.tsx', '*.mts', '*.cts', '*.js', '*.jsx', '*.mjs', '*.cjs', '*.vue', '*.svelte']
const LOCKFILES = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb']
const IMPORT_LINE = /^\s*import\b/
const MAX_USAGES = 100
const MAX_LITERALS = 30
const MAX_FIELDS = 30
const CONTEXT = 2

/**
 * 프로젝트의 typescript를 불러온다 — 이 스크립트가 아니라 리뷰하는 저장소의 것이다(런타임 의존성 0)
 * @param {{ root: string }} args @returns {{ ts: any, reason: string | null }}
 */
export const loadTypescript = ({ root }) => {
  const require = createRequire(join(root, 'gimi-context.cjs'))
  const version = attempt(() => require('typescript/package.json').version)
  if (!version) return { ts: null, reason: '이 프로젝트에 typescript가 없다' }
  const ts = attempt(() => require('typescript'))
  if (!ts) return { ts: null, reason: `이 프로젝트의 typescript ${version}을(를) 불러오지 못했다` }
  if (typeof ts.createLanguageService !== 'function') return { ts: null, reason: `이 프로젝트의 typescript ${version}에는 언어 서비스 API가 없다` }
  return { ts, reason: null }
}

/** 파일 내용 캐시 — 줄 번호와 문맥을 읽는다 */
export const createFileReader = ({ root }) => {
  const cache = new Map()
  return (path) => {
    if (!cache.has(path)) {
      const abs = join(root, path)
      cache.set(path, existsSync(abs) ? readFileSync(abs, 'utf8').replace(/\n$/, '').split('\n') : [])
    }
    return cache.get(path)
  }
}

export const usageAt = ({ readLines, path, line, changedPaths }) => {
  const lines = readLines(path)
  const from = Math.max(1, line - CONTEXT)
  const to = Math.min(lines.length, line + CONTEXT)
  return { path, line, text: (lines[line - 1] ?? '').trim().slice(0, 200), context: lines.slice(from - 1, to), changedInPr: changedPaths.has(path) }
}

/** 이 변경에서 안 바뀐 사용처가 먼저다 — 깨질 수 있는 곳은 거기다 */
export const finalize = (usages) => {
  const unique = [...new Map(usages.map((u) => [`${u.path}:${u.line}`, u])).values()]
  unique.sort((a, b) => Number(a.changedInPr) - Number(b.changedInPr) || a.path.localeCompare(b.path) || a.line - b.line)
  return { total: unique.length, unchanged: unique.filter((u) => !u.changedInPr).length, usages: unique.slice(0, MAX_USAGES) }
}

export const grep = ({ exec, args }) => {
  const out = attempt(() => exec.git(['grep', '-n', '-z', '-I', ...args]))
  if (!out) return []
  return out
    .split('\n')
    .filter(Boolean)
    .map((row) => {
      const [path, line, ...rest] = row.split('\0')
      return { path, line: Number(line), text: rest.join('\0') }
    })
}

/** 필드처럼 쓰인 줄 — .이름, 이름:(객체·타입·YAML), 문자열 '이름', YAML·배열 목록 [a, 이름] */
const fieldUse = (name) => {
  const n = name.replace(/\$/g, '\\$')
  return new RegExp(`\\.${n}(?![\\w$])|(?<![\\w$.])${n}\\??\\s*:|['"\`]${n}['"\`]|[\\[,]\\s*${n}\\s*[,\\]]`)
}

/** 언어 서비스 — tsconfig마다 하나씩 만들어 둔다. 솔루션형 tsconfig(references)는 한 단계 따라간다 */
export const createTsIndex = ({ ts, root }) => {
  const projects = new Map()
  const load = (configPath) => {
    if (projects.has(configPath)) return projects.get(configPath)
    const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} })
    const fileNames = parsed?.fileNames ?? []
    const host = {
      getScriptFileNames: () => fileNames,
      getScriptVersion: () => '0',
      getScriptSnapshot: (file) => {
        const text = ts.sys.readFile(file)
        return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text)
      },
      getCurrentDirectory: () => dirname(configPath),
      getCompilationSettings: () => parsed?.options ?? {},
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      fileExists: ts.sys.fileExists,
      readFile: ts.sys.readFile,
      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
    }
    const project = {
      files: new Set(fileNames),
      references: (parsed?.projectReferences ?? []).map((ref) => ts.resolveProjectReferencePath(ref)),
      service: ts.createLanguageService(host, ts.createDocumentRegistry()),
    }
    projects.set(configPath, project)
    return project
  }
  const projectFor = (abs) => {
    const first = ts.findConfigFile(dirname(abs), ts.sys.fileExists, 'tsconfig.json')
    if (!first) return null
    const queue = [first]
    for (let i = 0; i < queue.length && i < 10; i += 1) {
      const project = load(queue[i])
      if (project.files.has(abs)) return project
      for (const ref of project.references) if (!queue.includes(ref)) queue.push(ref)
    }
    return null
  }
  /** @returns {{ path: string, pos: number }[] | null} null이면 이 파일이 어느 tsconfig에도 없다. includeSelf면 같은 파일 안의 참조도 */
  const referencesOf = ({ path, namePos, includeSelf = false }) => {
    const abs = join(root, path)
    const project = projectFor(abs)
    if (!project) return null
    const symbols = project.service.findReferences(abs, namePos) ?? []
    return symbols
      .flatMap((symbol) => symbol.references)
      .filter((ref) => !ref.isDefinition && (includeSelf || ref.fileName !== abs) && !ref.fileName.includes('/node_modules/'))
      .map((ref) => ({ path: relative(root, ref.fileName), pos: ref.textSpan.start }))
  }
  return { referencesOf }
}

export const lineOfPos = ({ readLines, path, pos }) => {
  let rest = pos
  const lines = readLines(path)
  for (let i = 0; i < lines.length; i += 1) {
    if (rest <= lines[i].length) return i + 1
    rest -= lines[i].length + 1
  }
  return lines.length
}

/**
 * @param {{ exec: { git: (args: string[]) => string }, root: string, scope: { mergeBase: string }, files: import('./diff.mjs').FileDiff[], ts: any, reason: string | null }} args
 */
export const collectImpact = ({ exec, root, scope, files, ts, reason }) => {
  const readLines = createFileReader({ root })
  const index = ts ? createTsIndex({ ts, root }) : null
  const changedPaths = new Set(files.map((file) => file.newPath).filter(Boolean))
  const notes = []
  const symbols = []
  const added = []
  let otherFiles = 0
  let dirtyFiles = 0
  const outsideConfig = new Set()

  const textUsages = ({ name, exclude }) =>
    grep({ exec, args: ['-w', '-F', '-e', name, '--', ...CODE_GLOBS, `:(exclude)${exclude}`] })
      .filter((hit) => !IMPORT_LINE.test(hit.text))
      .map((hit) => usageAt({ readLines, path: hit.path, line: hit.line, changedPaths }))

  // 감싼 export — 바뀐 export를 같은 파일 안에서 부르는 다른 export. 한 단계만 따라간다(그 export도 바뀌었으면 이미 담았다)
  const wrappersOf = ({ change, path, afterDecls, changed }) => {
    const changedNames = new Set(changed.map((c) => c.name))
    const seen = new Set()
    const out = []
    for (const ref of index.referencesOf({ path, namePos: change.after.namePos, includeSelf: true }) ?? []) {
      if (ref.path !== path) continue
      const line = lineOfPos({ readLines, path, pos: ref.pos })
      const wrapper = afterDecls.find((decl) => decl.name !== change.name && decl.namePos != null && line >= decl.start && line <= decl.end)
      if (!wrapper || changedNames.has(wrapper.name) || seen.has(wrapper.name)) continue
      seen.add(wrapper.name)
      const refs = index.referencesOf({ path, namePos: wrapper.namePos }) ?? []
      const usages = refs.map((r) => usageAt({ readLines, path: r.path, line: lineOfPos({ readLines, path: r.path, pos: r.pos }), changedPaths })).filter((usage) => !IMPORT_LINE.test(usage.text))
      out.push({ name: wrapper.name, kind: wrapper.kind, change: 'wraps', through: change.name, path, method: 'typescript', searched: true, ...finalize(usages) })
    }
    return out
  }

  for (const file of files) {
    const path = file.newPath ?? file.oldPath
    if (file.binary) continue
    if (!CODE.test(path)) {
      otherFiles += 1
      continue
    }
    const beforeText = file.status === 'added' ? '' : (attempt(() => exec.git(['show', `${scope.mergeBase}:${file.oldPath}`])) ?? '')
    const afterText = file.status === 'deleted' ? '' : (attempt(() => exec.git(['show', `HEAD:${file.newPath}`])) ?? '')
    // 참조 찾기는 디스크의 파일을 읽는다 — 커밋하지 않은 변경이 있으면 위치가 어긋나니 그 파일은 문자열로 찾는다
    const diskMatches = file.newPath != null && existsSync(join(root, file.newPath)) && readFileSync(join(root, file.newPath), 'utf8') === afterText
    if (ts && file.newPath != null && !diskMatches) dirtyFiles += 1
    const extract = (text, name) => (ts ? extractExportsTs({ ts, text, fileName: name }) : extractExportsText({ text }))
    const afterDecls = extract(afterText, path)
    const changes = compareExports({
      before: extract(beforeText, file.oldPath ?? path),
      after: afterDecls,
      removedLines: new Set(file.hunks.flatMap((hunk) => hunk.removed.map((row) => row.line))),
      addedLines: new Set(file.hunks.flatMap((hunk) => hunk.added.map((row) => row.line))),
    })

    for (const change of changes) {
      // 새 export는 아직 쓰는 곳이 없다 — 이름만 남긴다
      if (change.change === 'added') {
        added.push({ name: change.name, path })
        continue
      }
      let method = 'text'
      let found = null
      if (change.change !== 'removed' && index && diskMatches && change.after?.namePos != null) {
        const refs = index.referencesOf({ path, namePos: change.after.namePos })
        if (refs) {
          method = 'typescript'
          found = refs
            .map((ref) => usageAt({ readLines, path: ref.path, line: lineOfPos({ readLines, path: ref.path, pos: ref.pos }), changedPaths }))
            .filter((usage) => !IMPORT_LINE.test(usage.text))
        } else outsideConfig.add(path)
      }
      // 이름 없는 default export는 이름으로 찾을 수 없다
      const searched = found != null || change.name !== 'default'
      if (!found) found = searched ? textUsages({ name: change.name, exclude: path }) : []
      symbols.push({ name: change.name, kind: change.kind, change: change.change, path, method, searched, ...finalize(found) })
      if (method === 'typescript') symbols.push(...wrappersOf({ change, path, afterDecls, changed: changes }))
    }
  }
  if (outsideConfig.size > 0) notes.push(`어느 tsconfig에도 없는 파일 ${outsideConfig.size}개(${[...outsideConfig].slice(0, 3).join(', ')}${outsideConfig.size > 3 ? ' 등' : ''})는 사용처를 문자열로 찾았다`)
  if (dirtyFiles > 0) notes.push(`커밋하지 않은 변경이 있는 파일 ${dirtyFiles}개는 참조 위치가 어긋날 수 있어 문자열로 찾았다`)

  const literals = []
  for (const file of files) {
    if (file.binary) continue
    const path = file.newPath ?? file.oldPath
    for (const value of changedLiterals(file)) {
      if (literals.length >= MAX_LITERALS) break
      const hits = grep({ exec, args: ['-F', '-e', value, '--', '.', ...LOCKFILES.map((lock) => `:(exclude)${lock}`), `:(exclude)${path}`] })
      literals.push({ value, path, ...finalize(hits.map((hit) => usageAt({ readLines, path: hit.path, line: hit.line, changedPaths }))) })
    }
  }

  // 지운 필드 — 이름이 쓰이는 줄 가운데 필드처럼 쓰인 것(.이름, 이름:, '이름', YAML 목록의 이름)만. 계약 파일·목도 함께 찾는다
  const fields = []
  for (const file of files) {
    const path = file.newPath ?? file.oldPath
    if (file.binary || !CODE.test(path)) continue
    for (const name of removedFieldsOf(file)) {
      if (fields.length >= MAX_FIELDS) break
      const use = fieldUse(name)
      const hits = grep({ exec, args: ['-w', '-F', '-e', name, '--', '.', ...LOCKFILES.map((lock) => `:(exclude)${lock}`), `:(exclude)${path}`] }).filter((hit) => !IMPORT_LINE.test(hit.text) && use.test(hit.text))
      fields.push({ name, path, method: 'text', ...finalize(hits.map((hit) => usageAt({ readLines, path: hit.path, line: hit.line, changedPaths }))) })
    }
  }

  if (otherFiles > 0) notes.push(`TS·JS가 아닌 파일 ${otherFiles}개는 export를 찾지 않고 바뀐 문자열만 찾았다`)
  return { method: ts ? 'typescript' : 'text', reason, symbols, added, literals, fields, notes }
}
