/**
 * SKILL.md frontmatter 읽기 — YAML 파서 없이(의존성 0) 한 줄 값만 읽는다.
 * gimi의 frontmatter는 name·description처럼 한 줄 값만 쓴다. 여러 줄 값이 필요해지면 이 파일부터 고친다.
 */

const FRONTMATTER = /^---\n([\s\S]*?)\n---(?:\n|$)/

/** @param {string} md */
const normalize = (md) => md.replace(/\r\n/g, '\n')

/** 첫 --- 사이의 내용. 없으면 null
 * @param {string} md
 * @returns {string | null} */
export const frontmatterOf = (md) => normalize(md).match(FRONTMATTER)?.[1] ?? null

/** frontmatter 다음의 본문. frontmatter가 없으면 전체
 * @param {string} md */
export const bodyOf = (md) => {
  const text = normalize(md)
  const match = text.match(FRONTMATTER)
  return match ? text.slice(match[0].length) : text
}

/** 한 줄 값 — 감싼 따옴표는 뗀다. 없으면 빈 문자열
 * @param {{ frontmatter: string | null, key: string }} args */
export const fieldOf = ({ frontmatter, key }) => {
  if (!frontmatter) return ''
  const value = frontmatter.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'))?.[1]?.trim() ?? ''
  return value.replace(/^(["'])(.*)\1$/, '$2')
}
