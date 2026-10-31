/**
 * 바뀐 export 찾기 — 바뀌기 전·뒤 파일에서 최상위 export 선언을 찾아 비교한다(설계 결정 20).
 * TypeScript가 있으면 구문 트리로, 없으면 줄 단위 정규식으로 찾는다(정확도 낮음).
 * 종류: added(새로 생김) · removed(사라짐) · signature(시그니처 변경) · body(본문만 변경)
 * export한 클래스는 멤버도 `클래스.멤버`로 담는다 — 메서드 본문만 바뀌면 클래스를 주입하는 곳이 아니라 그 메서드를 부르는 곳을 찾는다.
 * 이름으로 가를 수 없는 멤버(계산된 이름, 떨어져 있거나 static과 섞인 같은 이름)는 담지 않고 클래스에 남긴다.
 */

/** @typedef {{ name: string, kind: string, start: number, end: number, signature: string, namePos: number | null }} ExportDecl */

const norm = (text) => text.replace(/\s+/g, ' ').trim()

// 같은 이름이 여러 번 나오면(함수 오버로드) 하나로 합친다 — 범위는 넓히고 시그니처는 이어 붙인다
const mergeByName = (decls) => {
  const merged = new Map()
  for (const decl of decls) {
    const prev = merged.get(decl.name)
    if (!prev) merged.set(decl.name, { ...decl })
    else merged.set(decl.name, { ...prev, start: Math.min(prev.start, decl.start), end: Math.max(prev.end, decl.end), signature: `${prev.signature}; ${decl.signature}`, namePos: prev.namePos ?? decl.namePos })
  }
  return [...merged.values()]
}

const scriptKindOf = (ts, fileName) => {
  if (fileName.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (fileName.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (/\.[cm]?js$/.test(fileName)) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

/**
 * @param {{ ts: any, text: string, fileName: string }} args
 * @returns {ExportDecl[]}
 */
export const extractExportsTs = ({ ts, text, fileName }) => {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKindOf(ts, fileName))
  const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1
  const slice = (from, to) => norm(text.slice(from, to))
  const has = (node, kind) => (node.modifiers ?? []).some((m) => m.kind === kind)
  // 멤버의 본문 없는 머리 — 화살표 함수 필드도 본문을 뺀다
  const headOf = (m) => {
    const fn = ts.isPropertyDeclaration(m) && m.initializer && (ts.isArrowFunction(m.initializer) || ts.isFunctionExpression(m.initializer)) ? m.initializer : null
    const body = m.body ?? fn?.body
    return slice(m.getStart(sf), body ? body.getStart(sf) : m.end)
  }
  const decls = []

  for (const st of sf.statements) {
    const start = st.getStart(sf)
    const range = { start: lineOf(start), end: lineOf(st.end) }
    const exported = has(st, ts.SyntaxKind.ExportKeyword)

    if (ts.isFunctionDeclaration(st) && exported) {
      const name = has(st, ts.SyntaxKind.DefaultKeyword) ? 'default' : st.name?.text
      if (name) decls.push({ name, kind: 'function', ...range, signature: slice(start, st.body ? st.body.getStart(sf) : st.end), namePos: st.name ? st.name.getStart(sf) : null })
    } else if (ts.isClassDeclaration(st) && exported) {
      const name = has(st, ts.SyntaxKind.DefaultKeyword) ? 'default' : st.name?.text
      // 클래스는 머리 + 멤버의 본문 없는 선언 — 메서드 본문만 바뀐 것은 본문 변경이다
      const header = slice(start, st.members.pos - 1)
      if (!name) continue
      decls.push({ name, kind: 'class', ...range, signature: `${header} { ${st.members.map(headOf).join('; ')} }`, namePos: st.name ? st.name.getStart(sf) : null })
      const named = st.members.map((m, at) => ({ m, at, key: m.name && (ts.isIdentifier(m.name) || ts.isPrivateIdentifier(m.name)) ? m.name.text : null }))
      for (const { m, at, key } of named) {
        if (key == null) continue
        // 같은 이름은 붙어 있고(오버로드·get/set) static이 섞이지 않을 때만 합친다
        const same = named.filter((other) => other.key === key)
        if (same.at(-1).at - same[0].at + 1 !== same.length || new Set(same.map((other) => has(other.m, ts.SyntaxKind.StaticKeyword))).size > 1) continue
        const from = m.getStart(sf)
        decls.push({ name: `${name}.${key}`, kind: 'method', start: lineOf(from), end: lineOf(m.end), signature: headOf(m), namePos: m.name.getStart(sf) })
      }
    } else if (ts.isVariableStatement(st) && exported) {
      for (const decl of st.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue
        const init = decl.initializer
        // 함수 값이면 본문을 뺀 머리, 그 밖의 값(상수·설정 객체)은 선언 전체 — 값이 바뀌면 쓰는 쪽이 영향을 받는다
        const isFunction = init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && init.body
        decls.push({ name: decl.name.text, kind: isFunction ? 'function' : 'const', ...range, signature: slice(start, isFunction ? init.body.getStart(sf) : st.end), namePos: decl.name.getStart(sf) })
      }
    } else if ((ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isEnumDeclaration(st) || ts.isModuleDeclaration(st)) && exported) {
      const kind = ts.isInterfaceDeclaration(st) ? 'interface' : ts.isTypeAliasDeclaration(st) ? 'type' : ts.isEnumDeclaration(st) ? 'enum' : 'namespace'
      decls.push({ name: st.name.text, kind, ...range, signature: slice(start, st.end), namePos: st.name.getStart(sf) })
    } else if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause)) {
      const from = st.moduleSpecifier ? ` from ${st.moduleSpecifier.getText(sf)}` : ''
      for (const el of st.exportClause.elements) decls.push({ name: el.name.text, kind: 'reexport', ...range, signature: `${norm(el.getText(sf))}${from}`, namePos: null })
    } else if (ts.isExportAssignment(st)) {
      decls.push({ name: 'default', kind: 'default', ...range, signature: slice(start, st.end), namePos: null })
    }
  }
  return mergeByName(decls)
}

const TEXT_PATTERNS = [
  [/^export\s+default\b/, () => ['default']],
  [/^export\s+(?:declare\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, (m) => [m[1]]],
  [/^export\s+(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, (m) => [m[1]]],
  [/^export\s+(?:declare\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/, (m) => [m[1]]],
  [/^export\s+(?:declare\s+)?(?:type|interface|enum|namespace)\s+([A-Za-z_$][\w$]*)/, (m) => [m[1]]],
  [/^export\s*(?:type\s*)?\{([^}]*)\}/, (m) => m[1].split(',').map((part) => part.trim().split(/\s+as\s+/).at(-1).trim()).filter(Boolean)],
]

/**
 * TypeScript가 없을 때 — export로 시작하는 줄을 찾고, 다음 export 전까지를 그 선언의 범위로 본다
 * @param {{ text: string }} args
 * @returns {ExportDecl[]}
 */
export const extractExportsText = ({ text }) => {
  const rows = text.split('\n')
  const total = text.endsWith('\n') ? rows.length - 1 : rows.length
  const found = []
  rows.forEach((row, index) => {
    for (const [pattern, names] of TEXT_PATTERNS) {
      const match = row.match(pattern)
      if (!match) continue
      for (const name of names(match)) found.push({ name, line: index + 1, signature: norm(row) })
      break
    }
  })
  const starts = [...new Set(found.map((f) => f.line))]
  const decls = found.map((f) => {
    const next = starts.find((line) => line > f.line)
    return { name: f.name, kind: 'text', start: f.line, end: next ? next - 1 : total, signature: f.signature, namePos: null }
  })
  return mergeByName(decls)
}

const overlaps = ({ start, end }, lines) => [...lines].some((line) => line >= start && line <= end)

/**
 * @param {{ before: ExportDecl[], after: ExportDecl[], removedLines: Set<number>, addedLines: Set<number> }} args
 * removedLines는 바뀌기 전 파일의 줄 번호, addedLines는 바뀐 뒤 파일의 줄 번호
 */
export const compareExports = ({ before, after, removedLines, addedLines }) => {
  const beforeByName = new Map(before.map((decl) => [decl.name, decl]))
  const afterNames = new Set(after.map((decl) => decl.name))
  const changes = []
  for (const decl of after) {
    const prev = beforeByName.get(decl.name)
    if (!prev) changes.push({ name: decl.name, kind: decl.kind, change: 'added', after: decl })
    else if (prev.signature !== decl.signature) changes.push({ name: decl.name, kind: decl.kind, change: 'signature', before: prev, after: decl })
    else if (overlaps(decl, addedLines) || overlaps(prev, removedLines)) changes.push({ name: decl.name, kind: decl.kind, change: 'body', before: prev, after: decl })
  }
  for (const decl of before) if (!afterNames.has(decl.name)) changes.push({ name: decl.name, kind: decl.kind, change: 'removed', before: decl })
  // 바뀐 줄이 모두 담은 멤버 안에 있는 클래스는 클래스 전체를 빼고 바뀐 멤버만 남긴다
  const inMembers = (cls, decls, lines) => {
    const members = decls.filter((decl) => decl.kind === 'method' && decl.name.startsWith(`${cls.name}.`))
    return [...lines].filter((line) => line >= cls.start && line <= cls.end).every((line) => members.some((m) => line >= m.start && line <= m.end))
  }
  return changes.filter((c) => !(c.kind === 'class' && c.change === 'body' && inMembers(c.after, after, addedLines) && inMembers(c.before, before, removedLines)))
}
