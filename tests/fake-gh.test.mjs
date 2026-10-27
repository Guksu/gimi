import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

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
