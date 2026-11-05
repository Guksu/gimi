import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeRepo } from './helpers/repo.mjs'

const SCRIPT = fileURLToPath(new URL('../scripts/fake-gh.mjs', import.meta.url))
let dir
let data
const gh = (...args) => spawnSync(process.execPath, [SCRIPT, '--data', data, ...args], { encoding: 'utf8' })

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'gimi-fake-gh-'))
  data = join(dir, 'issues.json')
  writeFileSync(data, JSON.stringify({ repo: 'guksu-shop/shop', issues: [{ number: 41, title: '메뉴 정렬', body: '품절 상품은 숨기지 않고 맨 아래로 보낸다' }] }))
})
after(() => rmSync(dir, { recursive: true, force: true }))

describe('fake-gh.mjs — 평가용 가짜 gh', () => {
  it('로그인돼 있다고 답한다 — 맥락 수집이 gh를 쓸 수 있다고 본다', () => {
    assert.equal(gh('auth', 'status').status, 0)
  })

  it('issue view는 --json 필드를 골라 주고, --jq .필드와 글 출력도 한다', () => {
    const json = gh('issue', 'view', '41', '--json', 'number,title,body,url')
    assert.equal(json.status, 0)
    assert.deepEqual(JSON.parse(json.stdout), { number: 41, title: '메뉴 정렬', body: '품절 상품은 숨기지 않고 맨 아래로 보낸다', url: 'https://github.com/guksu-shop/shop/issues/41' })
    assert.equal(gh('issue', 'view', '41', '--json', 'body', '--jq', '.body').stdout.trim(), '품절 상품은 숨기지 않고 맨 아래로 보낸다')
    assert.match(gh('issue', 'view', '#41').stdout, /메뉴 정렬 #41[\s\S]*맨 아래로 보낸다/)
    assert.equal(JSON.parse(gh('api', 'repos/guksu-shop/shop/issues/41').stdout).number, 41)
  })

  it('없는 이슈·PR·모르는 명령은 실패한다', () => {
    assert.equal(gh('issue', 'view', '99').status, 1)
    assert.equal(gh('pr', 'view', '--json', 'title').status, 1)
    assert.equal(gh('pr', 'list', '--json', 'number').stdout.trim(), '[]')
    const unknown = gh('release', 'list')
    assert.equal(unknown.status, 1)
    assert.match(unknown.stderr, /가짜 gh/)
  })
})

describe('fake-gh.mjs — 가짜 PR·CI(설계 결정 65)', () => {
  let repoDir
  let prData
  let offData
  const ghIn = (file, ...args) => spawnSync(process.execPath, [SCRIPT, '--data', file, ...args], { cwd: repoDir, encoding: 'utf8' })

  before(() => {
    const repo = makeRepo()
    repo.write({ 'a.txt': 'a\n' })
    repo.commit('첫 커밋')
    repoDir = repo.dir
    prData = join(dir, 'pr.json')
    writeFileSync(
      prData,
      JSON.stringify({
        repo: 'guksu-shop/shop',
        issues: [{ number: 41, title: '메뉴 정렬', body: '품절 상품은 맨 아래로' }],
        pr: { number: 7, title: 'refactor: 배지 정리', body: '동작은 그대로다', closes: [41] },
        checks: [
          { name: 'test', workflow: 'CI', bucket: 'fail', state: 'FAILURE', event: 'pull_request', runId: 900, jobId: 456, log: "FAIL OrderBadge.test.tsx:12 expected 'PAID'" },
          { name: 'lint', workflow: 'CI', bucket: 'pass', state: 'SUCCESS', event: 'pull_request', runId: 900, jobId: 457 },
        ],
      }),
    )
    offData = join(dir, 'off.json')
    writeFileSync(offData, JSON.stringify({ repo: 'guksu-shop/shop', unavailable: true, issues: [{ number: 41, title: '메뉴 정렬', body: '품절 상품은 맨 아래로' }] }))
  })

  it('pr view는 지금 브랜치(번호 없이)와 그 번호의 PR을 돌려준다 — 머리 커밋은 지금 HEAD다', () => {
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).stdout.trim()
    const view = ghIn(prData, 'pr', 'view', '--json', 'number,title,body,url,baseRefName,headRefOid,closingIssuesReferences')
    assert.equal(view.status, 0, view.stderr)
    assert.deepEqual(JSON.parse(view.stdout), {
      number: 7,
      title: 'refactor: 배지 정리',
      body: '동작은 그대로다',
      url: 'https://github.com/guksu-shop/shop/pull/7',
      baseRefName: 'main',
      headRefOid: head,
      closingIssuesReferences: [{ number: 41 }],
    })
    assert.equal(JSON.parse(ghIn(prData, 'pr', 'view', '7', '--json', 'number').stdout).number, 7)
    assert.equal(ghIn(prData, 'pr', 'view', '8', '--json', 'number').status, 1)
    assert.deepEqual(JSON.parse(ghIn(prData, 'pr', 'list', '--json', 'number').stdout), [{ number: 7 }])
  })

  it('pr checks는 체크마다 같은 저장소의 Actions 링크를 붙이고, run view --job은 그 작업의 로그를 돌려준다', () => {
    const checks = ghIn(prData, 'pr', 'checks', '7', '--json', 'name,workflow,bucket,state,event,link')
    assert.equal(checks.status, 0, checks.stderr)
    assert.deepEqual(JSON.parse(checks.stdout)[0], { name: 'test', workflow: 'CI', bucket: 'fail', state: 'FAILURE', event: 'pull_request', link: 'https://github.com/guksu-shop/shop/actions/runs/900/job/456' })
    assert.equal(ghIn(prData, 'run', 'view', '--job', '456', '--log-failed').stdout.trim(), "FAIL OrderBadge.test.tsx:12 expected 'PAID'")
    assert.equal(ghIn(prData, 'run', 'view', '--job', '999', '--log-failed').status, 1)
    assert.equal(ghIn(prData, 'pr', 'checks', '8', '--json', 'name').status, 1)
  })

  it('unavailable이면 모든 명령이 로그인하지 않았다고 실패한다 — 맥락 수집이 의도를 건너뛰었다고 적는다', () => {
    for (const args of [['auth', 'status'], ['issue', 'view', '41'], ['pr', 'view', '--json', 'number']]) {
      const result = ghIn(offData, ...args)
      assert.equal(result.status, 4, args.join(' '))
      assert.match(result.stderr, /gh auth login/)
    }
  })
})
