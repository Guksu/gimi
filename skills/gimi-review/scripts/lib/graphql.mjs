/**
 * GraphQL 계약 비교와 사용처(설계 결정 47) — 스키마(SDL)의 옛 판·새 판을 비교하고, 코드 안의 연산을 스키마로 풀어 바뀐 필드를 고르는 곳을 찾는다.
 * 연산의 선택 집합을 스키마로 따라가 필드마다 "어느 타입의 필드인지" 정한다. 그래서 이름이 같은 다른 타입의 필드와 섞이지 않는다.
 * 의존성 없이 읽으려고 작은 파서를 둔다. 지시어·기본값·설명은 읽고 넘긴다.
 */

export class GraphqlError extends Error {}

const LEVEL_ORDER = { breaking: 0, caution: 1, additive: 2 }
const PUNCT = new Set(['!', '$', '&', '(', ')', ':', '=', '@', '[', ']', '{', '|', '}'])
const DEFAULT_ROOTS = { query: 'Query', mutation: 'Mutation', subscription: 'Subscription' }

const tokenize = (text) => {
  const tokens = []
  let line = 1
  let k = 0
  while (k < text.length) {
    const c = text[k]
    if (c === '\n') {
      line += 1
      k += 1
    } else if (c === ' ' || c === '\t' || c === '\r' || c === ',' || c === '﻿') k += 1
    else if (c === '#') {
      while (k < text.length && text[k] !== '\n') k += 1
    } else if (text.startsWith('...', k)) {
      tokens.push({ kind: 'punct', value: '...', line })
      k += 3
    } else if (PUNCT.has(c)) {
      tokens.push({ kind: 'punct', value: c, line })
      k += 1
    } else if (/[_A-Za-z]/.test(c)) {
      const m = text.slice(k).match(/^[_0-9A-Za-z]+/)[0]
      tokens.push({ kind: 'name', value: m, line })
      k += m.length
    } else if (/[-0-9]/.test(c)) {
      const m = text.slice(k).match(/^-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/)
      if (!m) throw new GraphqlError(`${line}번째 줄: 숫자를 읽지 못했다`)
      tokens.push({ kind: 'number', value: m[0], line })
      k += m[0].length
    } else if (text.startsWith('"""', k)) {
      const end = text.indexOf('"""', k + 3)
      if (end === -1) throw new GraphqlError(`${line}번째 줄: 닫지 않은 블록 문자열`)
      const value = text.slice(k + 3, end)
      tokens.push({ kind: 'string', value, line })
      line += (value.match(/\n/g) ?? []).length
      k = end + 3
    } else if (c === '"') {
      let j = k + 1
      while (j < text.length && text[j] !== '"' && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1
      if (text[j] !== '"') throw new GraphqlError(`${line}번째 줄: 닫지 않은 문자열`)
      tokens.push({ kind: 'string', value: text.slice(k + 1, j), line })
      k = j + 1
    } else throw new GraphqlError(`${line}번째 줄: 알 수 없는 글자 ${JSON.stringify(c)}`)
  }
  tokens.push({ kind: 'eof', value: '', line })
  return tokens
}

/** GraphQL 문서(스키마·연산 모두)를 읽는다 @returns {any[]} 정의 목록 */
export const parseDocument = (text) => {
  const tokens = tokenize(text)
  let p = 0
  const peek = (offset = 0) => tokens[Math.min(p + offset, tokens.length - 1)]
  const fail = (what) => {
    throw new GraphqlError(`${peek().line}번째 줄: ${what}${peek().kind === 'eof' ? '(문서가 끝났다)' : ` — ${JSON.stringify(peek().value)}`}`)
  }
  const at = (value) => peek().kind === 'punct' && peek().value === value
  const atName = (value) => peek().kind === 'name' && (value === undefined || peek().value === value)
  const eat = (value) => {
    if (!at(value)) fail(`${value}이(가) 와야 한다`)
    return tokens[p++]
  }
  const name = () => {
    if (!atName()) fail('이름이 와야 한다')
    return tokens[p++]
  }
  const description = () => {
    if (peek().kind === 'string') p += 1
  }

  const value = () => {
    if (at('$')) {
      p += 1
      name()
    } else if (at('[')) {
      p += 1
      while (!at(']')) value()
      p += 1
    } else if (at('{')) {
      p += 1
      while (!at('}')) {
        name()
        eat(':')
        value()
      }
      p += 1
    } else if (['number', 'string', 'name'].includes(peek().kind)) p += 1
    else fail('값이 와야 한다')
  }
  const directives = () => {
    while (at('@')) {
      p += 1
      name()
      if (at('(')) {
        p += 1
        while (!at(')')) {
          name()
          eat(':')
          value()
        }
        p += 1
      }
    }
  }
  const type = () => {
    let out
    if (at('[')) {
      p += 1
      out = `[${type()}]`
      eat(']')
    } else out = name().value
    if (at('!')) {
      p += 1
      out += '!'
    }
    return out
  }
  /** 인자·input 필드 정의 — 이름: 타입 (= 기본값) 지시어 */
  const inputValues = (close) => {
    const out = []
    while (!at(close)) {
      description()
      const token = name()
      eat(':')
      const t = type()
      let hasDefault = false
      if (at('=')) {
        p += 1
        value()
        hasDefault = true
      }
      directives()
      out.push({ name: token.value, type: t, hasDefault, line: token.line })
    }
    p += 1
    return out
  }
  const fieldsDefinition = () => {
    const fields = []
    if (!at('{')) return fields
    p += 1
    while (!at('}')) {
      description()
      const token = name()
      const args = at('(') ? (p++, inputValues(')')) : []
      eat(':')
      const t = type()
      directives()
      fields.push({ name: token.value, type: t, args, line: token.line })
    }
    p += 1
    return fields
  }
  const selectionSet = () => {
    eat('{')
    const selections = []
    while (!at('}')) {
      if (at('...')) {
        p += 1
        if (atName('on')) {
          p += 1
          const typeCondition = name().value
          directives()
          selections.push({ kind: 'inline', typeCondition, selectionSet: selectionSet() })
        } else if (atName()) {
          selections.push({ kind: 'spread', name: name().value })
          directives()
        } else {
          directives()
          selections.push({ kind: 'inline', typeCondition: null, selectionSet: selectionSet() })
        }
        continue
      }
      let token = name()
      if (at(':')) {
        p += 1
        token = name()
      }
      if (at('(')) {
        p += 1
        while (!at(')')) {
          name()
          eat(':')
          value()
        }
        p += 1
      }
      directives()
      selections.push({ kind: 'field', name: token.value, line: token.line, selectionSet: at('{') ? selectionSet() : null })
    }
    p += 1
    return selections
  }

  const definitions = []
  while (peek().kind !== 'eof') {
    description()
    const start = peek()
    if (at('{')) {
      definitions.push({ kind: 'operation', operation: 'query', name: null, line: start.line, selectionSet: selectionSet() })
      continue
    }
    if (!atName()) fail('정의가 와야 한다')
    const keyword = name().value
    if (['query', 'mutation', 'subscription'].includes(keyword)) {
      const opName = atName() ? name().value : null
      if (at('(')) {
        p += 1
        while (!at(')')) {
          eat('$')
          name()
          eat(':')
          type()
          if (at('=')) {
            p += 1
            value()
          }
          directives()
        }
        p += 1
      }
      directives()
      definitions.push({ kind: 'operation', operation: keyword, name: opName, line: start.line, selectionSet: selectionSet() })
      continue
    }
    if (keyword === 'fragment') {
      const fragName = name().value
      if (!atName('on')) fail('on이 와야 한다')
      p += 1
      const typeCondition = name().value
      directives()
      definitions.push({ kind: 'fragment', name: fragName, typeCondition, line: start.line, selectionSet: selectionSet() })
      continue
    }
    const extend = keyword === 'extend'
    const kind = extend ? name().value : keyword
    if (kind === 'schema') {
      directives()
      const ops = {}
      if (at('{')) {
        p += 1
        while (!at('}')) {
          const op = name().value
          eat(':')
          ops[op] = name().value
        }
        p += 1
      }
      definitions.push({ kind: 'schema', ops, line: start.line })
    } else if (kind === 'directive') {
      eat('@')
      name()
      if (at('(')) {
        p += 1
        inputValues(')')
      }
      if (atName('repeatable')) p += 1
      if (!atName('on')) fail('on이 와야 한다')
      p += 1
      if (at('|')) p += 1
      name()
      while (at('|')) {
        p += 1
        name()
      }
    } else if (['type', 'interface', 'input', 'enum', 'union', 'scalar'].includes(kind)) {
      const typeName = name()
      const def = { kind, name: typeName.value, extend, line: typeName.line, fields: [], values: [], members: [], interfaces: [] }
      if (atName('implements')) {
        p += 1
        if (at('&')) p += 1
        def.interfaces.push(name().value)
        while (at('&')) {
          p += 1
          def.interfaces.push(name().value)
        }
      }
      directives()
      if (kind === 'type' || kind === 'interface') def.fields = fieldsDefinition()
      else if (kind === 'input') {
        if (at('{')) {
          p += 1
          def.fields = inputValues('}').map((field) => ({ ...field, args: [] }))
        }
      } else if (kind === 'enum') {
        if (at('{')) {
          p += 1
          while (!at('}')) {
            description()
            def.values.push(name().value)
            directives()
          }
          p += 1
        }
      } else if (kind === 'union' && at('=')) {
        p += 1
        if (at('|')) p += 1
        def.members.push(name().value)
        while (at('|')) {
          p += 1
          def.members.push(name().value)
        }
      }
      definitions.push(def)
    } else fail('알 수 없는 정의')
  }
  return definitions
}

const TYPE_KINDS = new Set(['type', 'interface', 'input', 'enum', 'union', 'scalar'])
export const hasTypeDefinitions = (definitions) => definitions.some((d) => TYPE_KINDS.has(d.kind) || d.kind === 'schema')
export const hasOperations = (definitions) => definitions.some((d) => d.kind === 'operation' || d.kind === 'fragment')
export const namedType = (type) => type.replace(/[[\]!]/g, '')

/**
 * 여러 파일의 스키마를 하나로 — extend는 같은 타입에 더한다
 * @param {{ path: string, text: string }[]} sources
 */
export const parseSchema = (sources) => {
  const types = new Map()
  const roots = { ...DEFAULT_ROOTS }
  for (const source of sources) {
    let definitions
    try {
      definitions = parseDocument(source.text)
    } catch (error) {
      if (error instanceof GraphqlError) throw new GraphqlError(`${source.path} ${error.message}`)
      throw error
    }
    for (const def of definitions) {
      if (def.kind === 'schema') Object.assign(roots, def.ops)
      if (!TYPE_KINDS.has(def.kind)) continue
      const type = types.get(def.name) ?? { kind: def.kind, path: source.path, line: def.line, fields: new Map(), values: new Set(), members: new Set() }
      for (const field of def.fields) {
        type.fields.set(field.name, { type: field.type, args: new Map(field.args.map((a) => [a.name, a.type])), defaults: new Set(field.args.filter((a) => a.hasDefault).map((a) => a.name)), hasDefault: field.hasDefault ?? false, line: field.line, path: source.path })
      }
      for (const v of def.values) type.values.add(v)
      for (const m of def.members) type.members.add(m)
      types.set(def.name, type)
    }
  }
  return { types, roots }
}

const quote = (value) => `'${value}'`
const worst = (levels) => levels.reduce((a, b) => (LEVEL_ORDER[b] < LEVEL_ORDER[a] ? b : a), 'additive')
const bangs = (type) => (type.match(/!/g) ?? []).length

/** 출력 타입 — null 허용은 확인, null 금지는 추가, 다른 타입은 깨질 수 있음 */
const compareOutput = (was, now) => {
  if (was === now) return null
  if (namedType(was) !== namedType(now) || was.replace(/!/g, '') !== now.replace(/!/g, '')) return { text: `타입 ${was} → ${now}`, level: 'breaking' }
  return bangs(now) < bangs(was) ? { text: `타입 ${was} → ${now}(null을 허용하게 됐다)`, level: 'caution' } : { text: `타입 ${was} → ${now}(null을 허용하지 않게 됐다)`, level: 'additive' }
}
/** 입력 타입(인자·input 필드) — 필수가 되면 깨질 수 있음, 필수에서 빠지면 추가 */
const compareInput = (was, now) => {
  if (was === now) return null
  if (was.replace(/!/g, '') !== now.replace(/!/g, '')) return { text: `타입 ${was} → ${now}`, level: 'breaking' }
  return bangs(now) > bangs(was) ? { text: `타입 ${was} → ${now}(필수가 됐다)`, level: 'breaking' } : { text: `타입 ${was} → ${now}(필수에서 빠졌다)`, level: 'additive' }
}
const requiredInput = (type, hasDefault) => type.endsWith('!') && !hasDefault

/** 바뀐 것이 닿는 출력 필드(사용처를 찾을 대상) */
const affectedBy = (schema, name) => {
  const target = schema.types.get(name)
  const out = new Set()
  // 이 타입을 (중첩 input까지) 담는 input들
  const containers = new Set([name])
  for (let grew = true; grew; ) {
    grew = false
    for (const [typeName, type] of schema.types) {
      if (type.kind !== 'input' || containers.has(typeName)) continue
      if ([...type.fields.values()].some((f) => containers.has(namedType(f.type)))) {
        containers.add(typeName)
        grew = true
      }
    }
  }
  for (const [typeName, type] of schema.types) {
    if (type.kind !== 'type' && type.kind !== 'interface') continue
    for (const [fieldName, field] of type.fields) {
      if (namedType(field.type) === name || [...field.args.values()].some((t) => containers.has(namedType(t)))) out.add(`${typeName}.${fieldName}`)
    }
  }
  if (target && (target.kind === 'type' || target.kind === 'interface')) for (const fieldName of target.fields.keys()) out.add(`${name}.${fieldName}`)
  return [...out].sort()
}

/**
 * @param {{ before: ReturnType<typeof parseSchema>, after: ReturnType<typeof parseSchema> }} args
 * @returns {{ key: string, change: 'added' | 'removed' | 'changed', level: string, details: string[], typeName: string, fieldName?: string, affects: string[] }[]}
 */
export const diffSchema = ({ before, after }) => {
  const changes = []
  const push = (change, found) => {
    if (found.length > 0) changes.push({ ...change, level: worst(found.map((f) => f.level)), details: found.map((f) => f.text) })
  }
  const names = [...new Set([...before.types.keys(), ...after.types.keys()])].sort()
  for (const name of names) {
    const was = before.types.get(name)
    const is = after.types.get(name)
    if (!is) {
      push({ key: name, change: 'removed', typeName: name, affects: affectedBy(before, name) }, [{ text: '타입을 지웠다', level: 'breaking' }])
      continue
    }
    if (!was) {
      push({ key: name, change: 'added', typeName: name, affects: [] }, [{ text: '타입을 더했다', level: 'additive' }])
      continue
    }
    if (was.kind !== is.kind) {
      push({ key: name, change: 'changed', typeName: name, affects: affectedBy(before, name) }, [{ text: `종류 ${was.kind} → ${is.kind}`, level: 'breaking' }])
      continue
    }
    if (is.kind === 'enum' || is.kind === 'union') {
      const label = is.kind === 'enum' ? 'enum 값' : 'union 멤버'
      const [old, now] = is.kind === 'enum' ? [was.values, is.values] : [was.members, is.members]
      const found = [
        ...[...old].filter((v) => !now.has(v)).map((v) => ({ text: `${label} ${quote(v)}을(를) 지웠다`, level: 'breaking' })),
        ...[...now].filter((v) => !old.has(v)).map((v) => ({ text: `${label} ${quote(v)}을(를) 더했다`, level: 'caution' })),
      ]
      push({ key: name, change: 'changed', typeName: name, affects: affectedBy(after, name) }, found)
      continue
    }
    const input = is.kind === 'input'
    // input 필드가 바뀌면 그 input을 인자로 받는 필드가, 출력 필드가 바뀌면 그 필드가 사용처를 찾을 대상이다
    const inputAffects = input ? affectedBy(after, name) : null
    for (const fieldName of [...new Set([...was.fields.keys(), ...is.fields.keys()])]) {
      const oldField = was.fields.get(fieldName)
      const newField = is.fields.get(fieldName)
      const key = `${name}.${fieldName}`
      const base = { key, typeName: name, fieldName }
      if (!newField) {
        push({ ...base, change: 'removed', affects: inputAffects ?? [key] }, [{ text: '필드를 지웠다', level: 'breaking' }])
        continue
      }
      if (!oldField) {
        const required = input && requiredInput(newField.type, newField.hasDefault)
        push({ ...base, change: 'added', affects: inputAffects ?? [] }, [{ text: `필드를 더했다${required ? '(필수)' : ''}`, level: required ? 'breaking' : 'additive' }])
        continue
      }
      const found = []
      const typeChange = input ? compareInput(oldField.type, newField.type) : compareOutput(oldField.type, newField.type)
      if (typeChange) found.push(typeChange)
      // 인자 — 옛 순서대로 지움·바뀜, 그다음 새로 더한 것
      for (const [arg, type] of oldField.args) {
        if (!newField.args.has(arg)) found.push({ text: `인자 ${arg}을(를) 지웠다`, level: 'breaking' })
        else {
          const argChange = compareInput(type, newField.args.get(arg))
          if (argChange) found.push({ ...argChange, text: `인자 ${arg} ${argChange.text}` })
        }
      }
      for (const [arg, type] of newField.args) {
        if (oldField.args.has(arg)) continue
        const required = requiredInput(type, newField.defaults.has(arg))
        found.push({ text: `인자 ${arg}: ${type}을(를) 더했다${required ? '(필수)' : ''}`, level: required ? 'breaking' : 'additive' })
      }
      push({ ...base, change: 'changed', affects: inputAffects ?? [key] }, found)
    }
  }
  return changes.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || a.key.localeCompare(b.key))
}

/**
 * 연산을 스키마로 푼다 — 선택한 필드마다 부모 타입을 정한다. 스키마에 없는 필드도 부모 타입과 함께 남긴다(지운 필드의 사용처)
 * @param {{ schema: ReturnType<typeof parseSchema>, documents: { path: string, text: string, line: number }[] }} args
 */
export const resolveOperations = ({ schema, documents }) => {
  const uses = []
  const errors = []
  const walk = ({ selections, parent, trail, label, doc }) => {
    for (const selection of selections) {
      if (selection.kind === 'spread') continue
      if (selection.kind === 'inline') {
        walk({ selections: selection.selectionSet, parent: selection.typeCondition ?? parent, trail, label, doc })
        continue
      }
      if (selection.name === '__typename') continue
      const fieldPath = [...trail, selection.name].join('.')
      uses.push({ path: doc.path, line: doc.line + selection.line - 1, typeName: parent, fieldName: selection.name, operation: label, fieldPath })
      const field = schema.types.get(parent)?.fields.get(selection.name)
      if (selection.selectionSet && field) walk({ selections: selection.selectionSet, parent: namedType(field.type), trail: [...trail, selection.name], label, doc })
    }
  }
  for (const doc of documents) {
    let definitions
    try {
      definitions = parseDocument(doc.text)
    } catch (error) {
      if (!(error instanceof GraphqlError)) throw error
      const rel = Number(error.message.match(/^(\d+)번째 줄/)?.[1] ?? 1)
      errors.push(`${doc.path}:${doc.line + rel - 1} — GraphQL 문서를 읽지 못했다(${error.message.replace(/^\d+번째 줄: /, '')})`)
      continue
    }
    for (const def of definitions) {
      if (def.kind === 'operation') {
        walk({ selections: def.selectionSet, parent: schema.roots[def.operation], trail: [], label: def.name ? `${def.operation} ${def.name}` : def.operation, doc })
      } else if (def.kind === 'fragment') {
        walk({ selections: def.selectionSet, parent: def.typeCondition, trail: [], label: `fragment ${def.name}`, doc })
      }
    }
  }
  return { uses, errors }
}

const TAG = /(?:\bgql|\bgraphql)\s*(?:\(\s*)?`|\/\*\s*GraphQL\s*\*\/\s*`/g

/**
 * 코드 안의 GraphQL 문서 — gql·graphql 태그 템플릿, graphql(`…`) 호출, /* GraphQL *\/ 주석 템플릿. .graphql·.gql 파일은 통째로 한 문서다.
 * ${}(조각 끼워 넣기)는 공백으로 지운다 — 조각은 정의된 곳에서 따로 푼다. line은 문서가 시작하는 줄이다.
 * @returns {{ path: string, text: string, line: number }[]}
 */
export const extractDocuments = ({ path, text }) => {
  if (/\.(?:graphqls?|gql)$/.test(path)) return [{ path, text, line: 1 }]
  const out = []
  for (const m of text.matchAll(TAG)) {
    const start = m.index + m[0].length
    let k = start
    let body = ''
    while (k < text.length && text[k] !== '`') {
      if (text[k] === '\\') {
        body += '  '
        k += 2
      } else if (text[k] === '$' && text[k + 1] === '{') {
        let depth = 0
        while (k < text.length) {
          if (text[k] === '{') depth += 1
          else if (text[k] === '}') {
            depth -= 1
            if (depth === 0) {
              body += ' '
              k += 1
              break
            }
          }
          body += text[k] === '\n' ? '\n' : ' '
          k += 1
        }
      } else {
        body += text[k]
        k += 1
      }
    }
    out.push({ path, text: body, line: text.slice(0, start).split('\n').length })
  }
  return out
}
