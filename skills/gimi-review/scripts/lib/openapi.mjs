/**
 * OpenAPI 계약 비교(설계 결정 47) — 옛 판과 새 판에서 바뀐 엔드포인트·스키마 필드를 뽑는다. 3.x와 Swagger 2.0을 읽는다.
 * 스키마는 이름 단위로 비교하고($ref는 이름으로 적는다), 바뀐 스키마를 쓰는 엔드포인트는 $ref를 따라가 찾는다.
 * 등급 — breaking(쓰는 쪽이 깨질 수 있다)·caution(확인이 필요하다)·additive(더하기만 했다). 다른 파일을 가리키는 $ref는 따라가지 않는다.
 */

const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace']
const LEVEL_ORDER = { breaking: 0, caution: 1, additive: 2 }

export const isOpenApi = (doc) =>
  doc != null && typeof doc === 'object' && !Array.isArray(doc) && (doc.openapi != null || typeof doc.swagger === 'string') && (doc.paths != null || doc.components != null || doc.definitions != null)

const refName = (ref) => (typeof ref === 'string' ? ref.split('/').at(-1) : null)

/** 같은 문서 안의 $ref를 그 대상으로 바꾼다(파라미터·요청 본문·응답 재사용) */
const deref = (doc, value) => {
  let current = value
  for (let depth = 0; current?.$ref && depth < 10; depth += 1) {
    if (!current.$ref.startsWith('#/')) return current
    const target = current.$ref
      .slice(2)
      .split('/')
      .reduce((node, part) => node?.[part.replace(/~1/g, '/').replace(/~0/g, '~')], doc)
    if (!target) return current
    current = target
  }
  return current
}

/** 스키마를 한 줄 타입으로 — $ref는 이름, 배열은 항목[], 합성은 oneOf(A|B) */
const typeOf = (schema) => {
  if (!schema || typeof schema !== 'object') return 'any'
  if (schema.$ref) return refName(schema.$ref)
  for (const key of ['oneOf', 'anyOf', 'allOf']) if (Array.isArray(schema[key])) return `${key}(${schema[key].map(typeOf).join('|')})`
  const types = Array.isArray(schema.type) ? schema.type.filter((t) => t !== 'null') : schema.type ? [schema.type] : []
  const type = types.length === 0 ? (schema.properties ? 'object' : 'any') : types.join('|')
  if (type === 'array') return `${typeOf(schema.items)}[]`
  return schema.format ? `${type}(${schema.format})` : type
}
const nullableOf = (schema) => schema?.nullable === true || (Array.isArray(schema?.type) && schema.type.includes('null'))

/** 스키마 안에서 가리키는 다른 스키마 이름들 */
const refsIn = (schema, out = new Set()) => {
  if (!schema || typeof schema !== 'object') return out
  if (Array.isArray(schema)) {
    for (const item of schema) refsIn(item, out)
    return out
  }
  if (typeof schema.$ref === 'string' && /\/(?:schemas|definitions)\//.test(schema.$ref)) out.add(refName(schema.$ref))
  for (const value of Object.values(schema)) if (value && typeof value === 'object') refsIn(value, out)
  return out
}

const contentSchema = (holder) => {
  const content = holder?.content
  if (!content || typeof content !== 'object') return holder?.schema ?? null
  const mime = Object.keys(content).find((m) => /json/.test(m)) ?? Object.keys(content)[0]
  return content[mime]?.schema ?? null
}

/**
 * 비교하기 좋은 모양으로 — 엔드포인트(파라미터·요청 본문·응답)와 스키마(필드)
 * @returns {{ endpoints: Map<string, any>, schemas: Map<string, any>, uses: Map<string, Set<string>> }}
 */
export const normalizeOpenApi = (doc) => {
  const endpoints = new Map()
  const rawSchemas = doc.components?.schemas ?? doc.definitions ?? {}
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    if (!item || typeof item !== 'object') continue
    const shared = Array.isArray(item.parameters) ? item.parameters : []
    for (const method of METHODS) {
      const op = item[method]
      if (!op || typeof op !== 'object') continue
      const params = new Map()
      let body = null
      const direct = new Set()
      for (const raw of [...shared, ...(Array.isArray(op.parameters) ? op.parameters : [])]) {
        const param = deref(doc, raw)
        if (!param?.name || !param.in) continue
        if (param.in === 'body') {
          body = { required: param.required === true, type: typeOf(param.schema) }
          refsIn(param.schema, direct)
          continue
        }
        const schema = param.schema ?? param
        params.set(`${param.in} ${param.name}`, { required: param.in === 'path' || param.required === true, type: typeOf(schema) })
        refsIn(schema, direct)
      }
      if (op.requestBody) {
        const requestBody = deref(doc, op.requestBody)
        const schema = contentSchema(requestBody)
        body = { required: requestBody?.required === true, type: typeOf(schema) }
        refsIn(schema, direct)
      }
      const responses = new Map()
      for (const [status, raw] of Object.entries(op.responses ?? {})) {
        const schema = contentSchema(deref(doc, raw))
        responses.set(String(status), schema ? typeOf(schema) : null)
        refsIn(schema, direct)
      }
      endpoints.set(`${method.toUpperCase()} ${path}`, { params, body, responses, direct })
    }
  }

  const schemas = new Map()
  for (const [name, raw] of Object.entries(rawSchemas)) {
    const schema = deref(doc, raw) ?? {}
    const required = new Set(Array.isArray(schema.required) ? schema.required : [])
    const properties = new Map(
      Object.entries(schema.properties ?? {}).map(([field, prop]) => [field, { type: typeOf(prop), nullable: nullableOf(prop), required: required.has(field), enum: Array.isArray(prop?.enum) ? prop.enum : null }]),
    )
    schemas.set(name, { type: typeOf({ ...schema, format: undefined }), enum: Array.isArray(schema.enum) ? schema.enum : null, properties, refs: refsIn(schema) })
  }

  // 엔드포인트마다 쓰는 스키마 — 스키마가 가리키는 스키마까지 따라간다
  const uses = new Map()
  for (const [key, endpoint] of endpoints) {
    const seen = new Set()
    const queue = [...endpoint.direct]
    while (queue.length > 0) {
      const name = queue.pop()
      if (seen.has(name)) continue
      seen.add(name)
      for (const next of schemas.get(name)?.refs ?? []) queue.push(next)
    }
    uses.set(key, seen)
  }
  return { endpoints, schemas, uses }
}

const quote = (value) => (typeof value === 'string' ? `'${value}'` : String(value))
const worst = (levels) => levels.reduce((a, b) => (LEVEL_ORDER[b] < LEVEL_ORDER[a] ? b : a), 'additive')
const union = (a, b) => [...new Set([...a, ...b])].sort()

const enumDetails = (before, after) => {
  const out = []
  if (!before && !after) return out
  const was = before ?? []
  const now = after ?? []
  for (const value of was) if (!now.includes(value)) out.push({ text: `enum 값 ${quote(value)}을(를) 지웠다`, level: 'breaking' })
  for (const value of now) if (!was.includes(value)) out.push({ text: `enum 값 ${quote(value)}을(를) 더했다`, level: 'caution' })
  return out
}

const endpointDetails = (before, after) => {
  const out = []
  for (const key of union(before.params.keys(), after.params.keys())) {
    const was = before.params.get(key)
    const now = after.params.get(key)
    if (!now) out.push({ text: `파라미터 ${key}을(를) 지웠다`, level: 'caution' })
    else if (!was) out.push(now.required ? { text: `파라미터 ${key}을(를) 더했다(필수)`, level: 'breaking' } : { text: `파라미터 ${key}을(를) 더했다`, level: 'additive' })
    else {
      if (was.type !== now.type) out.push({ text: `파라미터 ${key} 타입 ${was.type} → ${now.type}`, level: 'breaking' })
      if (!was.required && now.required) out.push({ text: `파라미터 ${key}이(가) 필수가 됐다`, level: 'breaking' })
      if (was.required && !now.required) out.push({ text: `파라미터 ${key}이(가) 필수에서 빠졌다`, level: 'additive' })
    }
  }
  const [was, now] = [before.body, after.body]
  if (was && !now) out.push({ text: '요청 본문을 지웠다', level: 'caution' })
  else if (!was && now) out.push({ text: `요청 본문을 더했다${now.required ? '(필수)' : ''}`, level: now.required ? 'breaking' : 'additive' })
  else if (was && now) {
    if (was.type !== now.type) out.push({ text: `요청 본문 ${was.type} → ${now.type}`, level: 'breaking' })
    if (!was.required && now.required) out.push({ text: '요청 본문이 필수가 됐다', level: 'breaking' })
  }
  for (const status of union(before.responses.keys(), after.responses.keys())) {
    const had = before.responses.has(status)
    const has = after.responses.has(status)
    if (had && !has) out.push({ text: `응답 ${status}을(를) 지웠다`, level: 'breaking' })
    else if (!had && has) out.push({ text: `응답 ${status}을(를) 더했다`, level: 'caution' })
    else if (before.responses.get(status) !== after.responses.get(status)) out.push({ text: `응답 ${status} ${before.responses.get(status) ?? '본문 없음'} → ${after.responses.get(status) ?? '본문 없음'}`, level: 'breaking' })
  }
  return out
}

const fieldDetails = (was, now) => {
  const out = []
  if (was.type !== now.type) out.push({ text: `타입 ${was.type} → ${now.type}`, level: 'breaking' })
  if (!was.nullable && now.nullable) out.push({ text: 'null을 허용하게 됐다', level: 'caution' })
  if (was.nullable && !now.nullable) out.push({ text: 'null을 허용하지 않게 됐다', level: 'additive' })
  if (!was.required && now.required) out.push({ text: '필수가 됐다', level: 'caution' })
  if (was.required && !now.required) out.push({ text: '필수에서 빠졌다', level: 'caution' })
  out.push(...enumDetails(was.enum, now.enum))
  return out
}

/**
 * @param {{ before: any, after: any }} args 옛 판·새 판 문서(없으면 빈 문서로 본다)
 * @returns {{ target: 'endpoint' | 'schema', key: string, change: 'added' | 'removed' | 'changed', level: string, details: string[], schema?: string, field?: string, endpoints?: string[] }[]}
 */
export const diffOpenApi = ({ before, after }) => {
  const old = normalizeOpenApi(before ?? {})
  const now = normalizeOpenApi(after ?? {})
  const changes = []
  const push = (change, found) => {
    if (found.length === 0) return
    changes.push({ ...change, level: worst(found.map((f) => f.level)), details: found.map((f) => f.text) })
  }
  // 바뀐 스키마를 쓰는 엔드포인트 — 지운 것은 옛 판, 나머지는 새 판에서 찾는다
  const endpointsUsing = (name, side) => [...side.uses].filter(([, used]) => used.has(name)).map(([key]) => key).sort()

  for (const key of union(old.endpoints.keys(), now.endpoints.keys())) {
    const was = old.endpoints.get(key)
    const is = now.endpoints.get(key)
    if (!is) push({ target: 'endpoint', key, change: 'removed' }, [{ text: '엔드포인트를 지웠다', level: 'breaking' }])
    else if (!was) push({ target: 'endpoint', key, change: 'added' }, [{ text: '엔드포인트를 더했다', level: 'additive' }])
    else push({ target: 'endpoint', key, change: 'changed' }, endpointDetails(was, is))
  }

  for (const name of union(old.schemas.keys(), now.schemas.keys())) {
    const was = old.schemas.get(name)
    const is = now.schemas.get(name)
    if (!is) {
      push({ target: 'schema', key: name, change: 'removed', schema: name, endpoints: endpointsUsing(name, old) }, [{ text: '스키마를 지웠다', level: 'breaking' }])
      continue
    }
    if (!was) {
      push({ target: 'schema', key: name, change: 'added', schema: name, endpoints: endpointsUsing(name, now) }, [{ text: '스키마를 더했다', level: 'additive' }])
      continue
    }
    const own = [...(was.type !== is.type ? [{ text: `타입 ${was.type} → ${is.type}`, level: 'breaking' }] : []), ...enumDetails(was.enum, is.enum)]
    push({ target: 'schema', key: name, change: 'changed', schema: name, endpoints: endpointsUsing(name, now) }, own)
    for (const field of union(was.properties.keys(), is.properties.keys())) {
      const before = was.properties.get(field)
      const after = is.properties.get(field)
      const key = `${name}.${field}`
      if (!after) push({ target: 'schema', key, change: 'removed', schema: name, field, endpoints: endpointsUsing(name, old) }, [{ text: '필드를 지웠다', level: 'breaking' }])
      else if (!before) {
        push({ target: 'schema', key, change: 'added', schema: name, field, endpoints: endpointsUsing(name, now) }, [after.required ? { text: '필드를 더했다(필수)', level: 'caution' } : { text: '필드를 더했다', level: 'additive' }])
      } else push({ target: 'schema', key, change: 'changed', schema: name, field, endpoints: endpointsUsing(name, now) }, fieldDetails(before, after))
    }
  }
  return changes.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || Number(a.target === 'schema') - Number(b.target === 'schema') || a.key.localeCompare(b.key))
}
