/**
 * YAML 읽기 — OpenAPI 계약 파일용. 리뷰하는 프로젝트의 yaml·js-yaml을 먼저 쓰고, 없으면 내장 최소 파서로 읽는다(런타임 의존성 0).
 * 내장 파서는 OpenAPI에 흔한 문법만 읽는다 — 들여쓰기 맵·목록, 따옴표·평문 값, 한 줄 흐름 목록·맵, 블록 문자열(|·>), 여러 줄 평문, 주석.
 * 앵커·별칭·태그·복합 키·탭 들여쓰기·여러 문서는 틀리게 읽지 않도록 YamlUnsupported를 던진다. 부르는 쪽이 "건너뜀"으로 적는다.
 */
import { requireFromProject } from './exec.mjs'

export class YamlUnsupported extends Error {}

/**
 * 프로젝트의 YAML 파서 — 없거나 git에 커밋된 것(PR이 커밋한 코드일 수 있다)이면 내장 파서
 * @returns {{ parse: (text: string) => any, name: string, reason: string | null }} reason은 커밋돼 있어 불러오지 않은 까닭
 */
export const loadYaml = ({ root }) => {
  const yaml = requireFromProject({ root, name: 'yaml' })
  if (typeof yaml.module?.parse === 'function') return { parse: (text) => yaml.module.parse(text), name: 'yaml', reason: null }
  const jsYaml = requireFromProject({ root, name: 'js-yaml' })
  if (typeof jsYaml.module?.load === 'function') return { parse: (text) => jsYaml.module.load(text), name: 'js-yaml', reason: null }
  return { parse: parseYaml, name: '내장', reason: yaml.reason ?? jsYaml.reason }
}

/** 내장 파서만 — YAML 파일이 바뀌지 않았으면 프로젝트의 파서를 불러오지 않는다 */
export const builtinYaml = () => ({ parse: parseYaml, name: '내장', reason: null })

const unsupported = (what, line) => new YamlUnsupported(`내장 YAML 파서가 읽지 못하는 문법(${what}, ${line}번째 줄)`)

const scalar = (raw) => {
  const value = raw.trim()
  if (/^(?:null|Null|NULL|~)?$/.test(value)) return null
  if (/^(?:true|True|TRUE)$/.test(value)) return true
  if (/^(?:false|False|FALSE)$/.test(value)) return false
  if (/^[-+]?\d+$/.test(value)) return Number(value)
  if (/^[-+]?(?:\d+\.\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(value)) return Number(value)
  return value
}

const unquoteDouble = (body) =>
  body.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, c) => {
    if (c.startsWith('u')) return String.fromCharCode(parseInt(c.slice(1), 16))
    return { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', '/': '/', 0: '\0', ' ': ' ' }[c] ?? c
  })

/** 따옴표 문자열을 읽고 끝난 위치를 돌려준다 */
const readQuoted = (text, start) => {
  const quote = text[start]
  let k = start + 1
  let out = ''
  while (k < text.length) {
    const c = text[k]
    if (quote === "'" && c === "'") {
      if (text[k + 1] === "'") {
        out += "'"
        k += 2
        continue
      }
      return { value: out, end: k + 1 }
    }
    if (quote === '"' && c === '\\') {
      out += text.slice(k, k + 2)
      k += 2
      continue
    }
    if (quote === '"' && c === '"') return { value: unquoteDouble(out), end: k + 1 }
    out += c
    k += 1
  }
  return null
}

/** 따옴표 밖의 " #" 뒤를 주석으로 지운다 */
const stripComment = (text) => {
  let quote = null
  for (let k = 0; k < text.length; k += 1) {
    const c = text[k]
    if (quote) {
      if (c === '\\' && quote === '"') k += 1
      else if (c === quote) quote = null
    } else if (c === '"' || c === "'") {
      if (k === 0 || /[\s[{,:]/.test(text[k - 1])) quote = c
    } else if (c === '#' && (k === 0 || /\s/.test(text[k - 1]))) return text.slice(0, k).trimEnd()
  }
  return text.trimEnd()
}

/** 한 줄 흐름 목록·맵 — [a, b]·{a: 1} */
const parseFlow = (text, lineNo) => {
  let k = 0
  const space = () => {
    while (k < text.length && /\s/.test(text[k])) k += 1
  }
  const value = () => {
    space()
    const c = text[k]
    if (c === '[') {
      k += 1
      const arr = []
      space()
      if (text[k] === ']') {
        k += 1
        return arr
      }
      for (;;) {
        arr.push(value())
        space()
        if (text[k] === ',') k += 1
        else if (text[k] === ']') {
          k += 1
          return arr
        } else throw unsupported('흐름 목록', lineNo)
      }
    }
    if (c === '{') {
      k += 1
      const obj = {}
      space()
      if (text[k] === '}') {
        k += 1
        return obj
      }
      for (;;) {
        space()
        const key = text[k] === '"' || text[k] === "'" ? readQuoted(text, k) : null
        let name
        if (key) {
          name = key.value
          k = key.end
        } else {
          const m = text.slice(k).match(/^[^:,{}[\]]+/)
          if (!m) throw unsupported('흐름 맵', lineNo)
          name = m[0].trim()
          k += m[0].length
        }
        space()
        if (text[k] !== ':') throw unsupported('흐름 맵', lineNo)
        k += 1
        obj[name] = value()
        space()
        if (text[k] === ',') k += 1
        else if (text[k] === '}') {
          k += 1
          return obj
        } else throw unsupported('흐름 맵', lineNo)
      }
    }
    if (c === '"' || c === "'") {
      const read = readQuoted(text, k)
      if (!read) throw unsupported('따옴표', lineNo)
      k = read.end
      return read.value
    }
    const m = text.slice(k).match(/^[^,{}[\]]*/)
    k += m[0].length
    return scalar(m[0])
  }
  const result = value()
  space()
  if (k !== text.length) throw unsupported('흐름 값', lineNo)
  return result
}

/** "키: 값"을 가른다 — 키가 아니면 null */
const splitKey = (content) => {
  if (content.startsWith('? ')) return { complex: true }
  if (content.startsWith('"') || content.startsWith("'")) {
    const read = readQuoted(content, 0)
    if (!read) return null
    const rest = content.slice(read.end)
    if (rest === ':' || rest.startsWith(': ')) return { key: read.value, rest: rest.slice(1) }
    return null
  }
  if (/^[[{]/.test(content)) return null
  const m = content.match(/^([^#]*?):(?:\s|$)/)
  if (!m || m[1] === '') return null
  return { key: m[1].trim(), rest: content.slice(m[0].length - (/\s$/.test(m[0]) ? 1 : 0)) }
}

/** @param {string} text */
export const parseYaml = (text) => {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let i = 0
  const n = lines.length
  const indentOf = (line) => line.match(/^ */)[0].length
  const isBlank = (line) => /^\s*(?:#.*)?$/.test(line)
  const skipBlank = () => {
    while (i < n && isBlank(lines[i])) i += 1
  }
  const info = (k) => {
    const line = lines[k]
    if (/^ *\t/.test(line)) throw unsupported('탭 들여쓰기', k + 1)
    return { indent: indentOf(line), content: stripComment(line.slice(indentOf(line))) }
  }

  // 문서 머리(---)는 넘기고, 두 번째 문서는 읽지 않는다
  skipBlank()
  if (i < n && /^---\s*$/.test(lines[i])) i += 1
  for (let k = i; k < n; k += 1) if (/^(?:---|\.\.\.)\s*$/.test(lines[k])) throw unsupported('여러 문서', k + 1)

  const isSeq = (content) => content === '-' || content.startsWith('- ')

  const block = (minIndent) => {
    skipBlank()
    if (i >= n) return null
    const { indent, content } = info(i)
    if (indent < minIndent) return null
    if (isSeq(content)) return seq(indent)
    if (splitKey(content)) return map(indent)
    i += 1
    return value(content, indent - 1, i)
  }

  const map = (indent) => {
    const obj = {}
    for (;;) {
      skipBlank()
      if (i >= n) return obj
      const { indent: at, content } = info(i)
      if (at < indent || (at === indent && isSeq(content))) return obj
      if (at > indent) throw unsupported('들여쓰기', i + 1)
      const kv = splitKey(content)
      if (!kv) throw unsupported('맵이 아닌 줄', i + 1)
      if (kv.complex) throw unsupported('복합 키', i + 1)
      i += 1
      obj[kv.key] = value(kv.rest, indent, i)
    }
  }

  const seq = (indent) => {
    const arr = []
    for (;;) {
      skipBlank()
      if (i >= n) return arr
      const { indent: at, content } = info(i)
      if (at !== indent || !isSeq(content)) return arr
      const rest = content.slice(1)
      const lead = rest.match(/^ */)[0].length
      const item = rest.slice(lead)
      if (item === '') {
        i += 1
        arr.push(block(indent + 1))
      } else if (splitKey(item) && !/^[[{]/.test(item)) {
        // "- 키: 값" — 같은 항목의 다음 키들은 첫 키의 열에 맞춰 이어진다
        lines[i] = `${' '.repeat(indent + 1 + lead)}${item}`
        arr.push(map(indent + 1 + lead))
      } else {
        i += 1
        arr.push(value(item, indent, i))
      }
    }
  }

  /** 키 뒤(또는 목록 항목)의 값 — parentIndent보다 깊은 다음 줄은 이 값의 일부다 */
  const value = (raw, parentIndent, lineNo) => {
    const rest = stripComment(raw).trim()
    if (rest === '') {
      skipBlank()
      if (i < n) {
        const { indent, content } = info(i)
        if (indent > parentIndent) return block(indent)
        if (indent === parentIndent && isSeq(content)) return seq(indent)
      }
      return null
    }
    if (/^[&*!]/.test(rest)) throw unsupported(rest[0] === '!' ? '태그' : '앵커·별칭', lineNo)
    if (/^[|>]/.test(rest)) return blockScalar(rest, parentIndent, lineNo)
    if (/^[[{]/.test(rest)) return parseFlow(rest, lineNo)
    if (rest.startsWith('"') || rest.startsWith("'")) {
      // 여러 줄 따옴표 문자열 — 닫힐 때까지 줄을 이어 접는다
      let text = rest
      let read = readQuoted(text, 0)
      while (!read && i < n) {
        text += ` ${lines[i].trim()}`
        i += 1
        read = readQuoted(text, 0)
      }
      if (!read || stripComment(text.slice(read.end)).trim() !== '') throw unsupported('따옴표', lineNo)
      return read.value
    }
    // 여러 줄 평문 — 더 깊이 들여쓴 다음 줄들을 한 칸으로 이어 붙인다
    let text = rest
    while (i < n && !isBlank(lines[i]) && indentOf(lines[i]) > parentIndent) {
      text += ` ${stripComment(lines[i].trim())}`
      i += 1
    }
    return scalar(text)
  }

  const blockScalar = (header, parentIndent, lineNo) => {
    const m = header.match(/^([|>])([-+]?)$/)
    if (!m) throw unsupported('블록 문자열 머리', lineNo)
    const body = []
    let blockIndent = null
    while (i < n) {
      const line = lines[i]
      if (line.trim() === '') {
        body.push('')
        i += 1
        continue
      }
      const at = indentOf(line)
      if (at <= parentIndent) break
      blockIndent ??= at
      if (at < blockIndent) break
      body.push(line.slice(blockIndent))
      i += 1
    }
    while (body.length > 0 && body.at(-1) === '' && m[2] !== '+') body.pop()
    let text = m[1] === '|' ? body.join('\n') : body.reduce((acc, line) => (acc === '' ? line : line === '' ? `${acc}\n` : acc.endsWith('\n') ? `${acc}${line}` : `${acc} ${line}`), '')
    if (m[2] !== '-' && text !== '') text += '\n'
    return text
  }

  const result = block(0)
  skipBlank()
  if (i < n) throw unsupported('남은 줄', i + 1)
  return result
}
