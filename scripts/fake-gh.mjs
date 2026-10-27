#!/usr/bin/env node
/**
 * 평가용 가짜 gh — 리뷰 평가(scripts/review-eval.mjs)가 두 리뷰어에게 같은 GitHub 이슈를 주려고 PATH 앞에 둔다.
 *
 *   node scripts/fake-gh.mjs --data <issues.json> <gh 인자…>
 *   issues.json — { "repo": "owner/name", "issues": [{ "number", "title", "body" }] }
 *
 * auth status·repo view·issue view·issue list·api repos/…/issues/N에 답한다. PR은 없다고 답한다. 그 밖의 명령은 실패한다.
 * --json 필드 고르기와 단순한 --jq(.필드)만 흉내 낸다.
 */
import { readFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const dataAt = argv.indexOf('--data')
const data = dataAt === -1 ? { repo: 'owner/repo', issues: [] } : JSON.parse(readFileSync(argv[dataAt + 1], 'utf8'))
const args = dataAt === -1 ? argv : [...argv.slice(0, dataAt), ...argv.slice(dataAt + 2)]
const repo = data.repo ?? 'owner/repo'
const issueOf = (issue) => ({ number: issue.number, title: issue.title, body: issue.body, url: `https://github.com/${repo}/issues/${issue.number}`, state: 'OPEN', author: { login: 'pm' }, labels: [], comments: [], createdAt: '2026-10-20T01:00:00Z' })

const optionValue = (name) => {
  const at = args.indexOf(name)
  return at === -1 ? null : args[at + 1]
}
const pickFields = (value) => {
  const fields = optionValue('--json')
  if (!fields) return value
  const pick = (one) => Object.fromEntries(fields.split(',').map((field) => [field, one[field]]))
  return Array.isArray(value) ? value.map(pick) : pick(value)
}
const printJson = (value) => {
  const jq = optionValue('--jq') ?? optionValue('-q')
  const picked = pickFields(value)
  const simple = jq?.match(/^\.(\w+)$/)
  if (simple && !Array.isArray(picked)) console.log(typeof picked[simple[1]] === 'string' ? picked[simple[1]] : JSON.stringify(picked[simple[1]]))
  else console.log(JSON.stringify(picked, null, 2))
}
const fail = (message, code = 1) => {
  console.error(message)
  process.exit(code)
}
const findIssue = (ref) => {
  const number = Number(String(ref ?? '').replace(/^.*\/issues\//, '').replace(/^#/, ''))
  return data.issues.find((issue) => issue.number === number) ?? null
}

const [group, command, target] = args
if (group === 'auth' && command === 'status') {
  console.log(`github.com\n  ✓ Logged in to github.com account eval (keyring)`)
} else if (group === 'repo' && command === 'view') {
  const value = { name: repo.split('/')[1], nameWithOwner: repo, url: `https://github.com/${repo}` }
  if (args.includes('--json')) printJson(value)
  else console.log(repo)
} else if (group === 'issue' && command === 'view') {
  const issue = findIssue(target)
  if (!issue) fail(`GraphQL: Could not resolve to an issue or pull request with the number of ${String(target).replace(/^#/, '')}. (repository.issue)`)
  const value = issueOf(issue)
  if (args.includes('--json')) printJson(value)
  else console.log(`${value.title} #${value.number}\nOpen • ${value.author.login} opened • 0 comments\n\n${value.body}\n\nView this issue on GitHub: ${value.url}`)
} else if (group === 'issue' && command === 'list') {
  const values = data.issues.map(issueOf)
  if (args.includes('--json')) printJson(values)
  else console.log(values.map((value) => `${value.number}\tOPEN\t${value.title}`).join('\n'))
} else if (group === 'pr') {
  if (command === 'list' && args.includes('--json')) console.log('[]')
  else if (command === 'list') console.log('no open pull requests')
  else fail('no pull requests found for this branch')
} else if (group === 'api') {
  const issue = /^\/?repos\/[^/]+\/[^/]+\/issues\/\d+$/.test(command ?? '') ? findIssue(command) : null
  if (!issue) fail('gh: Not Found (HTTP 404)')
  printJson(issueOf(issue))
} else {
  fail(`평가용 가짜 gh — 이 명령은 없다: gh ${args.join(' ')}`)
}
