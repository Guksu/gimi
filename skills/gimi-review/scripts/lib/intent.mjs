/**
 * 의도·요구사항 맥락 — 브랜치 이름, 이번 범위의 커밋, PR 본문, 연결된 이슈에서 요구사항의 출처를 모은다.
 * GitHub PR·이슈 본문은 gh로 읽는다. Jira·Notion·Linear는 번호·링크만 뽑고 본문은 에이전트가 연결된 도구로 읽는다(설계 결정 21).
 */
import { attempt } from './exec.mjs'
import { LOG_FORMAT, parseLog } from './history.mjs'

const DEFAULT_KEY = /\b([A-Z][A-Z0-9]{1,9})-(\d+)\b/g
// 티켓 번호처럼 생긴 표준 이름 — 이것까지 티켓으로 올리면 에이전트가 없는 티켓을 찾는다
const NOT_TICKET = new Set(['UTF', 'ISO', 'SHA', 'RFC', 'TLS', 'SSL', 'HTTP', 'AES', 'RSA', 'ECMA', 'ES', 'CVE', 'GPT', 'IPV', 'MD', 'HS', 'RS', 'PS', 'EC'])
const ISSUE_REF = /(?:^|[\s(,])#(\d+)\b/g
const LINK = /https?:\/\/[^\s)>\]"']+/g
// 위에서부터 고른다 — Confluence 주소도 atlassian.net이라 Jira보다 먼저 본다
const LINK_SOURCES = [
  [/confluence|atlassian\.net\/wiki\//i, 'confluence'],
  [/atlassian\.net|jira/i, 'jira'],
  [/notion\.(so|site)/i, 'notion'],
  [/linear\.app/i, 'linear'],
]
const MAX_ISSUES = 5

/**
 * @param {{ texts: (string | null | undefined)[], keyPatterns?: { source: string, pattern: string }[] }} args
 * @returns {{ tickets: { id: string, source: string }[], issueNumbers: number[], links: { url: string, source: string }[] }}
 */
export const extractTicketRefs = ({ texts, keyPatterns = [] }) => {
  const tickets = new Map()
  const issueNumbers = new Set()
  const links = new Map()
  for (const text of texts) {
    if (!text) continue
    // 설정의 번호 형식이 먼저다 — 앞 글에서 출처 모름으로 들어간 번호도 출처를 고쳐 단다
    for (const { source, pattern } of keyPatterns) for (const match of text.matchAll(new RegExp(pattern, 'g'))) tickets.set(match[0], source)
    for (const match of text.matchAll(DEFAULT_KEY)) if (!NOT_TICKET.has(match[1]) && !tickets.has(match[0])) tickets.set(match[0], 'unknown')
    for (const match of text.matchAll(ISSUE_REF)) issueNumbers.add(Number(match[1]))
    for (const match of text.matchAll(LINK)) {
      const url = match[0].replace(/[.,]+$/, '')
      const source = LINK_SOURCES.find(([pattern]) => pattern.test(url))?.[1]
      if (source && !links.has(url)) links.set(url, source)
    }
  }
  return {
    tickets: [...tickets].map(([id, source]) => ({ id, source })),
    issueNumbers: [...issueNumbers].sort((a, b) => a - b),
    links: [...links].map(([url, source]) => ({ url, source })),
  }
}

/**
 * 요구사항 번호를 찾을 글 — 커밋 제목 끝의 "(#36)"은 그 커밋을 만든 스쿼시 PR 번호라 이슈 후보에서 뺀다
 * @param {{ branch: string | null, prInfo: { title?: string, body?: string } | null, commits: { subject: string, body: string }[] }} args
 * @returns {string[]}
 */
export const intentTexts = ({ branch, prInfo, commits }) =>
  [branch, prInfo?.title, prInfo?.body, ...commits.flatMap((commit) => [commit.subject.replace(/\s*\(#\d+\)\s*$/, ''), commit.body])].filter(Boolean)

/**
 * 의도 맥락을 모은다 — gh가 없으면(null) PR·이슈 본문 없이 git에 있는 것만 모은다
 * @param {{ exec: { git: (args: string[]) => string }, gh: ((args: string[]) => string) | null, scope: { mergeBase: string, branch: string | null }, prInfo: any, keyPatterns: { source: string, pattern: string }[] }} args
 */
export const collectIntent = ({ exec, gh, scope, prInfo, keyPatterns }) => {
  const commits = parseLog(exec.git(['log', `--format=${LOG_FORMAT}`, `${scope.mergeBase}..HEAD`]))
  const refs = extractTicketRefs({ texts: intentTexts({ branch: scope.branch, prInfo, commits }), keyPatterns })
  const issueNumbers = new Set([...(prInfo?.closingIssuesReferences ?? []).map((issue) => issue.number), ...refs.issueNumbers])
  if (prInfo) issueNumbers.delete(prInfo.number)
  const wanted = [...issueNumbers].slice(0, MAX_ISSUES)
  const issues = gh ? wanted.map((number) => attempt(() => JSON.parse(gh(['issue', 'view', String(number), '--json', 'number,title,body,url'])))).filter(Boolean) : []
  return {
    branch: scope.branch,
    pr: prInfo ? { number: prInfo.number, title: prInfo.title, body: prInfo.body, url: prInfo.url } : null,
    commits,
    tickets: refs.tickets,
    links: refs.links,
    issueNumbers: [...issueNumbers],
    issues,
    unreadIssues: gh ? wanted.filter((number) => !issues.some((issue) => issue.number === number)) : wanted,
  }
}
