#!/usr/bin/env node
/**
 * 평가용 가짜 gh — 리뷰 평가(scripts/review-eval.mjs)가 두 리뷰어에게 같은 GitHub 이슈를 주려고 PATH 앞에 둔다.
 *
 *   node scripts/fake-gh.mjs --data <issues.json> <gh 인자…>
 *   issues.json — { "repo": "owner/name", "issues": [{ "number", "title", "body" }],
 *                   "pr"?: { "number", "title", "body", "closes"?: [이슈 번호] },
 *                   "checks"?: [{ "name", "workflow", "bucket", "state", "event", "runId", "jobId", "log"? }],
 *                   "unavailable"?: true }
 *
 * auth status·repo view·issue view·issue list·api repos/…/issues/N에 답한다. 그 밖의 명령은 실패한다.
 * pr가 없으면 PR은 없다고 답한다. pr가 있으면 지금 브랜치의 PR로 pr view·pr list·pr checks·pr checkout(이미 그 브랜치)·pr diff에 답하고
 * (번호·URL·브랜치 이름을 받는다, 머리 커밋은 지금 HEAD),
 * run view --job N은 그 체크의 log를 돌려준다(설계 결정 65). unavailable이면 모든 명령이 로그인하지 않았다고 실패한다.
 * --json 필드 고르기와 단순한 --jq(.필드)만 흉내 낸다.
 */
import { execFileSync } from 'node:child_process'
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

const pr = data.pr ?? null
const checks = Array.isArray(data.checks) ? data.checks : []
const prOf = () => ({
  number: pr.number,
  title: pr.title,
  body: pr.body,
  url: `https://github.com/${repo}/pull/${pr.number}`,
  baseRefName: 'main',
  // 맥락 수집은 PR의 머리 커밋이 HEAD와 같은지 본다 — 평가용 저장소의 지금 HEAD를 머리로 답한다
  headRefOid: git('rev-parse', 'HEAD').trim(),
  closingIssuesReferences: (pr.closes ?? []).map((number) => ({ number })),
  state: 'OPEN',
})
const checkOf = (check) => ({ name: check.name, workflow: check.workflow, bucket: check.bucket, state: check.state, event: check.event, link: `https://github.com/${repo}/actions/runs/${check.runId}/job/${check.jobId}` })
const git = (...gitArgs) => execFileSync('git', gitArgs, { encoding: 'utf8' })
// 번호가 없으면 지금 브랜치의 PR. 번호·#번호·PR URL·지금 브랜치 이름이면 그 PR이다
const isThisPr = (ref) => {
  if (pr === null) return false
  if (ref === undefined || ref.startsWith('-')) return true
  const text = String(ref)
  if (text === `https://github.com/${repo}/pull/${pr.number}`) return true
  if (/^#?\d+$/.test(text)) return Number(text.replace(/^#/, '')) === pr.number
  return text === git('branch', '--show-current').trim()
}

const [group, command, target] = args
if (data.unavailable === true) {
  fail('To get started with GitHub CLI, please run:  gh auth login', 4)
} else if (group === 'auth' && command === 'status') {
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
} else if (group === 'pr' && pr !== null) {
  if (command === 'list') {
    if (args.includes('--json')) printJson([prOf()])
    else console.log(`${pr.number}\t${pr.title}\tfeature/pr\tOPEN`)
  } else if (command === 'view' && isThisPr(target)) {
    if (args.includes('--json')) printJson(prOf())
    else console.log(`${pr.title} #${pr.number}\n\n${pr.body}`)
  } else if (command === 'checkout' && isThisPr(target)) {
    // 평가용 저장소는 이미 PR 브랜치에 있다 — 브랜치를 바꾸지 않는다
    console.error(`Already on '${git('branch', '--show-current').trim()}'`)
  } else if (command === 'diff' && isThisPr(target)) {
    process.stdout.write(git('diff', '--no-color', 'main...HEAD'))
  } else if (command === 'checks' && isThisPr(target)) {
    if (checks.length === 0) fail('no checks reported on the \'feature/pr\' branch')
    if (args.includes('--json')) printJson(checks.map(checkOf))
    else console.log(checks.map((check) => `${check.name}\t${check.bucket}`).join('\n'))
  } else fail(`no pull requests found for ${target ?? 'this branch'}`)
} else if (group === 'pr') {
  if (command === 'list' && args.includes('--json')) console.log('[]')
  else if (command === 'list') console.log('no open pull requests')
  else fail('no pull requests found for this branch')
} else if (group === 'run' && command === 'view' && optionValue('--job')) {
  const check = checks.find((one) => String(one.jobId) === optionValue('--job'))
  if (!check) fail(`HTTP 404: Not Found (job ${optionValue('--job')})`)
  console.log(check.log ?? '')
} else if (group === 'api') {
  const issue = /^\/?repos\/[^/]+\/[^/]+\/issues\/\d+$/.test(command ?? '') ? findIssue(command) : null
  if (!issue) fail('gh: Not Found (HTTP 404)')
  printJson(issueOf(issue))
} else {
  fail(`평가용 가짜 gh — 이 명령은 없다: gh ${args.join(' ')}`)
}
